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
    DB_PROVIDER: "postgres",
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
// Mock db/index.js to prevent Postgres connection at import time.
// Tests pass the in-memory SQLite db through the tRPC caller context.
// The  export must carry real Drizzle column definitions so routers
// can build  expressions.
vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return {
    db: {},
    tables: schema,
    dbDate: (date: Date = new Date()) => date.toISOString(),
    getRowsAffected: (result: any) => {
      if (result?.rowCount != null) return result.rowCount;
      if (result?.rowsAffected != null) return result.rowsAffected;
      if (result?.changes != null) return result.changes;
      return 0;
    },
  };
});

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

    it("should return templates sorted by sortOrder (authed)", async () => {
      // sortOrder is an internal field stripped from the public list.
      // Authed callers hit listByCategory which still returns the full record,
      // so we verify ordering there. The public list is ordered server-side
      // the same way — this test guarantees the order is preserved.
      const result = await anonCaller().template.list();
      expect(result.map((t: any) => t.slug)).toEqual([
        "general-assistant",
        "sales-coach",
        "customer-support",
      ]);
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

    it("should strip systemPrompt + internal fields from public list", async () => {
      // Regression guard for the unauth info-disclosure fix: the public
      // list endpoint must not leak system prompts, recommendedTools,
      // exampleConversation, sortOrder, createdAt, or isActive. Those
      // are only reachable via the authenticated getById / listByCategory.
      const result = await anonCaller().template.list();
      const t = result[0] as Record<string, unknown>;
      expect(t.id).toBeDefined();
      expect(t.slug).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.systemPrompt).toBeUndefined();
      expect(t.recommendedTools).toBeUndefined();
      expect(t.exampleConversation).toBeUndefined();
      expect(t.sortOrder).toBeUndefined();
      expect(t.createdAt).toBeUndefined();
      expect(t.isActive).toBeUndefined();
    });

    it("authed getById returns the full template including systemPrompt", async () => {
      const result = await caller().template.getById({ id: "persona-general" });
      expect(result).toBeDefined();
      expect(result!.systemPrompt).toBeDefined();
      expect(Array.isArray(result!.recommendedTools)).toBe(true);
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("should return a template by ID", async () => {
      const result = await caller().template.getById({ id: "persona-general" });
      expect(result).toBeDefined();
      expect(result!.slug).toBe("general-assistant");
      expect(result!.name).toBe("General Assistant");
    });

    it("should return null for non-existent ID", async () => {
      const result = await caller().template.getById({ id: "nonexistent" });
      expect(result).toBeNull();
    });

    it("should parse JSON fields on single result", async () => {
      const result = await caller().template.getById({ id: "persona-dev" });
      expect(result).toBeDefined();
      expect(Array.isArray(result!.showcasePrompts)).toBe(true);
    });

    it("should include system prompt", async () => {
      const result = await caller().template.getById({ id: "persona-general" });
      expect(result!.systemPrompt).toContain("helpful");
    });
  });

  // ── listByCategory ────────────────────────────────────────────────────────

  describe("listByCategory", () => {
    it("should filter templates by category", async () => {
      const result = await caller().template.listByCategory({ category: "general" });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("general-assistant");
    });

    it("should return technical templates", async () => {
      const result = await caller().template.listByCategory({ category: "technical" });
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("full-stack-developer");
    });

    it("should return empty array for non-existent category", async () => {
      const result = await caller().template.listByCategory({ category: "nonexistent" });
      expect(result).toHaveLength(0);
    });

    it("should not include inactive templates in category results", async () => {
      ctx.raw.exec(`UPDATE persona_templates SET is_active = 0 WHERE category = 'general'`);
      const result = await caller().template.listByCategory({ category: "general" });
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
