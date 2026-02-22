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
import { extractUIBlocks, type JarbleUIBlock } from "../utils/uiBlockParser.js";

// ── Device Identity ─────────────────────────────────────────────────────────

/** Singleton device identity — generated once per API process */
let deviceIdentity: {
  deviceId: string;
  publicKeyB64: string;
  publicKeyPem: string;
  privateKeyPem: string;
} | null = null;

function getDeviceIdentity() {
  if (deviceIdentity) return deviceIdentity;

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

  deviceIdentity = { deviceId, publicKeyB64, publicKeyPem, privateKeyPem };
  logger.info({ deviceId: deviceId.slice(0, 16) }, "Generated gateway device identity");
  return deviceIdentity;
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
}

export async function chatViaGateway(
  opts: GatewayOptions,
  message: string,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<GatewayResponse> {
  const { ip, port, gatewayToken, sessionKey } = opts;
  const wsUrl = `ws://${ip}:${port}`;

  return new Promise<GatewayResponse>((resolve, reject) => {
    const timeoutMs = 120_000;
    let fullText = "";
    let connected = false;
    let finished = false;
    const pending = new Map<string, PendingRequest>();

    const ws = new WebSocket(wsUrl, { origin: "http://localhost" });

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        ws.close();
        if (fullText) {
          const { cleanText, uiBlocks } = extractUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks });
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
        // Connect challenge — send auth with device identity
        if (msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce;
          try {
            const device = getDeviceIdentity();
            const signedAtMs = Date.now();
            const clientId = "gateway-client";
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
            logger.debug({ wsUrl }, "Gateway authenticated with device identity, sending chat");

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
        if (msg.event === "chat" || msg.event === "chat.stream" || msg.payload?.state) {
          const payload = msg.payload || msg;
          const state = payload.state;

          if (state === "delta") {
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
            const { cleanText, uiBlocks } = extractUIBlocks(fullText);
            resolve({ rawText: fullText, text: cleanText, uiBlocks });
          } else if (state === "aborted") {
            finished = true;
            cleanup();
            const abortText = fullText || "The bot's response was interrupted.";
            const { cleanText, uiBlocks } = extractUIBlocks(abortText);
            resolve({ rawText: abortText, text: cleanText, uiBlocks });
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
            p.reject(new Error(errMsg));
          } else {
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

    ws.on("close", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeout);
        if (fullText) {
          const { cleanText, uiBlocks } = extractUIBlocks(fullText);
          resolve({ rawText: fullText, text: cleanText, uiBlocks });
        } else if (!connected) {
          reject(new Error("Gateway WS closed before auth completed"));
        } else {
          reject(new Error("Gateway WS closed before response completed"));
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
