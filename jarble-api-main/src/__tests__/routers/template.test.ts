/**
 * Integration tests for the template tRPC router.
 *
 * Tests the list procedure (the only procedure in this router).
 * Templates are hardcoded constants, not DB-backed.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks (required because appRouter imports all routers) ──────────────────

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

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
  syncMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
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
});

afterAll(() => {
  ctx?.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("template.list", () => {
  it("returns an array of templates", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns templates with required fields", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    for (const t of result) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("defaultModel");
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.defaultModel).toBe("string");
    }
  });

  it("includes personal template", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    const personal = result.find((t: any) => t.id === "personal");
    expect(personal).toBeDefined();
    expect(personal!.name).toBe("Personal Assistant");
  });

  it("includes business template", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    const business = result.find((t: any) => t.id === "business");
    expect(business).toBeDefined();
    expect(business!.name).toBe("Business Helper");
  });

  it("includes support template", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    const support = result.find((t: any) => t.id === "support");
    expect(support).toBeDefined();
    expect(support!.name).toBe("Support Agent");
  });

  it("is accessible without authentication (public procedure)", async () => {
    const caller = createAnonymousCaller(ctx.db);
    // Should not throw
    const result = await caller.template.list();
    expect(result.length).toBeGreaterThan(0);
  });

  it("is accessible with authentication too", async () => {
    const caller = createTestCaller(ctx.db, {
      id: ctx.testUserId,
      email: "test@jarble.ai",
      name: "Test User",
      auth0Id: ctx.testAuth0Id,
      emailVerified: true,
    });

    const result = await caller.template.list();
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns exactly 3 templates", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    expect(result).toHaveLength(3);
  });

  it("all templates have unique IDs", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    const ids = result.map((t: any) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates use a valid model", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.template.list();

    for (const t of result) {
      // Model should follow provider/model format
      expect(t.defaultModel).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
    }
  });

  it("returns consistent results across calls", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const result1 = await caller.template.list();
    const result2 = await caller.template.list();

    expect(result1).toEqual(result2);
  });
});
