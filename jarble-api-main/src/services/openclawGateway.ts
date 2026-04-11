/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to the OpenClaw gateway running inside a pod and sends
 * chat messages via the WS JSON-RPC protocol with Ed25519 device auth.
 *
 * Protocol:
 *   1. WS connect → server sends { type: "event", event: "connect.challenge", payload: { nonce } }
 *   2. Client generates Ed25519 key pair, signs payload with nonce, sends connect with device identity
 *   3. Server grants scopes (including operator.write) and returns hello-ok with deviceToken
 *   4. Client sends { type: "req", id, method: "chat.send", params: { sessionKey, message } }
 *   5. Server sends events with state: "delta" (streaming text) and state: "final" (done)
 */

import crypto from "crypto";
import WebSocket from "ws";
import { nanoid } from "nanoid";
import { trace, SpanStatusCode, propagation, context as otelContext } from "@opentelemetry/api";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("gateway");
import { extractAllUIBlocks, extractUIBlocks, type JarbleUIBlock, type JarbleUIUpdate, type JarbleComponentDef } from "../utils/uiBlockParser.js";
import { execInPod } from "../k8s/exec.js";

// OTel tracer for cross-pod delegation spans (JAR-51 Phase 3).
const tracer = trace.getTracer("jarble-api.openclaw-gateway");

/**
 * Serialize the current active OTel context to a W3C traceparent header.
 * Used to prepend `env TRACEPARENT=...` to kubectl exec calls so that
 * an openclaw runtime which reads the env var can attach its child
 * spans under the same trace as the API caller. Today openclaw doesn't
 * consume it, but shipping the env var costs nothing and is
 * forward-compatible with Phase 3 of the observability plan.
 *
 * Returns an object with traceparent/tracestate that was injected.
 * When no active span, returns an empty object.
 */
function getW3CTraceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  return carrier;
}

// ── Device Identity ─────────────────────────────────────────────────────────

/**
 * Generate a fresh device identity per connection.
 *
 * OpenClaw issues a deviceToken on first connect for a given deviceId.
 * On reconnection with the same deviceId, it expects that token back.
 * Since we don't persist deviceTokens across WS connections, we generate
 * a new Ed25519 keypair each time so OpenClaw treats every connection
 * as a brand-new device.
 */
function createDeviceIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // Extract raw 32-byte public key from SPKI DER
  const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length);

  // Device ID = SHA-256 fingerprint of raw public key
  const deviceId = crypto.createHash("sha256").update(raw).digest("hex");
  // Base64url-encoded raw public key
  const publicKeyB64 = raw.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return { deviceId, publicKeyB64, publicKeyPem, privateKeyPem };
}

function signPayload(privateKeyPem: string, payload: string): string {
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem));
  return sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ── Gateway Client ──────────────────────────────────────────────────────────

interface GatewayOptions {
  ip: string;
  port: number;
  gatewayToken: string;
  /** Unique per-user session to maintain conversation continuity */
  sessionKey: string;
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

/**
 * Send a single chat message to the OpenClaw gateway and collect the streamed response.
 *
 * Opens a WS connection, authenticates with Ed25519 device identity,
 * sends the message, collects delta events until the final event, then closes.
 * Returns the full bot response text and any extracted UI blocks.
 */
export interface GatewayResponse {
  /** Raw text including jarble_ui markers (for delta comparison) */
  rawText: string;
  /** Clean text with jarble_ui blocks stripped */
  text: string;
  uiBlocks: JarbleUIBlock[];
  /** In-place update instructions for existing canvas cards */
  uiUpdates: JarbleUIUpdate[];
  /** Custom component definitions to register */
  componentDefs: JarbleComponentDef[];
  /** Suggestion strings extracted from jarble_suggestions blocks */
  suggestions: string[];
  /** Design context inferred or explicitly set during this turn */
  designContext: Record<string, unknown> | null;
  /** Native thinking/reasoning content extracted from LLM response (if available) */
  nativeThinking: string;
  /** True when the response was cut short by a timeout (partial text returned) */
  timedOut?: boolean;
  /**
   * Token usage from the LLM call (Cost Transparency Phase 1).
   * Extracted from the exec response's agentMeta.usage or the HTTP
   * streaming final chunk's usage object. Used by flowDelegation to
   * populate creditsCharged with real token costs instead of the
   * hardcoded value of 1.
   */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    model?: string;
  };
}

export async function chatViaGateway(
  opts: GatewayOptions,
  message: string,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
  onBlockDetected?: (block: JarbleUIBlock) => void,
): Promise<GatewayResponse> {
  // JAR-51 Phase 3: wrap the gateway call in an OTel span so the WS
  // hot path shows up in Langfuse alongside the chatViaExec fallback.
  // This is the primary delegation path — chatViaExec only runs when
  // the WS connection fails.
  return tracer.startActiveSpan(
    "jarble.delegation.gateway",
    {
      attributes: {
        "jarble.pod.ip": opts.ip,
        "jarble.pod.port": opts.port,
        "jarble.session.key": opts.sessionKey,
        "jarble.message.length": message.length,
        "jarble.runtime": "openclaw",
        "jarble.transport": "ws",
      },
    },
    async (span) => {
      try {
        return await chatViaGatewayInner(opts, message, onDelta, signal, onBlockDetected);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

async function chatViaGatewayInner(
  opts: GatewayOptions,
  message: string,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
  onBlockDetected?: (block: JarbleUIBlock) => void,
): Promise<GatewayResponse> {
  const { ip, port, gatewayToken, sessionKey } = opts;
  const wsUrl = `ws://${ip}:${port}`;

  const connectStartMs = Date.now();

  return new Promise<GatewayResponse>((resolve, reject) => {
    const timeoutMs = 180_000; // 3 min - generous for Opus thinking + large system prompts
    let fullText = "";
    let nativeThinking = "";
    let connected = false;
    let finished = false;
    const pending = new Map<string, PendingRequest>();
    // Track how many UI blocks have been emitted during streaming deltas.
    // Since blocks appear sequentially in the text and extractUIBlocks returns
    // them in order, we only emit blocks at index >= this count.
    let emittedBlockCount = 0;

    const ws = new WebSocket(wsUrl, {
      origin: `http://${ip}:${port}`,
      handshakeTimeout: 10_000, // 10s connect timeout - fail fast on unreachable pods
    });

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        log.warn({ wsUrl, timeoutMs, textLength: fullText.length }, "Gateway: response timed out");
        ws.close();
        if (fullText) {
          const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking, timedOut: true });
        } else {
          reject(new Error("Gateway chat timed out after 180s"));
        }
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    if (signal) {
      signal.addEventListener("abort", () => {
        finished = true;
        cleanup();
        reject(new Error("Aborted"));
      });
    }

    function sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
      const id = nanoid(8);
      const msg = { type: "req", id, method, params };
      ws.send(JSON.stringify(msg));
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
      });
    }

    ws.on("open", () => {
      const connectMs = Date.now() - connectStartMs;
      log.info({ wsUrl, connectMs }, "Gateway: WS connected");
    });

    ws.on("message", async (data) => {
      if (finished) return;

      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        log.warn({ wsUrl, rawData: String(data).slice(0, 200) }, "Gateway: failed to parse WS message");
        return;
      }

      // Debug: log all WS messages to understand streaming behavior
      log.info({ type: msg.type, event: msg.event, state: msg.payload?.state, connected }, "Gateway: WS msg");

      // ── Event messages ──
      if (msg.type === "event") {
        // Connect challenge - authenticate as Control UI with device identity.
        // Using "openclaw-control-ui" client ID + dangerouslyDisableDeviceAuth=true
        // in the gateway config allows full operator scopes without pairing approval.
        if (msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce;
          try {
            const device = createDeviceIdentity();
            const signedAtMs = Date.now();
            const role = "operator";
            const scopes = ["operator.read", "operator.write"];

            const payload = [
              "v2",
              device.deviceId,
              "openclaw-control-ui",
              "webchat",
              role,
              scopes.join(","),
              String(signedAtMs),
              gatewayToken || "",
              nonce || "",
            ].join("|");
            const signature = signPayload(device.privateKeyPem, payload);

            await sendRequest("connect", {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "openclaw-control-ui",
                version: "1.0",
                platform: "server",
                mode: "webchat",
                instanceId: "jarble-api",
              },
              role,
              scopes,
              caps: [],
              auth: { token: gatewayToken },
              device: {
                id: device.deviceId,
                publicKey: device.publicKeyB64,
                signature,
                signedAt: signedAtMs,
                nonce,
              },
            });

            connected = true;
            log.debug({ wsUrl }, "Gateway authenticated, sending chat");

            // Send the chat message
            const idempotencyKey = nanoid(12);
            sendRequest("chat.send", {
              sessionKey,
              message,
              deliver: false,
              idempotencyKey,
            }).catch((err) => {
              if (!finished) {
                finished = true;
                cleanup();
                reject(new Error(`chat.send failed: ${err.message}`));
              }
            });
          } catch (err: unknown) {
            finished = true;
            cleanup();
            reject(new Error(`Gateway auth failed: ${err instanceof Error ? err.message : String(err)}`));
          }
          return;
        }

        // Chat stream events
        if (msg.event === "chat" || msg.event === "chat.stream" || msg.payload?.state) {
          const payload = msg.payload || msg;
          const state = payload.state;

          if (state === "delta") {
            const text = extractText(payload.message);
            if (text) {
              fullText = text; // Delta sends the full accumulated text each time

              // Incrementally extract complete UI blocks from accumulated text
              // so the frontend can render them before the response finishes.
              if (onBlockDetected) {
                const { uiBlocks } = extractUIBlocks(fullText);
                // Only emit blocks we haven't seen before (new blocks at the end)
                for (let idx = emittedBlockCount; idx < uiBlocks.length; idx++) {
                  onBlockDetected(uiBlocks[idx]);
                }
                emittedBlockCount = uiBlocks.length;
              }

              onDelta?.(text);
            }
            // Accumulate native thinking from delta events
            const deltaThinking = extractThinking(payload);
            if (deltaThinking) nativeThinking = deltaThinking;
          } else if (state === "final") {
            const text = extractText(payload.message);
            if (text) {
              fullText = text;
            }
            // Extract native thinking from the final payload
            const finalThinking = extractThinking(payload);
            if (finalThinking) nativeThinking = finalThinking;
            finished = true;
            cleanup();
            const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(fullText);
            // Skip blocks already emitted during streaming deltas (they appear in order)
            const remainingBlocks = uiBlocks.slice(emittedBlockCount);
            log.debug({ wsUrl, rawTextLength: fullText.length, blockCount: uiBlocks.length, streamedBlockCount: emittedBlockCount, updateCount: uiUpdates.length, hasNativeThinking: !!nativeThinking }, "Gateway: response summary");
            resolve({ rawText: fullText, text: cleanText, uiBlocks: remainingBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking });
          } else if (state === "aborted") {
            finished = true;
            cleanup();
            const abortText = fullText || "The bot's response was interrupted.";
            const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(abortText);
            resolve({ rawText: abortText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking });
          }
        }

        return;
      }

      // ── Response messages ──
      if (msg.type === "res") {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error || msg.ok === false) {
            const errMsg = msg.error?.message || JSON.stringify(msg.error);
            log.debug({ wsUrl, msgId: msg.id, error: msg.error, ok: msg.ok, payload: msg.payload }, "Gateway response error");
            p.reject(new Error(errMsg));
          } else {
            log.debug({ wsUrl, msgId: msg.id, payloadKeys: msg.payload ? Object.keys(msg.payload) : null }, "Gateway response OK");
            p.resolve(msg.payload ?? msg.result);
          }
        }
        return;
      }
    });

    ws.on("error", (err) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(new Error(`Gateway WS error: ${err.message}`));
      }
    });

    ws.on("close", (code, reasonBuf) => {
      if (!finished) {
        finished = true;
        clearTimeout(timeout);
        const reason = reasonBuf?.toString() || "";
        if (fullText) {
          const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking });
        } else if (!connected) {
          const detail = reason ? ` (${code}: ${reason})` : code ? ` (code ${code})` : "";
          reject(new Error(`Gateway WS closed before auth completed${detail}`));
        } else {
          const detail = reason ? ` (${code}: ${reason})` : code ? ` (code ${code})` : "";
          reject(new Error(`Gateway WS closed before response completed${detail}`));
        }
      }
      for (const [, p] of pending) {
        p.reject(new Error("WS closed"));
      }
      pending.clear();
    });
  });
}

/**
 * Extract text content from an OpenClaw message payload.
 * Messages can be a string or an array of content blocks.
 */
function extractText(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text || "")
      .join("");
  }
  if (message && typeof message === "object") {
    const m = message as any;
    if (m.content) return extractText(m.content);
    if (m.text) return String(m.text);
  }
  return "";
}

/**
 * Extract native thinking/reasoning content from an OpenClaw message payload.
 *
 * OpenClaw's `--thinking medium` flag causes Claude to produce thinking blocks.
 * In `--json` mode these are sometimes stripped from the text payloads, but may
 * appear as separate content blocks with `type: "thinking"` in the message array,
 * or as a top-level `thinking` field on the payload/result object.
 *
 * This function checks all known locations where native thinking may appear.
 */
function extractThinking(payload: any): string {
  if (!payload) return "";

  // 1. Check explicit thinking field on the payload
  if (typeof payload.thinking === "string" && payload.thinking) return payload.thinking;

  // 2. Check content blocks for type: "thinking"
  const message = payload.message || payload.content || payload;
  if (Array.isArray(message)) {
    const thinking = message
      .filter((b: any) => b.type === "thinking")
      .map((b: any) => b.thinking || b.text || "")
      .join("\n")
      .trim();
    if (thinking) return thinking;
  }

  // 3. Check result.meta for thinking content
  if (payload.result?.meta?.thinking) return String(payload.result.meta.thinking);

  return "";
}

// ── HTTP Chat Completions (token-level streaming) ────────────────────────────

/**
 * Chat via OpenClaw's OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Uses standard SSE streaming for true token-by-token delivery.
 * This is the fastest path - direct HTTP to the pod with Bearer token auth.
 */
export async function chatViaHTTP(
  opts: GatewayOptions,
  message: string,
  sessionKey: string,
  onDelta?: (fullText: string) => void,
  signal?: AbortSignal,
  onBlockDetected?: (block: JarbleUIBlock) => void,
): Promise<GatewayResponse> {
  // JAR-51 Phase 3 follow-up: wrap chatViaHTTP in an OTel span. This is
  // actually the PRIMARY delegation path (tamboAgent tries HTTP first,
  // then falls back to WS gateway, then to exec). Before this wrapper,
  // every successful chat turn was invisible in Langfuse at the delegation
  // layer — only the rare fallback-to-exec traces showed jarble.delegation.*
  // spans. Now every primary-path chat produces a "jarble.delegation.http"
  // span with pod/session/message attributes.
  return tracer.startActiveSpan(
    "jarble.delegation.http",
    {
      attributes: {
        "jarble.pod.ip": opts.ip,
        "jarble.pod.port": opts.port,
        "jarble.session.key": sessionKey,
        "jarble.message.length": message.length,
        "jarble.runtime": "openclaw",
        "jarble.transport": "http",
      },
    },
    async (span) => {
      try {
        return await chatViaHTTPInner(opts, message, sessionKey, onDelta, signal, onBlockDetected);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

async function chatViaHTTPInner(
  opts: GatewayOptions,
  message: string,
  sessionKey: string,
  onDelta?: (fullText: string) => void,
  signal?: AbortSignal,
  onBlockDetected?: (block: JarbleUIBlock) => void,
): Promise<GatewayResponse> {
  const { ip, port, gatewayToken } = opts;
  const url = `http://${ip}:${port}/v1/chat/completions`;

  log.info({ url }, "chatViaHTTP: starting streaming request");

  // 3 min timeout - matches gateway WS timeout; prevents hanging forever if
  // the pod accepts the connection but the LLM never responds.
  const httpTimeoutMs = 180_000;
  const timeoutSignal = AbortSignal.timeout(httpTimeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Inject W3C traceparent as an HTTP header so an OpenClaw gateway
  // that understands context propagation can root its server-side span
  // under our trace. Also include JARBLE_CURRENT_SESSION_ID as a
  // custom header so server-side code can consult it. OpenClaw today
  // doesn't read either of these, but sending them is free and is
  // forward-compatible with Phase 6 of the observability plan.
  const traceHeaders = getW3CTraceHeaders();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${gatewayToken}`,
      "X-Session-Key": sessionKey,
      "X-Jarble-Session-Id": sessionKey,
      ...(traceHeaders.traceparent ? { "traceparent": traceHeaders.traceparent } : {}),
      ...(traceHeaders.tracestate ? { "tracestate": traceHeaders.tracestate } : {}),
    },
    body: JSON.stringify({
      model: "default",
      messages: [{ role: "user", content: message }],
      stream: true,
    }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP chat completions failed: ${res.status} ${body.slice(0, 200)}`);
  }

  let fullText = "";
  let nativeThinking = "";
  let emittedBlockCount = 0;
  let isInsideThinkTag = false;
  const toolCallBuffers: Record<number, { name: string; args: string }> = {};
  let tokenUsageFromStream: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            let content = delta.content;

            // Strip thinking tags using a depth counter to handle nesting
            // and unclosed tags. Processes the string char-by-char scanning
            // for <think> and </think> markers, keeping only content at
            // depth 0 (visible to the user).
            {
              let cleaned = "";
              let i = 0;
              let thinkDepth: number = isInsideThinkTag ? 1 : 0;
              while (i < content.length) {
                if (content.startsWith("<think>", i)) {
                  thinkDepth++;
                  i += 7;
                } else if (content.startsWith("</think>", i)) {
                  if (thinkDepth > 0) thinkDepth--;
                  i += 8;
                } else {
                  if (thinkDepth === 0) cleaned += content[i];
                  i++;
                }
              }
              isInsideThinkTag = thinkDepth > 0;
              content = cleaned;
            }

            if (content) {
              fullText += content;
              onDelta?.(fullText);

              // Incrementally detect UI blocks during streaming
              if (onBlockDetected) {
                const { uiBlocks } = extractUIBlocks(fullText);
                for (let idx = emittedBlockCount; idx < uiBlocks.length; idx++) {
                  onBlockDetected(uiBlocks[idx]);
                }
                emittedBlockCount = uiBlocks.length;
              }
            }
          }

          // Track tool call argument accumulation.
          // OpenClaw delivers jarble_ui blocks as function calls in the completions API.
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallBuffers[idx]) {
                toolCallBuffers[idx] = { name: "", args: "" };
              }
              if (tc.function?.name) {
                toolCallBuffers[idx].name = tc.function.name;
              }
              if (tc.function?.arguments) {
                toolCallBuffers[idx].args += tc.function.arguments;
              }
            }
          }

          // Flush accumulated tool calls when the response finishes
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (finishReason === "tool_calls" || finishReason === "stop") {
            for (const tc of Object.values(toolCallBuffers)) {
              if (tc.name === "render_ui" || tc.name?.startsWith("show_")) {
                try {
                  const props = JSON.parse(tc.args);
                  const component = props.component || tc.name.replace("show_", "");
                  const block = { component, props: props.props || props, id: props.id };
                  // Append as fenced block to fullText so extractAllUIBlocks picks it up
                  fullText += `\n\`\`\`jarble_ui\n${JSON.stringify(block)}\n\`\`\`\n`;
                } catch {
                  // Skip unparseable tool calls
                }
              }
            }
          }

          // Extract token usage from the final chunk
          if (chunk.usage) {
            tokenUsageFromStream = {
              inputTokens: chunk.usage.prompt_tokens || 0,
              outputTokens: chunk.usage.completion_tokens || 0,
              totalTokens: chunk.usage.total_tokens || 0,
            };
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } catch (err: unknown) {
    // Distinguish timeout from caller abort - TimeoutError comes from AbortSignal.timeout()
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    if (isTimeout) {
      log.warn({ url, httpTimeoutMs, textLength: fullText.length }, "chatViaHTTP: response timed out");
      // If we have partial text, return it gracefully (same as gateway behavior)
      if (fullText) {
        const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(fullText);
        return { rawText: fullText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking, timedOut: true, tokenUsage: tokenUsageFromStream };
      }
      throw new Error(`HTTP chat timed out after ${httpTimeoutMs / 1000}s`);
    }
    // Re-throw caller aborts and other errors as-is
    throw err;
  }

  // Warn if the stream ended inside an unclosed <think> tag — model
  // output was silently suppressed, which looks like an empty response.
  if (isInsideThinkTag) {
    log.warn({ url, textLength: fullText.length }, "chatViaHTTP: stream ended with unclosed <think> tag — some content may have been suppressed");
  }

  if (!fullText) {
    throw new Error("HTTP chat completions returned empty response");
  }

  const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(fullText);

  // Skip blocks already emitted during streaming deltas (they appear in order).
  // This mirrors the WS gateway path which returns uiBlocks.slice(emittedBlockCount).
  // Without this, emitGatewayResult re-emits TOOL_CALL events for blocks that
  // onBlockDetected already sent, causing duplicate cards on the canvas.
  const remainingBlocks = uiBlocks.slice(emittedBlockCount);

  log.info({ url, textLength: fullText.length, blockCount: uiBlocks.length, streamedBlockCount: emittedBlockCount, remainingBlockCount: remainingBlocks.length }, "chatViaHTTP: complete");

  return { rawText: fullText, text: cleanText, uiBlocks: remainingBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking, tokenUsage: tokenUsageFromStream };
}

// ── Exec-based fallback ─────────────────────────────────────────────────

/**
 * Chat via `npx openclaw agent` exec'd inside the pod.
 *
 * Fallback for when the API can't reach pod IPs directly (local dev outside
 * the cluster). Runs the OpenClaw CLI inside the pod via K8s exec API.
 *
 * Not streaming (response arrives all at once), but works from anywhere
 * since exec goes through the K8s API server, not direct pod networking.
 */
export async function chatViaExec(
  podName: string,
  sessionKey: string,
  message: string,
  onDelta?: (fullText: string) => void,
  canvasImage?: string,
  signal?: AbortSignal,
): Promise<GatewayResponse> {
  // JAR-51 Phase 3: wrap the exec in an explicit span so delegation hops
  // show up as first-class spans in Langfuse. All the real work runs
  // inside startActiveSpan so child spans (DB, fetch, etc.) attach
  // automatically.
  return tracer.startActiveSpan(
    "jarble.delegation.exec",
    {
      attributes: {
        "jarble.pod.name": podName,
        "jarble.session.key": sessionKey,
        "jarble.message.length": message.length,
        "jarble.has_image": Boolean(canvasImage),
        "jarble.runtime": "openclaw",
      },
    },
    async (span) => {
      try {
        return await chatViaExecInner(podName, sessionKey, message, onDelta, canvasImage, signal, span);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

async function chatViaExecInner(
  podName: string,
  sessionKey: string,
  message: string,
  onDelta?: (fullText: string) => void,
  canvasImage?: string,
  signal?: AbortSignal,
  span?: import("@opentelemetry/api").Span,
): Promise<GatewayResponse> {
  log.info({ podName, messageLen: message.length, hasImage: !!canvasImage }, "chatViaExec: starting");

  // Bail early if already aborted (e.g. user cancelled during WS→exec fallback transition)
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  // If canvas image is provided, write it to a temp file on the pod so it persists for the session
  if (canvasImage) {
    try {
      // Strip data URL prefix to get raw base64
      const base64Data = canvasImage.replace(/^data:image\/\w+;base64,/, "");
      // Validate that it's actually base64 to prevent shell injection
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
        log.warn({ podName }, "chatViaExec: canvas image contains invalid base64 characters, skipping");
      } else {
        // Write to pod filesystem via stdin pipe (safe - no shell interpolation)
        const { execInPodWithStdin } = await import("../k8s/exec.js");
        await execInPodWithStdin(podName, [
          "sh", "-c", "base64 -d > /tmp/canvas-screenshot.jpg",
        ], base64Data, 10_000);
        log.debug({ podName }, "chatViaExec: canvas screenshot written to pod");
      }
    } catch (err) {
      log.warn({ podName, err: (err as Error).message }, "chatViaExec: failed to write canvas screenshot to pod");
    }
  }

  // Pass --thinking medium for higher quality answers. OpenClaw 2026.2.x strips
  // native thinking from --json output, so it's not visible in the response.
  // For user-facing reasoning display, the system prompt instructs the bot to emit
  // <think> tags which tamboAgent.ts parses into REASONING_* SSE events.
  //
  // JAR-51 Phase 3: prepend `env TRACEPARENT=...` (and tracestate if present)
  // so a traceparent-aware openclaw runtime can attach its child spans
  // to the current trace. Also inject JARBLE_CURRENT_SESSION_ID so the
  // jarble-ui MCP server (which spawns fresh node processes via mcporter)
  // can resolve memory-scope=session calls without bot-side compliance
  // on session_id. The env var cascades: env → openclaw → mcporter → node.
  // When no active OTel context, the carrier is empty and we skip
  // TRACEPARENT; SESSION_ID is injected unconditionally because the bot
  // always has a session at this point.
  const traceHeaders = getW3CTraceHeaders();
  const envPrefix: string[] = [];
  const envAssignments: string[] = [];
  if (traceHeaders.traceparent) {
    envAssignments.push(`TRACEPARENT=${traceHeaders.traceparent}`);
    if (traceHeaders.tracestate) {
      envAssignments.push(`TRACESTATE=${traceHeaders.tracestate}`);
    }
    span?.setAttribute("jarble.traceparent.injected", true);
  }
  envAssignments.push(`JARBLE_CURRENT_SESSION_ID=${sessionKey}`);
  if (envAssignments.length > 0) {
    envPrefix.push("env", ...envAssignments);
  }

  const args = [
    ...envPrefix,
    "npx", "openclaw", "agent",
    "--message", message,
    "--session-id", sessionKey,
    "--thinking", "medium",
    "--json",
    "--timeout", "120",
  ];
  // If image was written, add --image flag (OpenClaw 2026.2.25+ supports this)
  if (canvasImage) {
    args.push("--image", "/tmp/canvas-screenshot.jpg");
  }
  // Race the exec against the abort signal so user cancellation stops it promptly.
  // 150s = 120s CLI timeout + 30s buffer for cold start and exec overhead.
  // Previous 60s/90s timeouts caused delegation failures on complex rendering tasks.
  const execPromise = execInPod(podName, args, undefined, 150_000);
  let output: string;
  if (signal) {
    output = await Promise.race([
      execPromise,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("Aborted"));
        signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      }),
    ]);
  } else {
    output = await execPromise;
  }

  // Parse JSON response (same as chatWithBot MCP tool)
  let parsed: any;
  try {
    parsed = JSON.parse(output);
  } catch {
    const jsonStart = output.indexOf("{");
    if (jsonStart >= 0) {
      parsed = JSON.parse(output.slice(jsonStart));
    } else {
      throw new Error("Bot returned a non-JSON response");
    }
  }

  const payloads = parsed.result?.payloads || parsed.payloads || [];
  log.debug({
    podName,
    payloadCount: payloads.length,
    model: parsed.result?.meta?.agentMeta?.model,
    parsedKeys: Object.keys(parsed.result || parsed),
  }, "chatViaExec: response structure");

  let rawText = payloads.map((p: any) => p.text || "").join("\n").trim();

  if (!rawText) {
    throw new Error("Bot returned an empty response");
  }

  // Detect error-shaped replies that OpenClaw surfaces as pseudo-text payloads
  // when its upstream LLM call fails (bad API key → "401 Missing Authentication
  // header", provider timeout → "Error: ...", etc.). Without this, the error
  // string is treated as a valid bot reply, streamed to the user, and
  // persisted in chat history. The Dev deployment's three persisted
  // "401 Missing Authentication header" messages from Cycle 1 are the exact
  // symptom this prevents. See P0-A follow-up + isErrorShapedBotReply docs.
  const { isErrorShapedBotReply } = await import("../utils/botResponseErrorShape.js");
  if (isErrorShapedBotReply(rawText)) {
    log.warn(
      { podName, errShapePreview: rawText.slice(0, 200) },
      "chatViaExec: bot response is error-shaped — treating as upstream LLM failure",
    );
    // Throw so the caller's catch branch (classifyError + user-friendly
    // suggestion) runs instead of persisting this as an assistant message.
    // The thrown error itself is then run through sanitizeDelegationError
    // at the route layer (Cycles 2 + 8 fixes).
    throw new Error(`Upstream LLM error: ${rawText.slice(0, 200)}`);
  }

  // Strip inline <think>...</think> tags from the exec response text.
  // OpenClaw's --thinking flag puts reasoning in agentMeta, but some models
  // (especially via OpenRouter) emit <think> tags inline in the text field.
  // The depth-based parser handles nesting and unclosed tags.
  {
    let cleaned = "";
    let i = 0;
    let thinkDepth = 0;
    while (i < rawText.length) {
      if (rawText.startsWith("<think>", i) || rawText.startsWith("<think\n", i) || rawText.startsWith("<think ", i)) {
        thinkDepth++;
        const closeTag = rawText.indexOf(">", i);
        i = closeTag >= 0 ? closeTag + 1 : i + 7;
      } else if (rawText.startsWith("</think>", i)) {
        if (thinkDepth > 0) thinkDepth--;
        i += 8;
      } else {
        if (thinkDepth === 0) cleaned += rawText[i];
        i++;
      }
    }
    if (cleaned !== rawText) {
      log.debug({ podName, originalLen: rawText.length, cleanedLen: cleaned.length }, "chatViaExec: stripped inline think tags");
      rawText = cleaned.trim();
    }
  }

  // Extract native thinking from the OpenClaw JSON response.
  // Check multiple locations: top-level, result, individual payloads, and meta.
  let nativeThinking = "";
  // Check the parsed result object itself
  const topThinking = extractThinking(parsed.result || parsed);
  if (topThinking) nativeThinking = topThinking;
  // Check individual payloads for thinking content blocks
  if (!nativeThinking) {
    for (const p of payloads) {
      const payloadThinking = extractThinking(p);
      if (payloadThinking) {
        nativeThinking += (nativeThinking ? "\n" : "") + payloadThinking;
      }
    }
  }

  if (nativeThinking) {
    log.debug({ podName, thinkingLen: nativeThinking.length }, "chatViaExec: extracted native thinking");
  }

  // Deliver the full text as a single "delta" so the caller can emit it
  onDelta?.(rawText);

  // Debug: log the tail of rawText to diagnose block extraction failures
  const hasJarbleUiFence = rawText.includes("```jarble_ui");
  const endsWithClosingFence = rawText.trimEnd().endsWith("```");
  log.debug({ podName, hasJarbleUiFence, endsWithClosingFence, tail: rawText.slice(-200) }, "chatViaExec: raw text tail");

  const { cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext } = extractAllUIBlocks(rawText);

  // Cost Transparency Phase 1: extract token usage from the exec response.
  // OpenClaw's --json output includes `result.meta.agentMeta.usage` with
  // input/output/cacheRead/cacheWrite/total token counts. This lets
  // flowDelegation calculate real cost instead of hardcoding 1.
  const agentMeta = parsed.result?.meta?.agentMeta;
  const tokenUsage = agentMeta?.usage ? {
    inputTokens: Number(agentMeta.usage.input ?? agentMeta.usage.promptTokens ?? 0),
    outputTokens: Number(agentMeta.usage.output ?? agentMeta.usage.completionTokens ?? 0),
    totalTokens: Number(agentMeta.usage.total ?? 0),
    cacheReadTokens: Number(agentMeta.usage.cacheRead ?? 0),
    cacheWriteTokens: Number(agentMeta.usage.cacheWrite ?? 0),
    model: agentMeta.model || undefined,
  } : undefined;

  log.debug({ podName, rawTextLength: rawText.length, blockCount: uiBlocks.length, updateCount: uiUpdates.length, hasNativeThinking: !!nativeThinking, tokenUsage: tokenUsage ? { in: tokenUsage.inputTokens, out: tokenUsage.outputTokens } : null }, "chatViaExec: response summary");
  return { rawText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking, tokenUsage };
}
