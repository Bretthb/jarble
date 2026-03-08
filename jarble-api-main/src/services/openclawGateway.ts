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
import { logger } from "../utils/logger.js";
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
  /** Accumulated thinking/reasoning text from the LLM (if supported) */
  thinkingText?: string;
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
        logger.warn({ wsUrl, timeoutMs, textLength: fullText.length }, "Gateway: response timed out");
        ws.close();
        if (fullText) {
          const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks, uiUpdates, componentDefs });
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
      logger.info({ wsUrl, connectMs }, "Gateway: WS connected");
    });

    ws.on("message", async (data) => {
      if (finished) return;

      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        logger.warn({ wsUrl, rawData: String(data).slice(0, 200) }, "Gateway: failed to parse WS message");
        return;
      }

      // ── Event messages ──
      if (msg.type === "event") {
        // Connect challenge — send auth with device identity
        if (msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce;
          try {
            const device = createDeviceIdentity();
            const signedAtMs = Date.now();
            const clientId = "webchat";
            const mode = "webchat";
            const role = "operator";
            const scopes = [
              "operator.admin",
              "operator.write",
              "operator.read",
              "operator.approvals",
              "operator.pairing",
            ];

            // Build signed payload: v2|deviceId|clientId|mode|role|scopes|signedAt|token|nonce
            const payload = [
              "v2",
              device.deviceId,
              clientId,
              mode,
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
                id: clientId,
                version: "1.0",
                platform: "server",
                mode,
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
            logger.debug({ wsUrl, deviceId: device.deviceId.slice(0, 16) }, "Gateway authenticated with device identity, sending chat");

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
          } else if (state === "final") {
            const text = extractText(payload.message);
            if (text) {
              fullText = text;
            }
            finished = true;
            cleanup();
            const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(fullText);
            // Skip blocks already emitted during streaming deltas (they appear in order)
            const remainingBlocks = uiBlocks.slice(emittedBlockCount);
            logger.debug({ wsUrl, rawTextLength: fullText.length, blockCount: uiBlocks.length, streamedBlockCount: emittedBlockCount, updateCount: uiUpdates.length }, "Gateway: response summary");
            resolve({ rawText: fullText, text: cleanText, uiBlocks: remainingBlocks, uiUpdates, componentDefs });
          } else if (state === "aborted") {
            finished = true;
            cleanup();
            const abortText = fullText || "The bot's response was interrupted.";
            const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(abortText);
            resolve({ rawText: abortText, text: cleanText, uiBlocks, uiUpdates, componentDefs });
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
            logger.debug({ wsUrl, msgId: msg.id, error: msg.error, ok: msg.ok, payload: msg.payload }, "Gateway response error");
            p.reject(new Error(errMsg));
          } else {
            logger.debug({ wsUrl, msgId: msg.id, payloadKeys: msg.payload ? Object.keys(msg.payload) : null }, "Gateway response OK");
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
          const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks, uiUpdates, componentDefs });
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

// ── HTTP Chat Completions ────────────────────────────────────────────────────

/**
 * Chat via the OpenClaw HTTP chat completions endpoint.
 *
 * Uses the OpenAI-compatible `/v1/chat/completions` endpoint exposed by the
 * gateway. This bypasses WS device pairing entirely — only the gateway auth
 * token is needed. Supports SSE streaming for incremental text delivery.
 */
export async function chatViaHttp(
  opts: GatewayOptions,
  message: string,
  onDelta?: (fullText: string) => void,
  signal?: AbortSignal,
  onBlockDetected?: (block: JarbleUIBlock) => void,
  onThinking?: (fullThinkingText: string) => void,
): Promise<GatewayResponse> {
  const { ip, port, gatewayToken, sessionKey } = opts;
  const url = `http://${ip}:${port}/v1/chat/completions`;
  const streamingDisabled = process.env.DISABLE_HTTP_STREAMING === "true";

  logger.info({ url, messageLen: message.length, sessionKey, streaming: !streamingDisabled }, "chatViaHttp: sending request");

  const body = JSON.stringify({
    model: "default",
    messages: [{ role: "user", content: message }],
    stream: !streamingDisabled,
    // Pass session key as metadata so conversations persist
    ...(sessionKey ? { user: sessionKey } : {}),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gatewayToken}`,
    },
    body,
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`HTTP chat failed: ${response.status} ${errText.slice(0, 200)}`);
  }

  // ── Non-streaming fallback ──────────────────────────────────────────────────
  if (streamingDisabled) {
    const json = await response.json() as any;
    const fullText = json.choices?.[0]?.message?.content || "";
    const thinkingText = json.choices?.[0]?.message?.reasoning_content
                      || json.choices?.[0]?.message?.reasoning || "";

    if (!fullText) {
      logger.warn({ url, json }, "chatViaHttp: empty response from bot");
    }

    onDelta?.(fullText);
    if (thinkingText) onThinking?.(thinkingText);

    const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(fullText);
    if (onBlockDetected) {
      for (const block of uiBlocks) {
        onBlockDetected(block);
      }
    }
    logger.info({ url, rawTextLength: fullText.length, blockCount: uiBlocks.length }, "chatViaHttp: non-streaming response");
    return { rawText: fullText, text: cleanText, uiBlocks: [], uiUpdates, componentDefs, thinkingText: thinkingText || undefined };
  }

  // ── Streaming SSE reader ────────────────────────────────────────────────────
  if (!response.body) {
    throw new Error("HTTP chat: response body is null (streaming not supported?)");
  }

  const reader = (response.body as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  let thinkingText = "";
  let emittedBlockCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        if (trimmed === "data: [DONE]") continue;

        let chunk: any;
        try {
          chunk = JSON.parse(trimmed.slice(6));
        } catch {
          logger.debug({ line: trimmed.slice(0, 200) }, "chatViaHttp: failed to parse SSE chunk");
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Text content delta
        const delta = choice.delta?.content || "";
        if (delta) {
          fullText += delta;
          onDelta?.(fullText);
        }

        // Thinking/reasoning delta (OpenAI/OpenRouter format)
        const reasoningDelta = choice.delta?.reasoning_content
                            || choice.delta?.reasoning || "";
        if (reasoningDelta) {
          thinkingText += reasoningDelta;
          onThinking?.(thinkingText);
        }

        // Incremental UI block detection
        if (onBlockDetected && fullText) {
          const { uiBlocks } = extractUIBlocks(fullText);
          for (let idx = emittedBlockCount; idx < uiBlocks.length; idx++) {
            onBlockDetected(uiBlocks[idx]);
          }
          emittedBlockCount = uiBlocks.length;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText) {
    logger.warn({ url }, "chatViaHttp: empty streaming response from bot");
  }

  const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(fullText);
  // Only emit blocks not already emitted during streaming
  const remainingBlocks = uiBlocks.slice(emittedBlockCount);
  if (onBlockDetected) {
    for (const block of remainingBlocks) {
      onBlockDetected(block);
    }
  }

  logger.info({ url, rawTextLength: fullText.length, blockCount: uiBlocks.length, streamedBlockCount: emittedBlockCount, hasThinking: !!thinkingText }, "chatViaHttp: streaming response summary");
  return { rawText: fullText, text: cleanText, uiBlocks: remainingBlocks, uiUpdates, componentDefs, thinkingText: thinkingText || undefined };
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
): Promise<GatewayResponse> {
  logger.info({ podName, messageLen: message.length }, "chatViaExec: falling back to npx openclaw agent");

  const output = await execInPod(podName, [
    "npx", "openclaw", "agent",
    "--message", message,
    "--session-id", sessionKey,
    "--json",
    "--timeout", "60",
  ]);

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
  const rawText = payloads.map((p: any) => p.text || "").join("\n").trim();

  if (!rawText) {
    throw new Error("Bot returned an empty response");
  }

  // Deliver the full text as a single "delta" so the caller can emit it
  onDelta?.(rawText);

  const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(rawText);
  logger.debug({ podName, rawTextLength: rawText.length, blockCount: uiBlocks.length, updateCount: uiUpdates.length }, "chatViaExec: response summary");
  return { rawText, text: cleanText, uiBlocks, uiUpdates, componentDefs };
}
