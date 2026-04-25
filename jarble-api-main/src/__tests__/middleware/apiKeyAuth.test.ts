/**
 * Unit tests for the pure helpers + scope guard in
 * src/middleware/apiKeyAuth.ts.
 *
 * The middleware authenticates `Authorization: Bearer jrbl_...`
 * tokens against the apiKeys table. Three contracts pinned:
 *
 *   1. **`hashApiKey(key)` is deterministic SHA-256** — keys are
 *      stored as hashes, so a regression that changed the hash
 *      function (or its salting) would invalidate every existing
 *      key. The deterministic property is what makes lookups work
 *      at all.
 *
 *   2. **`generateApiKey()` produces collision-resistant tokens
 *      with the `jrbl_` prefix** — the prefix is the wire
 *      identifier the middleware uses to filter Bearer headers,
 *      and 32 random bytes (256 bits) is the entropy floor that
 *      makes brute-force attacks computationally infeasible.
 *
 *   3. **`requireScope(scope)` blocks requests without the right
 *      claim** — 401 when the auth context is missing, 403 when
 *      the scope isn't present, `next()` otherwise. Confusing 401
 *      and 403 here would either expose or hide whether a key
 *      exists at all.
 *
 * `authenticateApiKey` itself is heavy DB+rate-limit orchestration
 * and is left for integration testing.
 */

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

// The middleware module imports db/index.js, which throws on module
// init when DATABASE_URL is unset. Mock it down to a stub — the
// helpers under test never touch the DB.
vi.mock("../../db/index.js", () => ({
  db: { query: { apiKeys: { findFirst: vi.fn() } }, update: vi.fn() },
  tables: { apiKeys: {} },
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  hashApiKey,
  generateApiKey,
  requireScope,
  type ApiKeyContext,
} from "../../middleware/apiKeyAuth.js";

// ── hashApiKey ──────────────────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("returns the SHA-256 hex digest of the input", () => {
    const expected = crypto.createHash("sha256").update("hello").digest("hex");
    expect(hashApiKey("hello")).toBe(expected);
  });

  it("is deterministic — same input always produces the same hash", () => {
    expect(hashApiKey("jrbl_xyz")).toBe(hashApiKey("jrbl_xyz"));
  });

  it("produces different hashes for different inputs (avalanche)", () => {
    const a = hashApiKey("jrbl_aaaa");
    const b = hashApiKey("jrbl_aaab");
    expect(a).not.toBe(b);
  });

  it("output is exactly 64 lowercase hex characters", () => {
    const hash = hashApiKey("anything");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the empty string to the well-known SHA-256 of empty", () => {
    // The empty-string SHA-256 is a famous constant. Pinning it
    // catches any accidental swap of the hash function — e.g.
    // someone changing it to SHA-1 would break this immediately.
    expect(hashApiKey("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

// ── generateApiKey ──────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns a string starting with the `jrbl_` prefix", () => {
    expect(generateApiKey().startsWith("jrbl_")).toBe(true);
  });

  it("has 43 base64url characters after the prefix (32 random bytes encoded)", () => {
    // 32 bytes of base64url = 43 chars (no padding).
    const key = generateApiKey();
    const body = key.slice(5); // strip "jrbl_"
    expect(body).toHaveLength(43);
  });

  it("body uses only base64url alphabet (A-Z a-z 0-9 - _)", () => {
    const key = generateApiKey();
    const body = key.slice(5);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces collision-resistant tokens (16 calls all distinct)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 16; i++) keys.add(generateApiKey());
    expect(keys.size).toBe(16);
  });

  it("round-trips through hashApiKey to a 64-char hex digest", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── requireScope ────────────────────────────────────────────────────────────

/** Build a minimal mock Express response with the methods requireScope reads. */
function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json };
}

function buildReq(ctx?: ApiKeyContext) {
  // The middleware reads from `(req as any).apiKeyContext`.
  return ctx ? { apiKeyContext: ctx } : {};
}

describe("requireScope", () => {
  it("returns a function (curried middleware constructor)", () => {
    const mw = requireScope("write");
    expect(typeof mw).toBe("function");
  });

  it("responds 401 when no apiKeyContext is on the request", () => {
    const mw = requireScope("write");
    const req = buildReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status().json).toHaveBeenCalledWith({ error: "Not authenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 403 when context is present but scope is missing", () => {
    const mw = requireScope("admin");
    const req = buildReq({ userId: "u", keyId: "k", scopes: ["read", "write"] });
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status().json).toHaveBeenCalledWith({
      error: "Missing required scope: admin",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the scope is present in the context", () => {
    const mw = requireScope("write");
    const req = buildReq({ userId: "u", keyId: "k", scopes: ["read", "write", "delete"] });
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does NOT match by prefix — 'write' scope does not satisfy 'write:agents' requirement", () => {
    // The check is exact-equality via Array.includes, NOT prefix match.
    // A regression that loosened this would let a less-privileged key
    // act on more-privileged endpoints.
    const mw = requireScope("write:agents");
    const req = buildReq({ userId: "u", keyId: "k", scopes: ["write"] });
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 (NOT 403) when context is undefined — distinguishes auth from authz", () => {
    // Confusing 401 and 403 here would either:
    //   - expose whether a key exists (401-only on missing key) OR
    //   - hide auth failures behind authz failures (403 always).
    // Both are bad. Pin the exact status codes.
    const mw = requireScope("any");
    const req = buildReq(); // no context
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("treats an empty scopes array as 'no scopes' — 403 for any required scope", () => {
    const mw = requireScope("read");
    const req = buildReq({ userId: "u", keyId: "k", scopes: [] });
    const res = mockRes();
    const next = vi.fn();

    mw(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
