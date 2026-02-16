/**
 * AES-256-GCM encryption for API keys stored in the database.
 *
 * When API_KEY_ENCRYPTION_KEY is set (32-byte hex string), all API keys are
 * encrypted before DB writes and decrypted on reads. When the env var is
 * absent (local dev / SQLite), keys are stored in plaintext with a "plain:"
 * prefix so the decrypt path can handle both formats gracefully.
 */
import crypto from "crypto";
import { env } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;
const AUTH_TAG_BYTES = 16;

/**
 * Resolve the 32-byte encryption key from the env var.
 * Returns null when not configured (local dev mode — keys stored in plaintext).
 */
function getEncryptionKey(): Buffer | null {
  const hex = (env as any).API_KEY_ENCRYPTION_KEY as string | undefined;
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("API_KEY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
  }
  return buf;
}

/**
 * Encrypt a plaintext API key for storage.
 * Returns an opaque string: "enc:<iv>:<authTag>:<ciphertext>" (all hex).
 * If no encryption key is configured, returns "plain:<key>" (dev mode).
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    return `plain:${plaintext}`;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a stored API key back to plaintext.
 * Handles three formats:
 *   - "enc:<iv>:<tag>:<data>"  → AES-256-GCM decrypt
 *   - "plain:<key>"           → strip prefix, return raw
 *   - anything else           → legacy plaintext (pre-encryption migration)
 */
export function decryptApiKey(stored: string): string {
  if (stored.startsWith("plain:")) {
    return stored.slice(6);
  }

  if (stored.startsWith("enc:")) {
    const key = getEncryptionKey();
    if (!key) {
      throw new Error(
        "Cannot decrypt API key: API_KEY_ENCRYPTION_KEY is not set. " +
        "The key was encrypted in a different environment."
      );
    }

    const parts = stored.slice(4).split(":");
    if (parts.length !== 3) {
      throw new Error("Malformed encrypted API key");
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  }

  // Legacy: pre-encryption plaintext key stored without prefix
  return stored;
}
