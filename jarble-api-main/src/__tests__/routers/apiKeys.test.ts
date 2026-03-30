/**
 * Integration tests for the apiKeys tRPC router.
 *
 * Tests list, create, revoke, and usage procedures.
 *
 * The apiKeys router uses the module-level `db` from `../../db/index.js`
 * rather than `ctx.db`, so we mock that module to inject the test DB.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema.sqlite.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Hoisted mutable DB reference ─────────────────────────────────────────────
const dbHolder = vi.hoisted(() => ({
  db: null as any,
  raw: null as any,
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({
  get db() { return dbHolder.db; },
  get tables() {
    return {
      users: sqliteSchema.users,
      deployments: sqliteSchema.deployments,
      runtimeCatalog: sqliteSchema.runtimeCatalog,
      platformCredentials: sqliteSchema.platformCredentials,
      processedWebhookEvents: sqliteSchema.processedWebhookEvents,
      skillsCatalog: sqliteSchema.skillsCatalog,
      deploymentSkills: sqliteSchema.deploymentSkills,
      creatorProfiles: sqliteSchema.creatorProfiles,
      marketplaceComponents: sqliteSchema.marketplaceComponents,
      componentVersions: sqliteSchema.componentVersions,
      componentInstalls: sqliteSchema.componentInstalls,
      componentPurchases: sqliteSchema.componentPurchases,
      componentReviews: sqliteSchema.componentReviews,
      marketplaceServices: sqliteSchema.marketplaceServices,
      serviceComponents: sqliteSchema.serviceComponents,
      serviceSkills: sqliteSchema.serviceSkills,
      serviceInstalls: sqliteSchema.serviceInstalls,
      serviceCredentials: sqliteSchema.serviceCredentials,
      serviceUsage: sqliteSchema.serviceUsage,
      serviceRateLimits: sqliteSchema.serviceRateLimits,
      serviceCircuitBreakers: sqliteSchema.serviceCircuitBreakers,
      serviceHeartbeats: sqliteSchema.serviceHeartbeats,
      serviceAsyncJobs: sqliteSchema.serviceAsyncJobs,
      personaTemplates: sqliteSchema.personaTemplates,
      apiKeys: sqliteSchema.apiKeys,
      domains: sqliteSchema.domains,
      deploymentRatings: sqliteSchema.deploymentRatings,
      deploymentDomainScores: sqliteSchema.deploymentDomainScores,
      serviceBenchmarkSamples: sqliteSchema.serviceBenchmarkSamples,
      serviceBenchmarkAggregates: sqliteSchema.serviceBenchmarkAggregates,
      serviceReviews: sqliteSchema.serviceReviews,
      agentCalls: sqliteSchema.agentCalls,
      chatSessions: sqliteSchema.chatSessions,
      chatMessages: sqliteSchema.chatMessages,
      auditLogs: sqliteSchema.auditLogs,
      betaSignups: sqliteSchema.betaSignups,
      orchestrationFlows: sqliteSchema.orchestrationFlows,
      flowExecutions: sqliteSchema.flowExecutions,
    };
  },
  dbDate: () => new Date().toISOString(),
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

// ── SQL for tables ──────────────────────────────────────────────────────────
// Reuse the CREATE_TABLES from testDb — we import createTestDb logic inline
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── Setup ────────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-001";
const TEST_AUTH0_ID = "auth0|test-integration-001";

beforeEach(() => {
  if (dbHolder.raw) dbHolder.raw.close();
  const testCtx = createTestDb();
  dbHolder.db = testCtx.db;
  dbHolder.raw = testCtx.raw;
  vi.clearAllMocks();
});

afterAll(() => {
  if (dbHolder.raw) dbHolder.raw.close();
});

function caller() {
  return createTestCaller(dbHolder.db, {
    id: TEST_USER_ID,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: TEST_AUTH0_ID,
    emailVerified: true,
  });
}

function anonCaller() {
  return createAnonymousCaller(dbHolder.db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("apiKeys router", () => {
  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("should create an API key and return the raw key once", async () => {
      const result = await caller().apiKeys.create({
        name: "My First Key",
      });
      expect(result.key).toBeDefined();
      expect(result.key).toContain("jrbl_");
      expect(result.name).toBe("My First Key");
      expect(result.id).toContain("ak_");
      expect(result.keyPrefix).toBeDefined();
    });

    it("should set default scopes", async () => {
      const result = await caller().apiKeys.create({ name: "Default Scopes" });
      expect(result.scopes).toBe("mesh:read,mesh:write");
    });

    it("should accept custom scopes", async () => {
      const result = await caller().apiKeys.create({
        name: "Custom Scopes",
        scopes: "mesh:read",
      });
      expect(result.scopes).toBe("mesh:read");
    });

    it("should accept custom rate limits", async () => {
      const result = await caller().apiKeys.create({
        name: "Rate Limited",
        rateLimitPerMin: 10,
        rateLimitPerDay: 500,
      });
      expect(result).toBeDefined();
    });

    it("should accept expiresInDays", async () => {
      const result = await caller().apiKeys.create({
        name: "Expiring Key",
        expiresInDays: 30,
      });
      expect(result.expiresAt).toBeDefined();
      // Should be roughly 30 days from now
      const expiresDate = new Date(result.expiresAt!);
      const now = new Date();
      const diffDays = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });

    it("should return null expiresAt when no expiry set", async () => {
      const result = await caller().apiKeys.create({ name: "No Expiry" });
      expect(result.expiresAt).toBeNull();
    });

    it("should reject empty name", async () => {
      await expect(caller().apiKeys.create({ name: "" })).rejects.toThrow();
    });

    it("should generate unique keys for each call", async () => {
      const key1 = await caller().apiKeys.create({ name: "Key 1" });
      const key2 = await caller().apiKeys.create({ name: "Key 2" });
      expect(key1.key).not.toBe(key2.key);
      expect(key1.id).not.toBe(key2.id);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().apiKeys.create({ name: "Hacker Key" })).rejects.toThrow();
    });

    it("should enforce max 10 active keys per user", async () => {
      // Create 10 keys
      for (let i = 0; i < 10; i++) {
        await caller().apiKeys.create({ name: `Key ${i}` });
      }
      // 11th should fail
      await expect(
        caller().apiKeys.create({ name: "Key 11" })
      ).rejects.toThrow("Maximum 10 active API keys");
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("should return empty array when no keys exist", async () => {
      const result = await caller().apiKeys.list();
      expect(result).toEqual([]);
    });

    it("should return created keys (without raw key)", async () => {
      await caller().apiKeys.create({ name: "Listed Key" });
      const result = await caller().apiKeys.list();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Listed Key");
      expect(result[0].keyPrefix).toBeDefined();
      // Should NOT expose the raw key
      expect((result[0] as any).key).toBeUndefined();
      expect((result[0] as any).keyHash).toBeUndefined();
    });

    it("should not return revoked keys", async () => {
      const created = await caller().apiKeys.create({ name: "To Revoke" });
      await caller().apiKeys.revoke({ keyId: created.id });
      const result = await caller().apiKeys.list();
      expect(result).toHaveLength(0);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().apiKeys.list()).rejects.toThrow();
    });
  });

  // ── revoke ────────────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("should revoke an existing key", async () => {
      const created = await caller().apiKeys.create({ name: "To Revoke" });
      const result = await caller().apiKeys.revoke({ keyId: created.id });
      expect(result).toEqual({ success: true });
    });

    it("should reject revoking a non-existent key", async () => {
      await expect(
        caller().apiKeys.revoke({ keyId: "ak_nonexistent" })
      ).rejects.toThrow("API key not found");
    });

    it("should reject revoking another user's key", async () => {
      const created = await caller().apiKeys.create({ name: "My Key" });

      // Create another user caller
      dbHolder.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      const other = createTestCaller(dbHolder.db, {
        id: "other-user",
        email: "other@jarble.ai",
        name: "Other",
        auth0Id: "auth0|other",
        emailVerified: true,
      });

      await expect(other.apiKeys.revoke({ keyId: created.id })).rejects.toThrow(
        "API key not found"
      );
    });
  });

  // ── usage ─────────────────────────────────────────────────────────────────

  describe("usage", () => {
    it("should return usage stats for a key", async () => {
      const created = await caller().apiKeys.create({ name: "Usage Key" });
      const result = await caller().apiKeys.usage({ keyId: created.id });
      expect(result.keyId).toBe(created.id);
      expect(result.name).toBe("Usage Key");
      expect(result.requestCount).toBe(0);
    });

    it("should reject non-existent key", async () => {
      await expect(
        caller().apiKeys.usage({ keyId: "ak_nonexistent" })
      ).rejects.toThrow("API key not found");
    });
  });
});
