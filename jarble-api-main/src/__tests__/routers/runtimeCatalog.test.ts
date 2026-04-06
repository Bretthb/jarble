/**
 * Integration tests for the runtimeCatalog tRPC router.
 *
 * Tests list, getById, getBySlug, and getCapabilities procedures.
 * Uses real in-memory SQLite with seeded runtime data.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../runtimes/index.js", () => ({
  getHandlerOrNull: vi.fn((slug: string) => {
    if (slug === "openclaw") {
      return {
        slug: "openclaw",
        name: "OpenClaw",
        capabilities: ["web-chat", "discord", "telegram", "whatsapp"],
        configFiles: ["openclaw.json"],
      };
    }
    if (slug === "zeroclaw") {
      return {
        slug: "zeroclaw",
        name: "ZeroClaw",
        capabilities: ["web-chat"],
        configFiles: ["zeroclaw.json"],
      };
    }
    return null;
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

describe("runtimeCatalog router", () => {
  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("should return all active runtimes", async () => {
      const result = await anonCaller().runtimeCatalog.list();
      expect(result).toHaveLength(2);
    });

    it("should include openclaw and zeroclaw", async () => {
      const result = await anonCaller().runtimeCatalog.list();
      const slugs = result.map((r) => r.slug);
      expect(slugs).toContain("openclaw");
      expect(slugs).toContain("zeroclaw");
    });

    it("should return runtimes sorted by name", async () => {
      const result = await anonCaller().runtimeCatalog.list();
      const names = result.map((r) => r.name);
      expect(names).toEqual([...names].sort());
    });

    it("should not return inactive runtimes", async () => {
      ctx.raw.exec(`UPDATE runtime_catalog SET is_active = 0 WHERE slug = 'zeroclaw'`);
      const result = await anonCaller().runtimeCatalog.list();
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("openclaw");
    });

    it("should include expected fields on each runtime", async () => {
      const result = await anonCaller().runtimeCatalog.list();
      const oc = result.find((r) => r.slug === "openclaw")!;
      expect(oc.name).toBe("OpenClaw");
      expect(oc.dockerImage).toBeDefined();
      expect(oc.cpuLimit).toBeDefined();
      expect(oc.memoryMb).toBeDefined();
    });

    it("should work for authenticated callers too", async () => {
      const result = await caller().runtimeCatalog.list();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("should return a runtime by ID", async () => {
      const result = await anonCaller().runtimeCatalog.getById({ id: ctx.openclawCatalogId });
      expect(result).toBeDefined();
      expect(result!.slug).toBe("openclaw");
    });

    it("should return undefined for non-existent ID", async () => {
      const result = await anonCaller().runtimeCatalog.getById({ id: 9999 });
      expect(result).toBeUndefined();
    });
  });

  // ── getBySlug ─────────────────────────────────────────────────────────────

  describe("getBySlug", () => {
    it("should return openclaw by slug", async () => {
      const result = await anonCaller().runtimeCatalog.getBySlug({ slug: "openclaw" });
      expect(result).toBeDefined();
      expect(result!.name).toBe("OpenClaw");
      expect(result!.id).toBe(ctx.openclawCatalogId);
    });

    it("should return zeroclaw by slug", async () => {
      const result = await anonCaller().runtimeCatalog.getBySlug({ slug: "zeroclaw" });
      expect(result).toBeDefined();
      expect(result!.name).toBe("ZeroClaw");
    });

    it("should return undefined for non-existent slug", async () => {
      const result = await anonCaller().runtimeCatalog.getBySlug({ slug: "nonexistent" });
      expect(result).toBeUndefined();
    });
  });

  // ── getCapabilities ───────────────────────────────────────────────────────

  describe("getCapabilities", () => {
    it("should return capabilities for openclaw", async () => {
      const result = await anonCaller().runtimeCatalog.getCapabilities({ slug: "openclaw" });
      expect(result).toBeDefined();
      expect(result!.slug).toBe("openclaw");
      expect(result!.capabilities).toContain("web-chat");
      expect(result!.capabilities).toContain("discord");
    });

    it("should return capabilities for zeroclaw", async () => {
      const result = await anonCaller().runtimeCatalog.getCapabilities({ slug: "zeroclaw" });
      expect(result).toBeDefined();
      expect(result!.capabilities).toContain("web-chat");
    });

    it("should return null for unknown runtime slug", async () => {
      const result = await anonCaller().runtimeCatalog.getCapabilities({ slug: "unknown" });
      expect(result).toBeNull();
    });

    it("should include configFiles in the response", async () => {
      const result = await anonCaller().runtimeCatalog.getCapabilities({ slug: "openclaw" });
      expect(result!.configFiles).toEqual(["openclaw.json"]);
    });
  });
});
