/**
 * API Key Authentication Middleware
 *
 * Validates `Authorization: Bearer jrbl_...` tokens against the apiKeys table.
 * Used for the external mesh gateway endpoints.
 *
 * Keys are stored as SHA-256 hashes — the raw key is only shown once at creation.
 */
import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("apiKeyAuth");

const API_KEY_PREFIX = "jrbl_";

// In-memory rate limit windows: keyHash -> { minute: [timestamps], day: [timestamps] }
const rateLimitState = new Map<string, { minute: number[]; day: number[] }>();

export interface ApiKeyContext {
  userId: string;
  keyId: string;
  scopes: string[];
}

/**
 * Hash an API key for lookup. Must match how keys are stored.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a new API key with the jrbl_ prefix.
 */
export function generateApiKey(): string {
  const random = crypto.randomBytes(32).toString("base64url");
  return `${API_KEY_PREFIX}${random}`;
}

/**
 * Express middleware that validates API keys.
 * Sets req.apiKeyContext on success.
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer jrbl_")) {
    res.status(401).json({ error: "API key required (Bearer jrbl_...)" });
    return;
  }

  const key = authHeader.slice(7); // Remove "Bearer "
  const keyHash = hashApiKey(key);

  try {
    const apiKey = await (db.query as any).apiKeys?.findFirst?.({
      where: eq(tables.apiKeys.keyHash, keyHash),
    });

    if (!apiKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Check revocation
    if (apiKey.revokedAt) {
      res.status(401).json({ error: "API key has been revoked" });
      return;
    }

    // Check expiration
    if (apiKey.expiresAt) {
      const expiresAt = new Date(apiKey.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        res.status(401).json({ error: "API key has expired" });
        return;
      }
    }

    // Rate limit check
    const now = Date.now();
    let state = rateLimitState.get(keyHash);
    if (!state) {
      state = { minute: [], day: [] };
      rateLimitState.set(keyHash, state);
    }

    // Clean old entries
    state.minute = state.minute.filter((t) => now - t < 60_000);
    state.day = state.day.filter((t) => now - t < 86_400_000);

    if (state.minute.length >= apiKey.rateLimitPerMin) {
      res.status(429).json({ error: "Rate limit exceeded (per minute)" });
      return;
    }
    if (state.day.length >= apiKey.rateLimitPerDay) {
      res.status(429).json({ error: "Rate limit exceeded (per day)" });
      return;
    }

    state.minute.push(now);
    state.day.push(now);

    // Update last used timestamp + request count (fire-and-forget)
    void db.update(tables.apiKeys)
      .set({
        lastUsedAt: new Date().toISOString() as any,
        requestCount: sql`${tables.apiKeys.requestCount} + 1` as any,
      })
      .where(eq(tables.apiKeys.id, apiKey.id))
      .catch(() => {});

    // Set context on request
    (req as any).apiKeyContext = {
      userId: apiKey.userId,
      keyId: apiKey.id,
      scopes: (apiKey.scopes || "").split(",").map((s: string) => s.trim()),
    } satisfies ApiKeyContext;

    next();
  } catch (err) {
    log.error({ err }, "API key auth failed");
    res.status(500).json({ error: "Authentication error" });
  }
}

/**
 * Check if the request has a specific scope.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as any).apiKeyContext as ApiKeyContext | undefined;
    if (!ctx) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!ctx.scopes.includes(scope)) {
      res.status(403).json({ error: `Missing required scope: ${scope}` });
      return;
    }
    next();
  };
}
