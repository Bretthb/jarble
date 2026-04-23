// ═══════════════════════════════════════════════════════════════════════
// Rate Limiting Middleware - Jarble AI Platform
// ═══════════════════════════════════════════════════════════════════════
//
// Three tiers of rate limiting:
//   globalLimiter        - 300 req/min per IP (all traffic)
//   authLimiter          - 120 req/min per user ID (tRPC endpoints)
//   stripeActionLimiter  - 10 req/min per user ID (checkout + portal)
//
// Exempt from all rate limiting:
//   GET  /health                     - K8s probes
//   POST /api/stripe/webhook         - Stripe-signed
//   POST /api/auth0/email-verified   - M2M secret
//   SSE  endpoints                   - Long-lived connections
//
// Architecture note: With 2 replicas, in-memory limits are NOT shared
// between pods. The effective per-user limit is up to 2x the configured
// value. This is acceptable for MVP. Add ioredis + rate-limit-redis
// store when scaling beyond 2-3 replicas.
// ═══════════════════════════════════════════════════════════════════════

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("rateLimit");

// ─── Key generators ───────────────────────────────────────────────────

/**
 * Extract Auth0 user ID (sub) from a JWT without full verification.
 *
 * ## SECURITY NOTE (JAR-89)
 *
 * The `sub` returned here is UNTRUSTED. Rate-limit middleware runs before
 * route-handler JWT verification, and verifying the JWT (JWKS fetch) on
 * every request is too expensive to do at this tier. An attacker can mint
 * an unsigned token with any `sub` value, including spoofing a victim's
 * sub to fill their rate-limit bucket (user-specific DoS).
 *
 * Mitigation: the caller MUST compound the return value with the client IP
 * via `userKeyGenerator()` below, so a spoofed sub from a different IP
 * lands in a different bucket than the legitimate user. IP-only fallback
 * also kicks in when no token is present. See the ticket for the full
 * attack model.
 *
 * Returns null when token is absent or malformed — not an authorization
 * signal, just a hint for key granularity.
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

/**
 * Rate-limit key: `ip|sub` when both are available, `ip|anon` otherwise.
 *
 * The IP prefix is the actual security boundary — it's what prevents a
 * spoofed `sub` from filling a legitimate user's bucket. The `sub`
 * suffix adds per-user granularity so two people sharing a NAT'd IP
 * don't share rate-limit quota.
 *
 * Exported for unit-test access only — other callers should go through
 * the limiter instances below.
 */
export function userKeyGenerator(req: Request): string {
  const ip = ipKeyGenerator(req.ip ?? "unknown");
  const sub = extractSubFromToken(req);
  return `${ip}|${sub ?? "anon"}`;
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
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  skip: (req) => {
    return (
      req.path === "/health" ||
      req.path === "/api/stripe/webhook" ||
      req.path === "/api/auth0/email-verified" ||
      // SSE endpoints are long-lived connections already gated by MAX_SSE_CONNECTIONS_PER_USER.
      // Counting them against the global rate limit causes EventSource auto-reconnections
      // to burn through the 300/min budget, blocking normal API traffic.
      req.path.endsWith("/stream") ||
      req.path.endsWith("/logs/stream") ||
      req.path.endsWith("/whatsapp/qr") ||
      req.path === "/api/tambo-agent" ||
      // WebSocket upgrade requests are long-lived connections, not repeated API calls.
      // Rate limiting them causes 429 on the HTTP handshake, breaking the WS entirely.
      req.path.startsWith("/ws/")
    );
  },
  message: { error: "Too many requests, please try again later." },
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path }, `Rate limited: ${options.message.error}`);
    res.status(options.statusCode).json(options.message);
  },
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
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path }, `Rate limited: ${options.message.error}`);
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Mutation limiter: 30 req/min per user ID.
 * Prevents creation spam (deployments, flows, orgs, subagents).
 * Applied selectively to POST tRPC mutations in index.ts.
 */
export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  skip: (req) => req.method !== "POST",
  message: { error: "Too many write operations. Please slow down." },
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path, user: extractSubFromToken(req) }, `Mutation rate limited`);
    res.status(options.statusCode).json(options.message);
  },
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
