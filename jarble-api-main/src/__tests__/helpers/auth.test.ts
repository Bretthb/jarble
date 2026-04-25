/**
 * Unit tests for `getUserFromRequest` in src/helpers/auth.ts.
 *
 * The helper sits between every protected REST route in the API
 * (promo validation, file routes, debug endpoints, etc.) and the
 * actual JWT verification in `services/auth.ts`. A regression here
 * would silently break authentication on every route that uses it.
 *
 * Three contracts pinned:
 *
 *   1. **No Authorization header → null** without calling
 *      verifyToken (avoid burning JWKS fetches on unauthenticated
 *      requests).
 *
 *   2. **Non-Bearer scheme → null** without calling verifyToken
 *      (Basic, Digest, etc. are not supported).
 *
 *   3. **Token verification failure → null + log warning**
 *      (NOT thrown). The caller treats null as "unauthenticated"
 *      and falls back to public behavior; throwing would bubble
 *      up as a 500 instead.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();

vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getUserFromRequest } from "../../helpers/auth.js";

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockGetUserFromToken.mockReset();
});

/** Build a tiny fake Express request. */
function buildReq(authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    path: "/test",
  } as any;
}

describe("getUserFromRequest", () => {
  it("returns null when no Authorization header is present (no JWKS burn)", async () => {
    const result = await getUserFromRequest(buildReq());
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
    expect(mockGetUserFromToken).not.toHaveBeenCalled();
  });

  it("returns null for a Basic-auth header (no JWKS burn — Basic is not supported)", async () => {
    const result = await getUserFromRequest(buildReq("Basic dXNlcjpwYXNz"));
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null for a non-Bearer scheme (Digest, Negotiate, etc.)", async () => {
    const result = await getUserFromRequest(buildReq("Digest username=alice"));
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when Authorization is just 'Bearer' with no token", async () => {
    // "Bearer " has length 7, slice(7) returns ""; the `!token`
    // guard MUST catch the empty string.
    const result = await getUserFromRequest(buildReq("Bearer "));
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("calls verifyToken with the raw token (Bearer prefix stripped)", async () => {
    mockVerifyToken.mockResolvedValueOnce({ sub: "auth0|user-1" });
    mockGetUserFromToken.mockResolvedValueOnce({ id: "u1", email: "alice@example.com" });

    await getUserFromRequest(buildReq("Bearer eyJhbGc.eyJzdWI.signature"));

    expect(mockVerifyToken).toHaveBeenCalledWith("eyJhbGc.eyJzdWI.signature");
  });

  it("forwards the verified payload to getUserFromToken and returns its result", async () => {
    const payload = { sub: "auth0|user-1", aud: "api" };
    const user = { id: "u1", email: "a@b.com", name: "Alice" };
    mockVerifyToken.mockResolvedValueOnce(payload);
    mockGetUserFromToken.mockResolvedValueOnce(user);

    const result = await getUserFromRequest(buildReq("Bearer abc.def.ghi"));

    expect(mockGetUserFromToken).toHaveBeenCalledWith(payload);
    expect(result).toBe(user);
  });

  it("returns null when verifyToken rejects (invalid signature, expired, etc.)", async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error("jwt expired"));

    const result = await getUserFromRequest(buildReq("Bearer abc.def.ghi"));

    expect(result).toBeNull();
    // getUserFromToken must NOT be called when verification failed.
    expect(mockGetUserFromToken).not.toHaveBeenCalled();
  });

  it("returns null when getUserFromToken rejects (user not found in DB, etc.)", async () => {
    mockVerifyToken.mockResolvedValueOnce({ sub: "auth0|missing" });
    mockGetUserFromToken.mockRejectedValueOnce(new Error("user not found"));

    const result = await getUserFromRequest(buildReq("Bearer abc.def.ghi"));

    expect(result).toBeNull();
  });

  it("does NOT throw on any verification failure — caller treats null as unauthenticated", async () => {
    // The chain from JWKS fetch failure to malformed JWT to DB
    // miss all collapse into a single null return so the caller
    // (e.g. promo.ts) can treat the request as "anonymous" and
    // serve a public response without surfacing a 500.
    mockVerifyToken.mockRejectedValueOnce(new Error("network failure fetching JWKS"));

    const req = buildReq("Bearer abc.def.ghi");
    await expect(getUserFromRequest(req)).resolves.toBeNull();
  });

  it("returns null when verifyToken resolves to null/undefined payload (defensive)", async () => {
    mockVerifyToken.mockResolvedValueOnce(null);
    mockGetUserFromToken.mockResolvedValueOnce(undefined);

    const result = await getUserFromRequest(buildReq("Bearer abc.def.ghi"));

    // getUserFromToken returns undefined → result is undefined.
    // Either undefined or null is "not authenticated"; the caller
    // checks truthiness, not strict-equality.
    expect(result).toBeFalsy();
  });
});
