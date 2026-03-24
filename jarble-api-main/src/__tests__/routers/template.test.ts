/**
 * Integration tests for the template tRPC router.
 *
 * Tests list, getById, listByCategory, and getCategories procedures.
 * Uses real in-memory SQLite with seeded persona template data.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

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

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterAll(() => {
  if (ctx) ctx.raw.close();
});

function anonCaller() {
  return createAnonymousCaller(ctx.db);
}

function caller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("template router", () => {
  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("should return all active persona templates", async () => {
      const result = await anonCaller().template.list();
      expect(result).toHaveLength(3);
    });

    it("should return templates sorted by sortOrder", async () => {
      const result = await anonCaller().template.list();
      const orders = result.map((t: any) => t.sortOrder);
      expect(orders).toEqual([0, 1, 2]);
    });

    it("should not return inactive templates", async () => {
      ctx.raw.exec(`UPDATE persona_templates SET is_active = 0 WHERE slug = 'sales-coach'`);
      const result = await anonCaller().template.list();
      expect(result).toHaveLength(2);
    });

    it("should parse showcasePrompts JSON field", async () => {
      const result = await anonCaller().template.list();
      const general = result.find((t: any) => t.slug === "general-assistant");
      expect(general).toBeDefined();
      expect(Array.isArray(general!.showcasePrompts)).toBe(true);
      expect(general!.showcasePrompts.length).toBeGreaterThan(0);
    });

    it("should return parsed recommendedTools as array", async () => {
      const result = await anonCaller().template.list();
      // recommendedTools is null in seed data, should return []
      expect(result[0].recommendedTools).toEqual([]);
    });

    it("should return parsed exampleConversation as array", async () => {
      const result = await anonCaller().template.list();
      expect(result[0].exampleConversation).toEqual([]);
    });

    it("should include all expected fields", async () => {
      const result = await anonCaller().template.list();
      const t = result[0];
      expect(t.id).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.slug).toBeDefined();
      expect(t.category).toBeDefined();
      expect(t.systemPrompt).toBeDefined();
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("should return a template by ID", async () => {
      const result = await anonCaller().template.getById({ id: "persona-general" });
      expect(result).toBeDefined();
      expect(result!.slug).toBe("general-assistant");
      expect(result!.name).toBe("General Assistant");
    });

    it("should return null for non-existent ID", async () => {
      const result = await anonCaller().template.getById({ id: "nonexistent" });
      expect(result).toBeNull();
    });

    it("should parse JSON fields on single result", async () => {
      const result = await anonCaller().template.getById({ id: "persona-dev" });
      expect(result).toBeDefined();
      expect(Array.isArray(result!.showcasePrompts)).toBe(true);
    });

    it("should include system prompt", async () => {
      const result = await anonCaller().template.getById({ id: "persona-general" });
      expect(result!.systemPrompt).toContain("helpful");
    });
  });

  // ── listByCategory ────────────────────────────────────────────────────────

  describe("listByCategory", () => {
    it("should filter templates by category", async () => {
      const result = await anonCaller().template.listByCategory({ category: "general" });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("general-assistant");
    });

    it("should return technical templates", async () => {
      const result = await anonCaller().template.listByCategory({ category: "technical" });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("full-stack-developer");
    });

    it("should return empty array for non-existent category", async () => {
      const result = await anonCaller().template.listByCategory({ category: "nonexistent" });
      expect(result).toHaveLength(0);
    });

    it("should not include inactive templates in category results", async () => {
      ctx.raw.exec(`UPDATE persona_templates SET is_active = 0 WHERE category = 'general'`);
      const result = await anonCaller().template.listByCategory({ category: "general" });
      expect(result).toHaveLength(0);
    });
  });

  // ── getCategories ─────────────────────────────────────────────────────────

  describe("getCategories", () => {
    it("should return distinct categories with counts", async () => {
      const result = await anonCaller().template.getCategories();
      expect(result.length).toBe(3);
    });

    it("should include correct category names", async () => {
      const result = await anonCaller().template.getCategories();
      const categories = result.map((c: any) => c.category).sort();
      expect(categories).toEqual(["business", "general", "technical"]);
    });

    it("should have count of 1 for each seeded category", async () => {
      const result = await anonCaller().template.getCategories();
      for (const cat of result) {
        expect(cat.count).toBe(1);
      }
    });

    it("should not count inactive templates", async () => {
      ctx.raw.exec(`UPDATE persona_templates SET is_active = 0 WHERE category = 'general'`);
      const result = await anonCaller().template.getCategories();
      const general = result.find((c: any) => c.category === "general");
      expect(general).toBeUndefined();
    });
  });
});
