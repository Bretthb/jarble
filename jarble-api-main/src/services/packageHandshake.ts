/**
 * Package install handshake — performs the HTTP handshake with a remote
 * package creator's API endpoint during installation.
 *
 * The handshake POSTs an install request with the buyer's deployment ID
 * and an HMAC signing secret. The creator's endpoint responds with
 * an install ID and optional proxyUrl for skill routing.
 */
import crypto from "crypto";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("packageHandshake");

export interface HandshakeRequest {
  endpoint: string;
  packageId: string;
  deploymentId: string;
  signingSecret: string;
}

export interface HandshakeResponse {
  remoteInstallId?: string;
  proxyUrl?: string;
}

/**
 * Perform the install handshake POST to the creator's endpoint.
 *
 * Sends a JSON body with:
 *   - action: "install"
 *   - packageId: the package being installed
 *   - deploymentId: the buyer's deployment
 *   - timestamp: ISO 8601 timestamp
 *   - signature: HMAC-SHA256(body, signingSecret)
 *
 * Expects a JSON response with:
 *   - installId: string (unique ID for this install on the creator's side)
 *   - proxyUrl?: string (optional URL for skill API proxying)
 */
export async function performInstallHandshake(
  request: HandshakeRequest,
): Promise<HandshakeResponse> {
  const { endpoint, packageId, deploymentId, signingSecret } = request;

  const body = JSON.stringify({
    action: "install",
    packageId,
    deploymentId,
    timestamp: new Date().toISOString(),
  });

  // Sign the body with HMAC-SHA256
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(body)
    .digest("hex");

  log.info({ endpoint, packageId, deploymentId }, "Performing install handshake");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Jarble-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Handshake failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  const result = await response.json() as Record<string, unknown>;

  return {
    remoteInstallId: typeof result.installId === "string" ? result.installId : undefined,
    proxyUrl: typeof result.proxyUrl === "string" ? result.proxyUrl : undefined,
  };
}
