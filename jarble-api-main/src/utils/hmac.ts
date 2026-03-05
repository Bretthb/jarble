/**
 * HMAC-SHA256 signing and verification utilities for webhook/callback security.
 *
 * Used to authenticate requests between Jarble components (e.g. pod → API
 * config-changed callbacks, remote package health pings, creator API webhooks).
 *
 * Signature format: "sha256=<hex>"
 * Payload format:   "<timestamp>.<body>"
 *
 * The timestamp-in-payload approach (same as Stripe and GitHub webhooks)
 * prevents replay attacks without requiring stateful nonce tracking.
 */
import crypto from "crypto";

const HMAC_ALGORITHM = "sha256";

/** Maximum allowed clock skew between sender and receiver (5 minutes). */
export const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

/**
 * Generate a new random signing secret (32 bytes, hex-encoded = 64 chars).
 *
 * Store the result in your DB or K8s Secret. Generate once per resource.
 *
 * @example
 *   const secret = generateSigningSecret();
 *   // "a3f8c2d1e4b7a09f..." (64 hex chars)
 */
export function generateSigningSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Sign a request body with a signing secret.
 *
 * The payload is `${timestamp}.${body}` where `timestamp` is Unix ms.
 * Attach the returned value as the `X-Jarble-Signature` header (or similar).
 *
 * @param secret    - Hex-encoded 32-byte signing secret.
 * @param timestamp - Unix timestamp in milliseconds (use `Date.now()`).
 * @param body      - Raw request body string (serialize before calling).
 * @returns Signature header value in the form `sha256=<hex>`.
 *
 * @example
 *   const ts = Date.now();
 *   const sig = signRequest(secret, ts, JSON.stringify(payload));
 *   headers["X-Jarble-Signature"] = sig;
 *   headers["X-Jarble-Timestamp"] = String(ts);
 */
export function signRequest(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const payload = `${timestamp}.${body}`;
  const hmac = crypto.createHmac(HMAC_ALGORITHM, secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verify an incoming request's HMAC-SHA256 signature.
 *
 * Checks both the cryptographic signature (constant-time comparison to prevent
 * timing attacks) and that the timestamp is within `MAX_TIMESTAMP_DRIFT_MS` of
 * the current wall clock (replay-attack protection).
 *
 * @param secret    - Hex-encoded 32-byte signing secret (same one used to sign).
 * @param signature - Signature header value from the request (`sha256=<hex>`).
 * @param timestamp - Timestamp from the request header (Unix ms, parsed as number).
 * @param body      - Raw request body string.
 * @returns `{ valid: true }` on success, `{ valid: false, error: string }` on failure.
 *
 * @example
 *   const result = verifySignature(secret, req.headers["x-jarble-signature"], ts, rawBody);
 *   if (!result.valid) {
 *     res.status(401).json({ error: result.error });
 *     return;
 *   }
 */
export function verifySignature(
  secret: string,
  signature: string,
  timestamp: number,
  body: string,
): { valid: true } | { valid: false; error: string } {
  // 1. Timestamp freshness check (replay-attack protection).
  const now = Date.now();
  if (Math.abs(now - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
    return {
      valid: false,
      error: "Timestamp too old or too far in the future",
    };
  }

  // 2. Recompute expected signature.
  const expected = signRequest(secret, timestamp, body);

  // 3. Length check before timingSafeCompare (it throws on unequal-length Buffers).
  if (expected.length !== signature.length) {
    return { valid: false, error: "Invalid signature" };
  }

  // 4. Constant-time comparison to prevent timing side-channel attacks.
  const isValid = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  );

  return isValid
    ? { valid: true }
    : { valid: false, error: "Invalid signature" };
}
