/**
 * Integration tests for the platformCredentials tRPC router.
 *
 * Tests getByDeployment, save, delete, checkWhatsAppStatus,
 * markWhatsAppConnected, and testConnection procedures.
 * Uses real in-memory SQLite with mocked encryption and K8s.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Simple reversible encryption mock
vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: vi.fn((plaintext: string) => `ENC:${Buffer.from(plaintext).toString("base64")}`),
  decryptApiKey: vi.fn((encrypted: string) => {
    if (encrypted.startsWith("ENC:")) {
      return Buffer.from(encrypted.slice(4), "base64").toString("utf8");
    }
    return encrypted;
  }),
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
const DEPLOYMENT_ID = "dep-cred-001";

function seedDeployment() {
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
    VALUES ('${DEPLOYMENT_ID}', '${ctx.testUserId}', 'Test Bot', 'openclaw', ${ctx.openclawCatalogId}, 'running');
  `);
}

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  seedDeployment();
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

function otherCaller() {
  // A different user who does NOT own the deployment
  ctx.raw.exec(`
    INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified)
    VALUES ('other-user-001', 'other@jarble.ai', 'Other User', 'auth0|other', 1);
  `);
  return createTestCaller(ctx.db, {
    id: "other-user-001",
    email: "other@jarble.ai",
    name: "Other User",
    auth0Id: "auth0|other",
    emailVerified: true,
  });
}

function anonCaller() {
  return createAnonymousCaller(ctx.db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("platformCredentials router", () => {
  // ── save ──────────────────────────────────────────────────────────────────

  describe("save", () => {
    it("should save discord credentials for a deployment", async () => {
      const result = await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "xoxb-test-token-12345" },
      });
      expect(result).toEqual({ success: true });
    });

    it("should update existing credentials on second save", async () => {
      await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "first-token" },
      });
      const result = await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "updated-token" },
      });
      expect(result).toEqual({ success: true });
    });

    it("should reject unknown platform", async () => {
      await expect(
        caller().platformCredentials.save({
          deploymentId: DEPLOYMENT_ID,
          platformId: "unknown-platform",
          credentials: { token: "abc" },
        })
      ).rejects.toThrow("Unknown platform");
    });

    it("should reject non-owned deployment", async () => {
      await expect(
        otherCaller().platformCredentials.save({
          deploymentId: DEPLOYMENT_ID,
          platformId: "discord",
          credentials: { botToken: "steal" },
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().platformCredentials.save({
          deploymentId: DEPLOYMENT_ID,
          platformId: "discord",
          credentials: { botToken: "abc" },
        })
      ).rejects.toThrow();
    });

    it("should save slack credentials with multiple fields", async () => {
      const result = await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "slack",
        credentials: { botToken: "xoxb-slack", appToken: "xapp-slack" },
      });
      expect(result).toEqual({ success: true });
    });
  });

  // ── getByDeployment ───────────────────────────────────────────────────────

  describe("getByDeployment", () => {
    it("should return empty array when no credentials exist", async () => {
      const result = await caller().platformCredentials.getByDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual([]);
    });

    it("should return saved credentials with masked values", async () => {
      await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "xoxb-very-long-token-here-12345" },
      });

      const result = await caller().platformCredentials.getByDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toHaveLength(1);
      expect(result[0].platformId).toBe("discord");
      expect(result[0].maskedCredentials.botToken).toContain("*");
      // Should NOT contain the full token
      expect(result[0].maskedCredentials.botToken).not.toBe("xoxb-very-long-token-here-12345");
    });

    it("should reject non-owned deployment", async () => {
      await expect(
        otherCaller().platformCredentials.getByDeployment({
          deploymentId: DEPLOYMENT_ID,
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should return multiple platform credentials", async () => {
      await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "discord-token-12345678" },
      });
      await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "telegram",
        credentials: { botToken: "telegram-token-12345" },
      });

      const result = await caller().platformCredentials.getByDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toHaveLength(2);
      const platforms = result.map((c) => c.platformId).sort();
      expect(platforms).toEqual(["discord", "telegram"]);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("should delete saved credentials", async () => {
      await caller().platformCredentials.save({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "to-be-deleted-12345" },
      });

      const result = await caller().platformCredentials.delete({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
      });
      expect(result).toEqual({ success: true });

      const remaining = await caller().platformCredentials.getByDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(remaining).toHaveLength(0);
    });

    it("should reject non-owned deployment", async () => {
      await expect(
        otherCaller().platformCredentials.delete({
          deploymentId: DEPLOYMENT_ID,
          platformId: "discord",
        })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── checkWhatsAppStatus ───────────────────────────────────────────────────

  describe("checkWhatsAppStatus", () => {
    it("should return connected: false when no whatsapp credentials", async () => {
      const result = await caller().platformCredentials.checkWhatsAppStatus({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ connected: false });
    });

    it("should return connected: true after markWhatsAppConnected", async () => {
      await caller().platformCredentials.markWhatsAppConnected({
        deploymentId: DEPLOYMENT_ID,
      });
      const result = await caller().platformCredentials.checkWhatsAppStatus({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ connected: true });
    });
  });

  // ── markWhatsAppConnected ─────────────────────────────────────────────────

  describe("markWhatsAppConnected", () => {
    it("should create a whatsapp credential row", async () => {
      const result = await caller().platformCredentials.markWhatsAppConnected({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ success: true });
    });

    it("should be idempotent (second call does not error)", async () => {
      await caller().platformCredentials.markWhatsAppConnected({
        deploymentId: DEPLOYMENT_ID,
      });
      const result = await caller().platformCredentials.markWhatsAppConnected({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ success: true });
    });

    it("should reject non-owned deployment", async () => {
      await expect(
        otherCaller().platformCredentials.markWhatsAppConnected({
          deploymentId: DEPLOYMENT_ID,
        })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── testConnection ────────────────────────────────────────────────────────

  describe("testConnection", () => {
    it("should return success for discord with required fields", async () => {
      const result = await caller().platformCredentials.testConnection({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "xoxb-valid-token" },
      });
      expect(result.success).toBe(true);
    });

    it("should return failure for discord with missing botToken", async () => {
      const result = await caller().platformCredentials.testConnection({
        deploymentId: DEPLOYMENT_ID,
        platformId: "discord",
        credentials: { botToken: "" },
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("botToken");
    });

    it("should return success for slack with all required fields", async () => {
      const result = await caller().platformCredentials.testConnection({
        deploymentId: DEPLOYMENT_ID,
        platformId: "slack",
        credentials: { botToken: "xoxb-slack", appToken: "xapp-slack" },
      });
      expect(result.success).toBe(true);
    });

    it("should return failure for slack with missing appToken", async () => {
      const result = await caller().platformCredentials.testConnection({
        deploymentId: DEPLOYMENT_ID,
        platformId: "slack",
        credentials: { botToken: "xoxb-slack", appToken: "" },
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("appToken");
    });

    it("should reject unknown platform", async () => {
      await expect(
        caller().platformCredentials.testConnection({
          deploymentId: DEPLOYMENT_ID,
          platformId: "fakechat",
          credentials: { token: "abc" },
        })
      ).rejects.toThrow("Unknown platform");
    });

    it("should succeed for whatsapp (no required fields)", async () => {
      const result = await caller().platformCredentials.testConnection({
        deploymentId: DEPLOYMENT_ID,
        platformId: "whatsapp",
        credentials: {},
      });
      expect(result.success).toBe(true);
    });
  });
});
