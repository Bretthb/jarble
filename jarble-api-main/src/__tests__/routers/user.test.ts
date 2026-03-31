/**
 * Integration tests for the user tRPC router.
 *
 * Tests me, getProfile, updateProfile, completeProfile,
 * resendVerificationEmail, and deleteAccount procedures.
 * Uses real in-memory SQLite with mocked external services.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockDeleteAccount = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/accountDeletion.js", () => ({
  deleteAccount: (...args: any[]) => mockDeleteAccount(...args),
}));

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "", podName: null }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
  syncMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: vi.fn().mockReturnValue(false),
  getSubscriptionDetails: vi.fn(),
  listInvoices: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({ baseCents: 0, managedKeyCents: 0, totalCents: 0 }),
  findManagedKeyItem: vi.fn().mockResolvedValue(null),
  updateManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  removeManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  addManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    DB_PROVIDER: "sqlite",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    AUTH0_MGMT_CLIENT_ID: undefined,
    AUTH0_MGMT_CLIENT_SECRET: undefined,
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_MANAGEMENT_KEY: undefined,
    API_KEY_ENCRYPTION_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));

// ── Setup ────────────────────────────────────────────────────────────────────
let ctx: TestDbContext;

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterAll(() => {
  if (ctx) ctx.raw.close();
});

function caller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

function anonCaller() {
  return createAnonymousCaller(ctx.db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("user router", () => {
  // ── user.me ────────────────────────────────────────────────────────────────

  describe("me", () => {
    it("should return the current user from context", async () => {
      const result = await caller().user.me();
      expect(result).toBeDefined();
      expect(result!.id).toBe(ctx.testUserId);
      expect(result!.email).toBe("test@jarble.ai");
    });

    it("should return null for anonymous user", async () => {
      const result = await anonCaller().user.me();
      expect(result).toBeNull();
    });
  });

  // ── user.getProfile ────────────────────────────────────────────────────────

  describe("getProfile", () => {
    it("should return the full user profile from DB", async () => {
      const result = await caller().user.getProfile();
      expect(result).toBeDefined();
      expect(result!.id).toBe(ctx.testUserId);
      expect(result!.email).toBe("test@jarble.ai");
      expect(result!.name).toBe("Test User");
      expect(result!.auth0Id).toBe(ctx.testAuth0Id);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().user.getProfile()).rejects.toThrow();
    });
  });

  // ── user.updateProfile ─────────────────────────────────────────────────────

  describe("updateProfile", () => {
    it("should update the user name", async () => {
      const result = await caller().user.updateProfile({ name: "Updated Name" });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Updated Name");
    });

    it("should persist the updated name in the database", async () => {
      await caller().user.updateProfile({ name: "Persisted Name" });
      const profile = await caller().user.getProfile();
      expect(profile!.name).toBe("Persisted Name");
    });

    it("should reject empty name", async () => {
      await expect(caller().user.updateProfile({ name: "" })).rejects.toThrow();
    });

    it("should handle empty update gracefully", async () => {
      // Drizzle throws on empty .set() - the router should either
      // short-circuit or pass through. Currently it throws.
      await expect(caller().user.updateProfile({})).rejects.toThrow();
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().user.updateProfile({ name: "Hacker" })).rejects.toThrow();
    });
  });

  // ── user.completeProfile ───────────────────────────────────────────────────

  describe("completeProfile", () => {
    it("should set full name from first and last name", async () => {
      const result = await caller().user.completeProfile({
        firstName: "John",
        lastName: "Doe",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("John Doe");
    });

    it("should reject missing firstName", async () => {
      await expect(
        caller().user.completeProfile({ firstName: "", lastName: "Doe" })
      ).rejects.toThrow();
    });

    it("should reject missing lastName", async () => {
      await expect(
        caller().user.completeProfile({ firstName: "John", lastName: "" })
      ).rejects.toThrow();
    });

    it("should reject overly long firstName", async () => {
      await expect(
        caller().user.completeProfile({
          firstName: "A".repeat(101),
          lastName: "Doe",
        })
      ).rejects.toThrow();
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().user.completeProfile({ firstName: "John", lastName: "Doe" })
      ).rejects.toThrow();
    });
  });

  // ── user.resendVerificationEmail ───────────────────────────────────────────

  describe("resendVerificationEmail", () => {
    it("should throw BAD_REQUEST if email is already verified", async () => {
      // Default test user has emailVerified = 1
      await expect(caller().user.resendVerificationEmail()).rejects.toThrow(
        "Email is already verified"
      );
    });

    it("should throw INTERNAL_SERVER_ERROR if Auth0 management API is not configured", async () => {
      // Mark user as unverified
      ctx.raw.exec(`UPDATE users SET email_verified = 0 WHERE id = '${ctx.testUserId}'`);

      await expect(caller().user.resendVerificationEmail()).rejects.toThrow(
        "Email verification resend is not configured"
      );
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().user.resendVerificationEmail()).rejects.toThrow();
    });
  });

  // ── user.deleteAccount ─────────────────────────────────────────────────────

  describe("deleteAccount", () => {
    it("should call deleteAccount service with correct params", async () => {
      await caller().user.deleteAccount({ confirmation: "DELETE MY ACCOUNT" });
      expect(mockDeleteAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ctx.testUserId,
          auth0Id: ctx.testAuth0Id,
          email: "test@jarble.ai",
        })
      );
    });

    it("should return success true", async () => {
      const result = await caller().user.deleteAccount({ confirmation: "DELETE MY ACCOUNT" });
      expect(result).toEqual({ success: true });
    });

    it("should reject wrong confirmation string", async () => {
      await expect(
        caller().user.deleteAccount({ confirmation: "delete" as any })
      ).rejects.toThrow();
    });

    it("should reject empty confirmation", async () => {
      await expect(
        caller().user.deleteAccount({ confirmation: "" as any })
      ).rejects.toThrow();
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().user.deleteAccount({ confirmation: "DELETE MY ACCOUNT" })
      ).rejects.toThrow();
    });
  });
});
