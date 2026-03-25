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
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("gateway");
import { extractAllUIBlocks, extractUIBlocks, type JarbleUIBlock, type JarbleUIUpdate, type JarbleComponentDef } from "../utils/uiBlockParser.js";
import { execInPod } from "../k8s/exec.js";

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
}

export async function chatViaGateway(
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
    const timeoutMs = 120_000;
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
      handshakeTimeout: 10_000, // 10s connect timeout — fail fast on unreachable pods
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
          reject(new Error("Gateway chat timed out after 120s"));
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

      // ── Event messages ──
      if (msg.type === "event") {
        // Connect challenge — auth with token only (no device identity)
        // OpenClaw's roleCanSkipDeviceIdentity allows operators with valid
        // gateway tokens to connect without device pairing.
        if (msg.event === "connect.challenge") {
          try {
            await sendRequest("connect", {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "webchat",
                version: "1.0",
                platform: "server",
                mode: "webchat",
                instanceId: "jarble-api",
              },
              role: "operator",
              scopes: [],
              caps: [],
              auth: { token: gatewayToken },
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

// ── Exec-based HTTP fallback ─────────────────────────────────────────────────

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
        // Write to pod filesystem via stdin pipe (safe — no shell interpolation)
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
  const args = [
    "npx", "openclaw", "agent",
    "--message", message,
    "--session-id", sessionKey,
    "--thinking", "medium",
    "--json",
    "--timeout", "60",
  ];
  // If image was written, add --image flag (OpenClaw 2026.2.25+ supports this)
  if (canvasImage) {
    args.push("--image", "/tmp/canvas-screenshot.jpg");
  }
  // Race the exec against the abort signal so user cancellation stops it promptly
  const execPromise = execInPod(podName, args, undefined, 90_000); // 90s — cold start + LLM generation can take 30-60s
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

  const rawText = payloads.map((p: any) => p.text || "").join("\n").trim();

  if (!rawText) {
    throw new Error("Bot returned an empty response");
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
  log.debug({ podName, rawTextLength: rawText.length, blockCount: uiBlocks.length, updateCount: uiUpdates.length, hasNativeThinking: !!nativeThinking }, "chatViaExec: response summary");
  return { rawText, text: cleanText, uiBlocks, uiUpdates, componentDefs, suggestions, designContext, nativeThinking };
}
