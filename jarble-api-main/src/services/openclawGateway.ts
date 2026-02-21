/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to the OpenClaw gateway running inside a pod and sends
 * chat messages via the WS JSON-RPC protocol.
 *
 * Protocol:
 *   1. WS connect → server sends { type: "event", event: "connect.challenge", payload: { nonce } }
 *   2. Client sends { type: "req", id, method: "connect", params: { minProtocol: 3, ... auth: { token } } }
 *   3. Server sends { type: "res", id, result: { auth: ... } } (hello)
 *   4. Client sends { type: "req", id, method: "chat.send", params: { sessionKey, message, deliver: false } }
 *   5. Server sends events with state: "delta" (streaming text) and state: "final" (done)
 */

import WebSocket from "ws";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

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
 * Opens a WS connection, authenticates, sends the message, collects delta events
 * until the final event, then closes. Returns the full bot response text.
 */
export async function chatViaGateway(
  opts: GatewayOptions,
  message: string,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { ip, port, gatewayToken, sessionKey } = opts;
  const wsUrl = `ws://${ip}:${port}`;

  return new Promise<string>((resolve, reject) => {
    const timeoutMs = 45_000;
    let fullText = "";
    let connected = false;
    let finished = false;
    const pending = new Map<string, PendingRequest>();

    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        ws.close();
        if (fullText) {
          resolve(fullText);
        } else {
          reject(new Error("Gateway chat timed out after 45s"));
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
      logger.debug({ wsUrl }, "Gateway WS connected, waiting for challenge");
    });

    ws.on("message", async (data) => {
      if (finished) return;

      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      // ── Event messages ──
      if (msg.type === "event") {
        // Connect challenge — send auth
        if (msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce;
          try {
            await sendRequest("connect", {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "jarble-api",
                version: "1.0",
                platform: "server",
                mode: "webchat",
                instanceId: nanoid(8),
              },
              role: "operator",
              scopes: ["operator.admin"],
              ...(gatewayToken ? { auth: { token: gatewayToken } } : {}),
              caps: [],
              ...(nonce ? { nonce } : {}),
            });

            connected = true;
            logger.debug({ wsUrl }, "Gateway authenticated, sending chat message");

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
          } catch (err: any) {
            finished = true;
            cleanup();
            reject(new Error(`Gateway auth failed: ${err.message}`));
          }
          return;
        }

        // Chat stream events
        if (msg.event === "chat.stream" || msg.payload?.state) {
          const payload = msg.payload || msg;
          const state = payload.state;

          if (state === "delta") {
            // Extract text from the message payload
            const text = extractText(payload.message);
            if (text) {
              fullText = text; // Delta sends the full accumulated text each time
              onDelta?.(text);
            }
          } else if (state === "final") {
            const text = extractText(payload.message);
            if (text) {
              fullText = text;
            }
            finished = true;
            cleanup();
            resolve(fullText);
          } else if (state === "aborted") {
            finished = true;
            cleanup();
            resolve(fullText || "The bot's response was interrupted.");
          }
        }

        return;
      }

      // ── Response messages ──
      if (msg.type === "res") {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
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

    ws.on("close", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeout);
        if (fullText) {
          resolve(fullText);
        } else if (!connected) {
          reject(new Error("Gateway WS closed before auth completed"));
        } else {
          reject(new Error("Gateway WS closed before response completed"));
        }
      }
      // Reject any pending requests
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
    // Could be { content: [...] } or { text: "..." }
    if (m.content) return extractText(m.content);
    if (m.text) return String(m.text);
  }
  return "";
}
