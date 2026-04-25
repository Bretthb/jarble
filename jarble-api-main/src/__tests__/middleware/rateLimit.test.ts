/**
 * Unit tests for `userKeyGenerator` in src/middleware/rateLimit.ts.
 *
 * The compound `ip|sub` key is the JAR-89 §1 mitigation against
 * a victim-DoS where an attacker mints an unsigned JWT with a
 * spoofed `sub` to fill another user's rate-limit bucket. The
 * IP prefix is the actual security boundary — without it, the
 * `sub` is untrusted (rate-limit middleware runs BEFORE JWKS
 * verification, which is too expensive to do on every request).
 *
 * Three contracts pinned:
 *
 *   1. **Compound shape `${ip}|${sub}`** with `anon` fallback
 *      when no token is present. This is the wire format the
 *      bucket map keys on; changing the separator or order
 *      would silently merge unrelated buckets.
 *
 *   2. **Malformed token → `anon` fallback**, never a thrown
 *      exception. The middleware runs on every request; one
 *      garbage token from a misbehaving client must not crash
 *      the rate-limit pipeline for everyone else.
 *
 *   3. **IP fallback when `req.ip` is undefined** — the
 *      `ipKeyGenerator` import receives `"unknown"` so the
 *      bucket is at least populated with a deterministic value.
 *      This prevents a `req.ip === undefined` request from
 *      crashing the limiter.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { userKeyGenerator } from "../../middleware/rateLimit.js";
import type { Request } from "express";

/** Build a tiny fake Express request with the bits userKeyGenerator reads. */
function buildReq(opts: { ip?: string; authHeader?: string } = {}): Request {
  return {
    ip: opts.ip,
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
  } as unknown as Request;
}

/**
 * Build a Bearer token string with the given JWT payload. Header and
 * signature are throwaway — the middleware doesn't verify them
 * (JAR-89 §1 documents why).
 */
function bearerToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = "fake-signature-not-verified";
  return `Bearer ${header}.${body}.${sig}`;
}

// ── Compound key shape ──────────────────────────────────────────────────────

describe("userKeyGenerator — compound key shape", () => {
  it("returns `ip|sub` when both are present", () => {
    const req = buildReq({
      ip: "1.2.3.4",
      authHeader: bearerToken({ sub: "auth0|user-1" }),
    });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|auth0|user-1");
  });

  it("returns `ip|anon` when no auth header is present", () => {
    const req = buildReq({ ip: "1.2.3.4" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("returns `ip|anon` when auth header is not a Bearer token", () => {
    const req = buildReq({ ip: "1.2.3.4", authHeader: "Basic dXNlcjpwYXNz" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("uses the IP-only key as the prefix (security boundary)", () => {
    // Two requests from the SAME ip with DIFFERENT subs → different
    // keys (granularity). Two requests from DIFFERENT ips with the
    // SAME sub → different keys (spoofed-sub doesn't fill victim's
    // bucket).
    const sameIpA = userKeyGenerator(buildReq({ ip: "1.2.3.4", authHeader: bearerToken({ sub: "alice" }) }));
    const sameIpB = userKeyGenerator(buildReq({ ip: "1.2.3.4", authHeader: bearerToken({ sub: "bob" }) }));
    const diffIpAlice = userKeyGenerator(buildReq({ ip: "9.9.9.9", authHeader: bearerToken({ sub: "alice" }) }));

    expect(sameIpA).not.toBe(sameIpB);          // different sub on same ip → different bucket
    expect(sameIpA).not.toBe(diffIpAlice);      // same sub from different ip → different bucket
  });
});

// ── Malformed token tolerance ───────────────────────────────────────────────

describe("userKeyGenerator — malformed token tolerance", () => {
  it("falls back to `anon` when token has fewer than 3 dot-separated parts", () => {
    const req = buildReq({ ip: "1.2.3.4", authHeader: "Bearer onlyone.twoparts" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("falls back to `anon` when token payload is not valid base64url-encoded JSON", () => {
    // Three dot-separated parts but the middle part is not valid
    // JSON when base64url-decoded.
    const req = buildReq({ ip: "1.2.3.4", authHeader: "Bearer aaa.bbb.ccc" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("falls back to `anon` when the JSON payload has no `sub` field", () => {
    const req = buildReq({
      ip: "1.2.3.4",
      authHeader: bearerToken({ aud: "api", iss: "auth0" }),
    });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("falls back to `anon` when sub is null in the JWT payload", () => {
    const req = buildReq({
      ip: "1.2.3.4",
      authHeader: bearerToken({ sub: null }),
    });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("does NOT throw on completely garbage Authorization header", () => {
    const req = buildReq({ ip: "1.2.3.4", authHeader: "Bearer 🤖🌍💥" });
    expect(() => userKeyGenerator(req)).not.toThrow();
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("ignores unsigned tokens (header.payload.) — but still extracts sub from a parseable payload", () => {
    // The middleware doesn't verify signatures (JAR-89 documents why),
    // so an unsigned token still extracts sub. The sub is UNTRUSTED
    // — that's why we compound with IP. This test pins that current
    // behavior: unsigned tokens yield a sub key, but the IP prefix
    // means a spoofed sub still lands in a different bucket from the
    // legitimate user (different IP).
    const req = buildReq({
      ip: "9.9.9.9",
      authHeader: bearerToken({ sub: "spoofed-victim-id" }),
    });
    // Bucket key includes the spoofed sub but is prefixed by the
    // attacker's actual IP — separate from the victim's bucket.
    expect(userKeyGenerator(req)).toBe("9.9.9.9|spoofed-victim-id");
  });
});

// ── IP fallback ─────────────────────────────────────────────────────────────

describe("userKeyGenerator — IP fallback", () => {
  it("uses 'unknown' (or the ipKeyGenerator's mapping of it) when req.ip is undefined", () => {
    // Should NOT crash. The express-rate-limit ipKeyGenerator may
    // transform "unknown" into a deterministic bucket id; we just
    // verify the result is a non-empty string ending in `|anon`.
    const req = buildReq({ ip: undefined, authHeader: undefined });
    const key = userKeyGenerator(req);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    expect(key.endsWith("|anon")).toBe(true);
  });

  it("works for IPv4 addresses (key includes the v4 address verbatim)", () => {
    const req = buildReq({ ip: "192.168.1.42", authHeader: undefined });
    const key = userKeyGenerator(req);
    expect(key.startsWith("192.168.1.42")).toBe(true);
  });

  it("works for IPv6 addresses without crashing (express-rate-limit handles /64 masking)", () => {
    // express-rate-limit's `ipKeyGenerator` masks IPv6 to /64 to
    // group abuse patterns from a single subnet. We don't pin the
    // specific masked value — just that we get a non-empty key.
    const req = buildReq({ ip: "2001:db8::1", authHeader: undefined });
    expect(() => userKeyGenerator(req)).not.toThrow();
    const key = userKeyGenerator(req);
    expect(key.length).toBeGreaterThan(0);
    expect(key.endsWith("|anon")).toBe(true);
  });
});
