// ═══════════════════════════════════════════════════════════════════════
// Rate Limiting Middleware — Jarble AI Platform
// ═══════════════════════════════════════════════════════════════════════
//
// Three tiers of rate limiting:
//   globalLimiter        — 300 req/min per IP (all traffic)
//   authLimiter          — 120 req/min per user ID (tRPC endpoints)
//   stripeActionLimiter  — 10 req/min per user ID (checkout + portal)
//
// Exempt from all rate limiting:
//   GET  /health                     — K8s probes
//   POST /api/stripe/webhook         — Stripe-signed
//   POST /api/auth0/email-verified   — M2M secret
//   SSE  endpoints                   — Long-lived connections
//
// Architecture note: With 2 replicas, in-memory limits are NOT shared
// between pods. The effective per-user limit is up to 2x the configured
// value. This is acceptable for MVP. Add ioredis + rate-limit-redis
// store when scaling beyond 2-3 replicas.
// ═══════════════════════════════════════════════════════════════════════

import rateLimit from "express-rate-limit";
import type { Request } from "express";

// ─── Key generators ───────────────────────────────────────────────────

/**
 * Extract Auth0 user ID (sub) from a JWT without full verification.
 * Used ONLY for rate limit key generation, not for authorization.
 * Route handlers still perform full JWT verification independently.
 *
 * Returns null if token is missing or malformed — callers fall back to IP.
 */
function extractSubFromToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Rate limit key: user ID from JWT, or fall back to IP address */
function userKeyGenerator(req: Request): string {
  return extractSubFromToken(req) ?? (req.ip ?? "unknown");
}

// ─── Limiters ─────────────────────────────────────────────────────────

/**
 * Global limiter: 300 req/min per IP.
 * Applied to all traffic. Catches abuse bots.
 * Skips health probes and webhook endpoints.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  skip: (req) => {
    return (
      req.path === "/health" ||
      req.path === "/api/stripe/webhook" ||
      req.path === "/api/auth0/email-verified"
    );
  },
  message: { error: "Too many requests, please try again later." },
});

/**
 * Auth limiter: 120 req/min per user ID.
 * Applied to tRPC and authenticated REST endpoints.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: "Rate limit exceeded. Please slow down." },
});

/**
 * Stripe action limiter: 10 req/min per user ID.
 * Prevents checkout spam and duplicate session creation.
 */
export const stripeActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: "Too many payment requests. Please wait before trying again." },
});
