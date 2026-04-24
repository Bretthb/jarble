/**
 * AES-256-GCM encryption for API keys stored in the database.
 *
 * When API_KEY_ENCRYPTION_KEY is set (32-byte hex string), all API keys are
 * encrypted before DB writes and decrypted on reads. When the env var is
 * absent (local dev / SQLite), keys are stored in plaintext with a "plain:"
 * prefix so the decrypt path can handle both formats gracefully.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { env } from "./env.js";
import { createModuleLogger } from "./logger.js";

const log = createModuleLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;
const AUTH_TAG_BYTES = 16;

/**
 * Resolve the 32-byte encryption key from the env var.
 * Returns null when not configured (local dev mode - keys stored in plaintext).
 */
function getEncryptionKey(): Buffer | null {
  const hex = env.API_KEY_ENCRYPTION_KEY;
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

/**
 * JAR-89 §12 — startup warning for rows still using the `plain:` prefix.
 *
 * The `plain:<value>` prefix exists so local dev / SQLite tests work
 * without API_KEY_ENCRYPTION_KEY. In production, once the encryption key
 * is provisioned, every new write goes through AES-256-GCM and rows look
 * like `enc:<iv>:<tag>:<ciphertext>`. But older rows written before
 * encryption was enabled (or written during a period when the env var
 * was unset) keep the `plain:` prefix indefinitely — they decrypt fine
 * but sit in the DB as plaintext.
 *
 * This check runs at API startup and logs a warning with counts so the
 * team notices unmigrated rows and can re-encrypt them. It only fires
 * when NODE_ENV === "production" AND the encryption key is configured
 * (meaning we *should* be writing `enc:` rows). Dev runs are silent.
 *
 * No DB writes, no blocking on failure — purely observability.
 */
export async function checkPlainEncryptedRows(db: any): Promise<void> {
  if (env.NODE_ENV !== "production") return;
  if (!env.API_KEY_ENCRYPTION_KEY) return;

  try {
    const [deploymentsRow] = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM deployments WHERE llm_api_key LIKE 'plain:%'
    `);
    const [credsRow] = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM platform_credentials WHERE credentials LIKE 'plain:%'
    `);
    const [secretsRow] = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM deployment_secrets WHERE value LIKE 'plain:%'
    `);

    const deployments = Number(deploymentsRow?.count ?? 0);
    const platformCreds = Number(credsRow?.count ?? 0);
    const secrets = Number(secretsRow?.count ?? 0);
    const total = deployments + platformCreds + secrets;

    if (total > 0) {
      log.warn(
        { deployments, platformCredentials: platformCreds, deploymentSecrets: secrets, total },
        `Found ${total} plaintext encrypted rows — these were written before encryption was fully rolled out and should be re-encrypted. Routes decrypt them fine; this warning is for ops awareness.`,
      );
    }
  } catch (err) {
    // Don't block startup on an observability query failure.
    log.warn({ err: err instanceof Error ? err.message : String(err) },
      "checkPlainEncryptedRows failed — skipping (non-fatal)");
  }
}
