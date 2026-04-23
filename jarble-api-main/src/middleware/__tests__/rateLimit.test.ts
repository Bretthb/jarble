/**
 * Tests for the rate-limit key generator.
 *
 * JAR-89 §1 — the key must compound the client IP with the JWT's `sub`
 * so that a spoofed `sub` from a different IP cannot fill a legitimate
 * user's rate-limit bucket. This file pins the contract.
 */
import { describe, it, expect, vi } from "vitest";

// The logger import is harmless in unit tests (no initialization side
// effects beyond creating a module handle) but keep a no-op mock in case
// it grows OTel wiring later.
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { userKeyGenerator } from "../rateLimit.js";
import type { Request } from "express";

/**
 * Build a base64url payload segment for an unsigned JWT with the given
 * `sub` claim. The signature segment is left empty — the key generator
 * does not verify, it just parses.
 */
function tokenWithSub(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.`;
}

function fakeReq(opts: { ip?: string; authorization?: string }): Request {
  return {
    ip: opts.ip,
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  } as unknown as Request;
}

describe("userKeyGenerator", () => {
  it("composes `ip|sub` when both are present", () => {
    const req = fakeReq({ ip: "1.2.3.4", authorization: `Bearer ${tokenWithSub("auth0|alice")}` });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|auth0|alice");
  });

  it("falls back to `ip|anon` when no Authorization header is set", () => {
    const req = fakeReq({ ip: "1.2.3.4" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("falls back to `ip|anon` when the JWT payload is malformed", () => {
    const req = fakeReq({ ip: "1.2.3.4", authorization: "Bearer not-a-jwt" });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("falls back to `ip|anon` when the JWT has no `sub` claim", () => {
    // Valid three-segment structure but payload has no sub.
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ email: "x@y.com" })).toString("base64url");
    const req = fakeReq({
      ip: "1.2.3.4",
      authorization: `Bearer ${header}.${payload}.`,
    });
    expect(userKeyGenerator(req)).toBe("1.2.3.4|anon");
  });

  it("same sub from different IPs lands in different buckets (prevents victim-DoS)", () => {
    // JAR-89 §1 — the attack vector the IP prefix closes: an attacker
    // spoofing a victim's sub from their own IP should NOT share a bucket
    // with the victim's genuine requests from the victim's IP.
    const attacker = fakeReq({ ip: "1.2.3.4", authorization: `Bearer ${tokenWithSub("auth0|victim")}` });
    const victim   = fakeReq({ ip: "5.6.7.8", authorization: `Bearer ${tokenWithSub("auth0|victim")}` });
    expect(userKeyGenerator(attacker)).not.toBe(userKeyGenerator(victim));
  });

  it("different subs from the same IP land in different buckets (per-user granularity for NAT'd IPs)", () => {
    // Two legit users sharing a corporate NAT should not share quota.
    const alice = fakeReq({ ip: "1.2.3.4", authorization: `Bearer ${tokenWithSub("auth0|alice")}` });
    const bob   = fakeReq({ ip: "1.2.3.4", authorization: `Bearer ${tokenWithSub("auth0|bob")}` });
    expect(userKeyGenerator(alice)).not.toBe(userKeyGenerator(bob));
  });

  it("uses a literal 'unknown' placeholder when req.ip is missing", () => {
    // Deployed behind a misconfigured proxy — the express req.ip falls
    // through to undefined. The key generator must not crash.
    const req = fakeReq({});
    // ipKeyGenerator("unknown") returns "unknown" for non-IP strings.
    expect(userKeyGenerator(req)).toBe("unknown|anon");
  });
});
