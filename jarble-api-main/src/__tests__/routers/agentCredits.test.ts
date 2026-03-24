/**
 * Integration tests for the agentCredits tRPC router.
 *
 * Tests getBalance, getHistory, purchaseCredits, and getCallHistory.
 *
 * The agentCredits router uses the module-level `db` from `../../db/index.js`
 * rather than `ctx.db`, so we mock that module to inject the test DB.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as sqliteSchema from "../../db/schema.sqlite.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";
import { createTestDb } from "../helpers/testDb.js";

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
      agentCredits: sqliteSchema.agentCredits,
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

describe("agentCredits router", () => {
  // ── getBalance ────────────────────────────────────────────────────────────

  describe("getBalance", () => {
    it("should return 0 balance for a new user", async () => {
      const result = await caller().agentCredits.getBalance();
      expect(result.balance).toBe(0);
    });

    it("should include credit tiers", async () => {
      const result = await caller().agentCredits.getBalance();
      expect(result.tiers).toBeDefined();
      expect(result.tiers[500]).toBeDefined();
      expect(result.tiers[2500]).toBeDefined();
      expect(result.tiers[10000]).toBeDefined();
    });

    it("should reflect purchased credits", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      const result = await caller().agentCredits.getBalance();
      expect(result.balance).toBe(500);
    });

    it("should reflect accumulated purchases", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "2500" });
      const result = await caller().agentCredits.getBalance();
      expect(result.balance).toBe(3000);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().agentCredits.getBalance()).rejects.toThrow();
    });
  });

  // ── purchaseCredits ───────────────────────────────────────────────────────

  describe("purchaseCredits", () => {
    it("should purchase 500 credits", async () => {
      const result = await caller().agentCredits.purchaseCredits({ amount: "500" });
      expect(result.success).toBe(true);
      expect(result.creditsAdded).toBe(500);
      expect(result.newBalance).toBe(500);
      expect(result.transactionId).toBeDefined();
    });

    it("should purchase 2500 credits", async () => {
      const result = await caller().agentCredits.purchaseCredits({ amount: "2500" });
      expect(result.success).toBe(true);
      expect(result.creditsAdded).toBe(2500);
      expect(result.newBalance).toBe(2500);
    });

    it("should purchase 10000 credits", async () => {
      const result = await caller().agentCredits.purchaseCredits({ amount: "10000" });
      expect(result.success).toBe(true);
      expect(result.creditsAdded).toBe(10000);
      expect(result.newBalance).toBe(10000);
    });

    it("should reject invalid credit tier", async () => {
      await expect(
        caller().agentCredits.purchaseCredits({ amount: "999" as any })
      ).rejects.toThrow();
    });

    it("should accumulate balance correctly", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      const result = await caller().agentCredits.purchaseCredits({ amount: "500" });
      expect(result.newBalance).toBe(1000);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().agentCredits.purchaseCredits({ amount: "500" })
      ).rejects.toThrow();
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe("getHistory", () => {
    it("should return empty history for new user", async () => {
      const result = await caller().agentCredits.getHistory();
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should return purchase entries", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "2500" });

      const result = await caller().agentCredits.getHistory();
      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should return entries in reverse chronological order", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "2500" });

      const result = await caller().agentCredits.getHistory();
      // Latest entry should be the 2500 purchase (higher balance)
      expect(result.entries[0].amount).toBe(2500);
      expect(result.entries[1].amount).toBe(500);
    });

    it("should respect limit parameter", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "500" });

      const result = await caller().agentCredits.getHistory({ limit: 2, offset: 0 });
      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it("should respect offset parameter", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });
      await caller().agentCredits.purchaseCredits({ amount: "2500" });
      await caller().agentCredits.purchaseCredits({ amount: "10000" });

      const result = await caller().agentCredits.getHistory({ limit: 2, offset: 1 });
      expect(result.entries).toHaveLength(2);
      expect(result.offset).toBe(1);
    });

    it("should include balance and reason in entries", async () => {
      await caller().agentCredits.purchaseCredits({ amount: "500" });

      const result = await caller().agentCredits.getHistory();
      expect(result.entries[0].balance).toBe(500);
      expect(result.entries[0].reason).toBe("purchase");
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().agentCredits.getHistory()).rejects.toThrow();
    });
  });

  // ── getCallHistory ────────────────────────────────────────────────────────

  describe("getCallHistory", () => {
    it("should return empty calls when user has no deployments", async () => {
      const result = await caller().agentCredits.getCallHistory();
      expect(result.calls).toEqual([]);
    });

    it("should return empty calls when deployments have no calls", async () => {
      // Seed a deployment
      dbHolder.raw.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
        VALUES ('dep-001', '${TEST_USER_ID}', 'Test Bot', 'openclaw', 1, 'running');
      `);
      const result = await caller().agentCredits.getCallHistory();
      expect(result.calls).toEqual([]);
    });

    it("should return calls for user's deployments", async () => {
      dbHolder.raw.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
        VALUES ('dep-001', '${TEST_USER_ID}', 'Test Bot', 'openclaw', 1, 'running');
      `);
      dbHolder.raw.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
        VALUES ('dep-callee', '${TEST_USER_ID}', 'Callee Bot', 'openclaw', 1, 'running');
      `);
      dbHolder.raw.exec(`
        INSERT INTO agent_calls (id, caller_deployment_id, callee_deployment_id, skill_name, credits_charged, status)
        VALUES ('call-001', 'dep-001', 'dep-callee', 'web_search', 5, 'completed');
      `);

      const result = await caller().agentCredits.getCallHistory();
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].skillName).toBe("web_search");
      expect(result.calls[0].creditsCharged).toBe(5);
    });

    it("should filter by deploymentId", async () => {
      dbHolder.raw.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
        VALUES ('dep-001', '${TEST_USER_ID}', 'Bot A', 'openclaw', 1, 'running'),
               ('dep-002', '${TEST_USER_ID}', 'Bot B', 'openclaw', 1, 'running'),
               ('dep-callee', '${TEST_USER_ID}', 'Callee', 'openclaw', 1, 'running');
      `);
      dbHolder.raw.exec(`
        INSERT INTO agent_calls (id, caller_deployment_id, callee_deployment_id, skill_name, credits_charged, status)
        VALUES ('call-001', 'dep-001', 'dep-callee', 'skill_a', 5, 'completed'),
               ('call-002', 'dep-002', 'dep-callee', 'skill_b', 3, 'completed');
      `);

      const result = await caller().agentCredits.getCallHistory({
        deploymentId: "dep-001",
      });
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].skillName).toBe("skill_a");
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().agentCredits.getCallHistory()).rejects.toThrow();
    });
  });
});
