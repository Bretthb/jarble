/**
 * Tests for auth.ts — Auth0 JWT verification and user extraction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as jose from "jose";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock env
vi.mock("../utils/env.js", () => ({
  env: {
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
  },
}));

// Mock DB
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) });
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn() });

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      users: {
        findFirst: (...args: any[]) => mockFindFirst(...args),
      },
    },
    update: (...args: any[]) => mockUpdate(...args),
    insert: (...args: any[]) => mockInsert(...args),
  },
  tables: {
    users: {
      auth0Id: "auth0Id",
      email: "email",
      id: "id",
    },
  },
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: () => "test-nanoid-1",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Generate a real RSA key pair for signing JWTs in tests
let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;
let mockJWKS: jose.JWTVerifyGetKey;

async function createTestKeys() {
  const { privateKey: priv, publicKey: pub } = await jose.generateKeyPair("RS256");
  privateKey = priv;
  publicKey = pub;
  // Create a local JWKS from the public key
  mockJWKS = jose.createLocalJWKSet({
    keys: [await jose.exportJWK(publicKey)],
  });
}

async function signToken(payload: Record<string, unknown>, options?: {
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  expirationTime?: number;
}) {
  let builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(options?.issuer ?? "https://test.auth0.com/")
    .setAudience(options?.audience ?? "https://api.jarble.ai");

  if (options?.expirationTime) {
    builder = builder.setExpirationTime(options.expirationTime);
  } else {
    builder = builder.setExpirationTime(options?.expiresIn ?? "1h");
  }

  return builder.sign(privateKey);
}

// ── Import after mocks ────────────────────────────────────────────────────────

// Use dynamic imports so we can replace the JWKS cache per test.
let verifyToken: typeof import("./auth.js")["verifyToken"];
let getUserFromToken: typeof import("./auth.js")["getUserFromToken"];

async function reimportModule() {
  vi.resetModules();
  const mod = await import("./auth.js");
  verifyToken = mod.verifyToken;
  getUserFromToken = mod.getUserFromToken;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("auth", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await createTestKeys();
    await reimportModule();
  });

  // ── verifyToken ───────────────────────────────────────────────────────────

  describe("verifyToken", () => {
    it("verifies a valid token and returns payload with sub", async () => {
      // We need to bypass the remote JWKS fetch. verifyToken calls getJWKS()
      // which uses createRemoteJWKSet. We'll mock jose.createRemoteJWKSet
      // by re-mocking the module. Instead, let's test at a higher level by
      // mocking jose.jwtVerify directly.

      // Re-mock jose for this test suite
      vi.resetModules();

      const mockJwtVerify = vi.fn();
      vi.doMock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => "mock-jwks"),
        jwtVerify: mockJwtVerify,
      }));

      const mod = await import("./auth.js");

      mockJwtVerify.mockResolvedValue({
        payload: {
          sub: "google-oauth2|12345",
          iss: "https://test.auth0.com/",
          aud: "https://api.jarble.ai",
        },
      });

      const result = await mod.verifyToken("valid-token");

      expect(result.sub).toBe("google-oauth2|12345");
      expect(mockJwtVerify).toHaveBeenCalledWith("valid-token", "mock-jwks", {
        issuer: "https://test.auth0.com/",
        audience: "https://api.jarble.ai",
      });
    });

    it("extracts namespaced email claim into top-level email", async () => {
      vi.resetModules();
      vi.doMock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => "mock-jwks"),
        jwtVerify: vi.fn().mockResolvedValue({
          payload: {
            sub: "auth0|abc",
            "https://api.jarble.ai/email": "user@example.com",
            "https://api.jarble.ai/name": "Test User",
            "https://api.jarble.ai/email_verified": true,
          },
        }),
      }));

      const mod = await import("./auth.js");
      const result = await mod.verifyToken("token-with-claims");

      expect(result.email).toBe("user@example.com");
      expect(result.name).toBe("Test User");
      expect(result.email_verified).toBe(true);
    });

    it("does not overwrite email when namespaced claim is absent", async () => {
      vi.resetModules();
      vi.doMock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => "mock-jwks"),
        jwtVerify: vi.fn().mockResolvedValue({
          payload: {
            sub: "auth0|abc",
            email: "original@example.com",
          },
        }),
      }));

      const mod = await import("./auth.js");
      const result = await mod.verifyToken("token-no-ns-claims");

      expect(result.email).toBe("original@example.com");
    });

    it("throws on invalid token (jose rejects)", async () => {
      vi.resetModules();
      vi.doMock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => "mock-jwks"),
        jwtVerify: vi.fn().mockRejectedValue(new jose.errors.JWTExpired("token expired", { sub: "test" })),
      }));

      const mod = await import("./auth.js");
      await expect(mod.verifyToken("expired-token")).rejects.toThrow("token expired");
    });

    it("throws on malformed token", async () => {
      vi.resetModules();
      vi.doMock("jose", () => ({
        createRemoteJWKSet: vi.fn(() => "mock-jwks"),
        jwtVerify: vi.fn().mockRejectedValue(new Error("Invalid Compact JWS")),
      }));

      const mod = await import("./auth.js");
      await expect(mod.verifyToken("not.a.jwt")).rejects.toThrow("Invalid Compact JWS");
    });

    it("caches JWKS across multiple calls", async () => {
      vi.resetModules();
      const mockCreateRemoteJWKSet = vi.fn(() => "mock-jwks");
      vi.doMock("jose", () => ({
        createRemoteJWKSet: mockCreateRemoteJWKSet,
        jwtVerify: vi.fn().mockResolvedValue({
          payload: { sub: "auth0|user1" },
        }),
      }));

      const mod = await import("./auth.js");

      await mod.verifyToken("token1");
      await mod.verifyToken("token2");
      await mod.verifyToken("token3");

      // createRemoteJWKSet should only be called once (cached)
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    });

    it("passes correct JWKS URL based on AUTH0_DOMAIN", async () => {
      vi.resetModules();
      const mockCreateRemoteJWKSet = vi.fn(() => "mock-jwks");
      vi.doMock("jose", () => ({
        createRemoteJWKSet: mockCreateRemoteJWKSet,
        jwtVerify: vi.fn().mockResolvedValue({
          payload: { sub: "auth0|abc" },
        }),
      }));

      const mod = await import("./auth.js");
      await mod.verifyToken("token");

      const url = (mockCreateRemoteJWKSet.mock.calls[0] as any[])[0] as URL;
      expect(url.toString()).toBe("https://test.auth0.com/.well-known/jwks.json");
    });
  });

  // ── getUserFromToken ──────────────────────────────────────────────────────

  describe("getUserFromToken", () => {
    const basePayload = {
      sub: "google-oauth2|12345",
      email: "user@example.com",
      name: "Test User",
      email_verified: true,
    };

    it("returns existing user found by auth0Id", async () => {
      const existingUser = {
        id: "usr-1",
        auth0Id: "google-oauth2|12345",
        email: "user@example.com",
        name: "Test User",
        emailVerified: true,
      };
      mockFindFirst.mockResolvedValue(existingUser);

      const result = await getUserFromToken(basePayload);

      expect(result).toEqual(existingUser);
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it("updates email on existing user when token has new email", async () => {
      const existingUser = {
        id: "usr-1",
        auth0Id: "google-oauth2|12345",
        email: "old@example.com",
        name: "Test User",
        emailVerified: true,
      };

      const updatedUser = { ...existingUser, email: "new@example.com" };

      // First call: find by auth0Id returns existing user
      // Second call: re-fetch after update returns updated user
      mockFindFirst
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const mockSet = vi.fn().mockReturnValue({ where: vi.fn() });
      mockUpdate.mockReturnValue({ set: mockSet });

      const result = await getUserFromToken({
        ...basePayload,
        email: "new@example.com",
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new@example.com" })
      );
      expect(result).toEqual(updatedUser);
    });

    it("does not update when nothing changed", async () => {
      const existingUser = {
        id: "usr-1",
        auth0Id: "google-oauth2|12345",
        email: "user@example.com",
        name: "Test User",
        emailVerified: true,
      };
      mockFindFirst.mockResolvedValue(existingUser);

      await getUserFromToken(basePayload);

      // Update should NOT be called
      expect(mockUpdate).not.toHaveBeenCalled();
      // Only one findFirst call (no re-fetch needed)
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it("creates new user when none exists", async () => {
      const newUser = {
        id: "test-nanoid-1",
        auth0Id: "auth0|newuser",
        email: "new@example.com",
        name: "New User",
        emailVerified: false,
      };

      // First call: find by auth0Id returns nothing
      // Second call: find by email returns nothing
      // Third call: re-fetch after insert returns new user
      mockFindFirst
        .mockResolvedValueOnce(undefined) // no user by auth0Id
        .mockResolvedValueOnce(undefined) // no user by email
        .mockResolvedValueOnce(newUser);  // re-fetch after insert

      const mockValues = vi.fn();
      mockInsert.mockReturnValue({ values: mockValues });

      const result = await getUserFromToken({
        sub: "auth0|newuser",
        email: "new@example.com",
        name: "New User",
        email_verified: false,
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-nanoid-1",
          auth0Id: "auth0|newuser",
          email: "new@example.com",
          name: "New User",
          emailVerified: false,
        })
      );
      expect(result).toEqual(newUser);
    });

    it("sets Google users as always email-verified", async () => {
      mockFindFirst
        .mockResolvedValueOnce(undefined) // no user by auth0Id
        .mockResolvedValueOnce(undefined) // no user by email
        .mockResolvedValueOnce({ id: "test-nanoid-1" }); // re-fetch

      const mockValues = vi.fn();
      mockInsert.mockReturnValue({ values: mockValues });

      await getUserFromToken({
        sub: "google-oauth2|12345",
        email: "user@gmail.com",
        email_verified: false, // should be overridden to true for Google users
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true })
      );
    });

    it("uses fallback email when token has no email", async () => {
      mockFindFirst
        .mockResolvedValueOnce(undefined) // no user by auth0Id (email lookup skipped when no email)
        .mockResolvedValueOnce({ id: "test-nanoid-1" });

      const mockValues = vi.fn();
      mockInsert.mockReturnValue({ values: mockValues });

      await getUserFromToken({
        sub: "auth0|nomail",
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "auth0|nomail@auth0.user",
        })
      );
    });

    // ── Account linking ───────────────────────────────────────────────────

    describe("account linking", () => {
      it("links accounts when both are email-verified", async () => {
        const existingByEmail = {
          id: "usr-existing",
          auth0Id: "google-oauth2|old",
          email: "user@example.com",
          name: "Existing User",
          emailVerified: true,
        };

        const linkedUser = { ...existingByEmail, auth0Id: "auth0|newmethod" };

        // Find by auth0Id: not found
        // Find by email: found existing user
        // Re-fetch after update: linked user
        mockFindFirst
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(existingByEmail)
          .mockResolvedValueOnce(linkedUser);

        const mockSet = vi.fn().mockReturnValue({ where: vi.fn() });
        mockUpdate.mockReturnValue({ set: mockSet });

        const result = await getUserFromToken({
          sub: "auth0|newmethod",
          email: "user@example.com",
          email_verified: true,
        });

        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({ auth0Id: "auth0|newmethod" })
        );
        expect(result).toEqual(linkedUser);
      });

      it("blocks linking when new account is not email-verified", async () => {
        const existingByEmail = {
          id: "usr-existing",
          auth0Id: "google-oauth2|legit",
          email: "victim@example.com",
          emailVerified: true,
        };

        mockFindFirst
          .mockResolvedValueOnce(undefined)   // no user by auth0Id
          .mockResolvedValueOnce(existingByEmail); // found by email

        await expect(
          getUserFromToken({
            sub: "auth0|attacker",
            email: "victim@example.com",
            email_verified: false,
          })
        ).rejects.toThrow("An account with this email already exists");
      });

      it("blocks linking when existing account is not email-verified", async () => {
        const existingByEmail = {
          id: "usr-existing",
          auth0Id: "auth0|unverified",
          email: "user@example.com",
          emailVerified: false,
        };

        mockFindFirst
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(existingByEmail);

        // Google user (always verified) trying to link with unverified existing
        await expect(
          getUserFromToken({
            sub: "google-oauth2|newgoogle",
            email: "user@example.com",
            email_verified: true,
          })
        ).rejects.toThrow("An account with this email already exists");
      });
    });

    // ── Race condition handling ──────────────────────────────────────────

    describe("race condition on insert", () => {
      it("handles SQLite constraint violation by re-fetching", async () => {
        const existingUser = {
          id: "usr-race",
          auth0Id: "auth0|racer",
          email: "racer@example.com",
        };

        // No existing user initially
        mockFindFirst
          .mockResolvedValueOnce(undefined) // auth0Id lookup
          .mockResolvedValueOnce(undefined) // email lookup
          .mockResolvedValueOnce(existingUser); // re-fetch after constraint error

        const mockValues = vi.fn().mockRejectedValue({ code: "SQLITE_CONSTRAINT" });
        mockInsert.mockReturnValue({ values: mockValues });

        const result = await getUserFromToken({
          sub: "auth0|racer",
          email: "racer@example.com",
        });

        expect(result).toEqual(existingUser);
      });

      it("handles MySQL duplicate entry by re-fetching", async () => {
        mockFindFirst
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({ id: "usr-dup" });

        const mockValues = vi.fn().mockRejectedValue({ code: "ER_DUP_ENTRY" });
        mockInsert.mockReturnValue({ values: mockValues });

        const result = await getUserFromToken({
          sub: "auth0|dup",
          email: "dup@example.com",
        });

        expect(result).toEqual({ id: "usr-dup" });
      });

      it("handles Postgres unique violation by re-fetching", async () => {
        mockFindFirst
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({ id: "usr-pg" });

        const mockValues = vi.fn().mockRejectedValue({ code: "23505" });
        mockInsert.mockReturnValue({ values: mockValues });

        const result = await getUserFromToken({
          sub: "auth0|pg",
          email: "pg@example.com",
        });

        expect(result).toEqual({ id: "usr-pg" });
      });

      it("rethrows non-constraint errors", async () => {
        mockFindFirst
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);

        const mockValues = vi.fn().mockRejectedValue(new Error("Connection lost"));
        mockInsert.mockReturnValue({ values: mockValues });

        await expect(
          getUserFromToken({
            sub: "auth0|err",
            email: "err@example.com",
          })
        ).rejects.toThrow("Connection lost");
      });
    });

    // ── Email verification flag update ──────────────────────────────────

    it("updates emailVerified flag on existing user when newly verified", async () => {
      const existingUser = {
        id: "usr-1",
        auth0Id: "auth0|abc",
        email: "user@example.com",
        name: "User",
        emailVerified: false,
      };

      const updatedUser = { ...existingUser, emailVerified: true };

      mockFindFirst
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const mockSet = vi.fn().mockReturnValue({ where: vi.fn() });
      mockUpdate.mockReturnValue({ set: mockSet });

      const result = await getUserFromToken({
        sub: "auth0|abc",
        email: "user@example.com",
        name: "User",
        email_verified: true,
      });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true })
      );
      expect(result).toEqual(updatedUser);
    });
  });
});
