/**
 * Integration tests for the skills tRPC router.
 *
 * Tests listCatalog, listForDeployment, install, and uninstall procedures.
 * Uses real in-memory SQLite with seeded skills catalog.
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
const DEPLOYMENT_ID = "dep-skills-001";
const SKILL_ID_1 = "skill-web-search";
const SKILL_ID_2 = "skill-image-gen";

function seedData() {
  // Seed deployment
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
    VALUES ('${DEPLOYMENT_ID}', '${ctx.testUserId}', 'Skill Bot', 'openclaw', ${ctx.openclawCatalogId}, 'running');
  `);

  // Seed skills catalog
  ctx.raw.exec(`
    INSERT INTO skills_catalog (id, name, description, runtime, config, author, is_official)
    VALUES
      ('${SKILL_ID_1}', 'Web Search', 'Search the web', 'openclaw', '{"tool":"web_search"}', 'Jarble', 1),
      ('${SKILL_ID_2}', 'Image Generation', 'Generate images', 'openclaw', '{"tool":"image_gen"}', 'Jarble', 1),
      ('skill-zclaw-only', 'ZeroClaw Skill', 'Only for zeroclaw', 'zeroclaw', '{"tool":"zc_special"}', 'Jarble', 0);
  `);
}

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  seedData();
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

describe("skills router", () => {
  // ── listCatalog ───────────────────────────────────────────────────────────

  describe("listCatalog", () => {
    it("should return all skills when no filter", async () => {
      const result = await caller().skills.listCatalog();
      expect(result).toHaveLength(3);
    });

    it("should filter by runtime", async () => {
      const result = await caller().skills.listCatalog({ runtime: "openclaw" });
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.runtime === "openclaw")).toBe(true);
    });

    it("should filter zeroclaw skills", async () => {
      const result = await caller().skills.listCatalog({ runtime: "zeroclaw" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("skill-zclaw-only");
    });

    it("should return empty for non-existent runtime", async () => {
      const result = await caller().skills.listCatalog({ runtime: "nonexistent" });
      expect(result).toHaveLength(0);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().skills.listCatalog()).rejects.toThrow();
    });

    it("should include expected fields", async () => {
      const result = await caller().skills.listCatalog();
      const skill = result.find((s) => s.id === SKILL_ID_1)!;
      expect(skill.name).toBe("Web Search");
      expect(skill.description).toBe("Search the web");
      expect(skill.config).toBeDefined();
    });
  });

  // ── install ───────────────────────────────────────────────────────────────

  describe("install", () => {
    it("should install a skill on a deployment", async () => {
      const result = await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      expect(result).toEqual({ success: true });
    });

    it("should reject installing a non-existent skill", async () => {
      await expect(
        caller().skills.install({
          deploymentId: DEPLOYMENT_ID,
          skillId: "skill-nonexistent",
        })
      ).rejects.toThrow("Skill not found");
    });

    it("should reject installing on a non-owned deployment", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      const other = createTestCaller(ctx.db, {
        id: "other-user",
        email: "other@jarble.ai",
        name: "Other",
        auth0Id: "auth0|other",
        emailVerified: true,
      });
      await expect(
        other.skills.install({
          deploymentId: DEPLOYMENT_ID,
          skillId: SKILL_ID_1,
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject duplicate installation", async () => {
      await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      await expect(
        caller().skills.install({
          deploymentId: DEPLOYMENT_ID,
          skillId: SKILL_ID_1,
        })
      ).rejects.toThrow("Skill already installed");
    });

    it("should allow installing multiple different skills", async () => {
      await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      const result = await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_2,
      });
      expect(result).toEqual({ success: true });
    });
  });

  // ── listForDeployment ─────────────────────────────────────────────────────

  describe("listForDeployment", () => {
    it("should return empty array when no skills installed", async () => {
      const result = await caller().skills.listForDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual([]);
    });

    it("should return installed skills with details", async () => {
      await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      const result = await caller().skills.listForDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toHaveLength(1);
      expect(result[0].skill).toBeDefined();
      expect(result[0].skill!.name).toBe("Web Search");
      expect(result[0].installId).toBeDefined();
      expect(result[0].installedAt).toBeDefined();
    });

    it("should reject non-owned deployment", async () => {
      ctx.raw.exec(`
        INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      const other = createTestCaller(ctx.db, {
        id: "other-user",
        email: "other@jarble.ai",
        name: "Other",
        auth0Id: "auth0|other",
        emailVerified: true,
      });
      await expect(
        other.skills.listForDeployment({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("Deployment not found");
    });

    it("should return multiple installed skills", async () => {
      await caller().skills.install({ deploymentId: DEPLOYMENT_ID, skillId: SKILL_ID_1 });
      await caller().skills.install({ deploymentId: DEPLOYMENT_ID, skillId: SKILL_ID_2 });
      const result = await caller().skills.listForDeployment({ deploymentId: DEPLOYMENT_ID });
      expect(result).toHaveLength(2);
    });
  });

  // ── uninstall ─────────────────────────────────────────────────────────────

  describe("uninstall", () => {
    it("should uninstall an installed skill", async () => {
      await caller().skills.install({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      const result = await caller().skills.uninstall({
        deploymentId: DEPLOYMENT_ID,
        skillId: SKILL_ID_1,
      });
      expect(result).toEqual({ success: true });

      const remaining = await caller().skills.listForDeployment({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(remaining).toHaveLength(0);
    });

    it("should reject uninstalling a skill that is not installed", async () => {
      await expect(
        caller().skills.uninstall({
          deploymentId: DEPLOYMENT_ID,
          skillId: SKILL_ID_1,
        })
      ).rejects.toThrow("Skill is not installed");
    });

    it("should reject uninstalling from non-owned deployment", async () => {
      ctx.raw.exec(`
        INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      const other = createTestCaller(ctx.db, {
        id: "other-user",
        email: "other@jarble.ai",
        name: "Other",
        auth0Id: "auth0|other",
        emailVerified: true,
      });
      await expect(
        other.skills.uninstall({
          deploymentId: DEPLOYMENT_ID,
          skillId: SKILL_ID_1,
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should only uninstall the specified skill", async () => {
      await caller().skills.install({ deploymentId: DEPLOYMENT_ID, skillId: SKILL_ID_1 });
      await caller().skills.install({ deploymentId: DEPLOYMENT_ID, skillId: SKILL_ID_2 });

      await caller().skills.uninstall({ deploymentId: DEPLOYMENT_ID, skillId: SKILL_ID_1 });

      const remaining = await caller().skills.listForDeployment({ deploymentId: DEPLOYMENT_ID });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].skill!.id).toBe(SKILL_ID_2);
    });
  });
});
