/**
 * Integration tests for the benchmarks tRPC router.
 *
 * Tests domain CRUD, deployment ratings, leaderboard, service metrics,
 * service reviews, and admin curation procedures.
 * Uses real in-memory SQLite with seeded data.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/admin.js", () => {
  const adminIds = new Set(["admin-bench-001"]);
  return {
    isAdmin: (userId: string) => adminIds.has(userId),
    getAdminUserIds: () => adminIds,
  };
});

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
const DEPLOYMENT_ID = "dep-bench-001";
const DOMAIN_ID = "dom_test_domain1";

function seedData() {
  // Deployment owned by test user
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, is_public)
    VALUES ('${DEPLOYMENT_ID}', '${ctx.testUserId}', 'Bench Bot', 'openclaw', ${ctx.openclawCatalogId}, 'running', 1);
  `);

  // Domain
  ctx.raw.exec(`
    INSERT INTO domains (id, name, display_name, description, sort_order)
    VALUES ('${DOMAIN_ID}', 'data-analysis', 'Data Analysis', 'Data analytics domain', 0);
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

function adminCaller() {
  ctx.raw.exec(`
    INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified)
    VALUES ('admin-bench-001', 'admin@jarble.ai', 'Admin', 'auth0|admin-bench', 1);
  `);
  return createTestCaller(ctx.db, {
    id: "admin-bench-001",
    email: "admin@jarble.ai",
    name: "Admin",
    auth0Id: "auth0|admin-bench",
    emailVerified: true,
  });
}

function anonCaller() {
  return createAnonymousCaller(ctx.db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("benchmarks router", () => {
  // ── listDomains ───────────────────────────────────────────────────────────

  describe("listDomains", () => {
    it("should return root domains", async () => {
      const result = await anonCaller().benchmarks.listDomains();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("data-analysis");
    });

    it("should return child domains when parentId is specified", async () => {
      ctx.raw.exec(`
        INSERT INTO domains (id, name, display_name, parent_id, sort_order)
        VALUES ('dom_child_1', 'pandas', 'Pandas', '${DOMAIN_ID}', 0);
      `);
      const result = await anonCaller().benchmarks.listDomains({ parentId: DOMAIN_ID });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pandas");
    });

    it("should return empty array for parentId with no children", async () => {
      const result = await anonCaller().benchmarks.listDomains({ parentId: "nonexistent" });
      expect(result).toEqual([]);
    });
  });

  // ── createDomain ──────────────────────────────────────────────────────────

  describe("createDomain", () => {
    it("should create a new domain", async () => {
      const result = await caller().benchmarks.createDomain({
        name: "machine-learning",
        displayName: "Machine Learning",
      });
      expect(result.id).toBeDefined();
      expect(result.name).toBe("machine-learning");
    });

    it("should create a child domain", async () => {
      const result = await caller().benchmarks.createDomain({
        name: "time-series",
        displayName: "Time Series",
        parentId: DOMAIN_ID,
      });
      expect(result.id).toBeDefined();
    });

    it("should reject duplicate domain name", async () => {
      await expect(
        caller().benchmarks.createDomain({
          name: "data-analysis",
          displayName: "Duplicate",
        })
      ).rejects.toThrow("already exists");
    });

    it("should reject non-existent parent", async () => {
      await expect(
        caller().benchmarks.createDomain({
          name: "orphan-domain",
          displayName: "Orphan",
          parentId: "nonexistent-parent",
        })
      ).rejects.toThrow("Parent domain not found");
    });

    it("should reject non-kebab-case name", async () => {
      await expect(
        caller().benchmarks.createDomain({
          name: "Invalid Name",
          displayName: "Invalid",
        })
      ).rejects.toThrow();
    });

    it("should reject name starting with digit", async () => {
      await expect(
        caller().benchmarks.createDomain({
          name: "1-bad-start",
          displayName: "Bad",
        })
      ).rejects.toThrow();
    });

    it("should accept optional description and icon", async () => {
      const result = await caller().benchmarks.createDomain({
        name: "nlp-tasks",
        displayName: "NLP",
        description: "Natural Language Processing",
        icon: "brain",
      });
      expect(result.id).toBeDefined();
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().benchmarks.createDomain({
          name: "anon-domain",
          displayName: "Anon",
        })
      ).rejects.toThrow();
    });
  });

  // ── rateDeployment ────────────────────────────────────────────────────────

  describe("rateDeployment", () => {
    it("should create a rating and return scores", async () => {
      const result = await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 4,
        helpfulness: 5,
        creativity: 3,
      });
      expect(result.ratingId).toBeDefined();
      expect(result.overallScore).toBeDefined();
      expect(result.ratingCount).toBe(1);
      expect(result.confidence).toBe("low");
    });

    it("should upsert an existing rating", async () => {
      await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 3,
        helpfulness: 3,
        creativity: 3,
      });
      const result = await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 5,
        helpfulness: 5,
        creativity: 5,
      });
      // Still only 1 rating (upserted, not duplicated)
      expect(result.ratingCount).toBe(1);
      // Score should reflect the updated 5/5/5 rating
      expect(result.overallScore).toBe(500);
    });

    it("should accept optional comment", async () => {
      const result = await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 4,
        helpfulness: 4,
        creativity: 4,
        comment: "Great bot for data analysis!",
      });
      expect(result.ratingId).toBeDefined();
    });

    it("should reject non-existent deployment", async () => {
      await expect(
        caller().benchmarks.rateDeployment({
          deploymentId: "nonexistent",
          domainId: DOMAIN_ID,
          accuracy: 4,
          helpfulness: 4,
          creativity: 4,
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject non-existent domain", async () => {
      await expect(
        caller().benchmarks.rateDeployment({
          deploymentId: DEPLOYMENT_ID,
          domainId: "nonexistent",
          accuracy: 4,
          helpfulness: 4,
          creativity: 4,
        })
      ).rejects.toThrow("Domain not found");
    });

    it("should reject ratings out of 1-5 range", async () => {
      await expect(
        caller().benchmarks.rateDeployment({
          deploymentId: DEPLOYMENT_ID,
          domainId: DOMAIN_ID,
          accuracy: 0,
          helpfulness: 4,
          creativity: 4,
        })
      ).rejects.toThrow();
    });

    it("should reject ratings above 5", async () => {
      await expect(
        caller().benchmarks.rateDeployment({
          deploymentId: DEPLOYMENT_ID,
          domainId: DOMAIN_ID,
          accuracy: 6,
          helpfulness: 4,
          creativity: 4,
        })
      ).rejects.toThrow();
    });
  });

  // ── getDeploymentRatings ──────────────────────────────────────────────────

  describe("getDeploymentRatings", () => {
    it("should return empty array when no ratings", async () => {
      const result = await anonCaller().benchmarks.getDeploymentRatings({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual([]);
    });

    it("should return ratings with domain info after rating", async () => {
      await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 4,
        helpfulness: 5,
        creativity: 3,
      });

      const result = await anonCaller().benchmarks.getDeploymentRatings({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toHaveLength(1);
      expect(result[0].domainName).toBe("data-analysis");
      expect(result[0].domainDisplayName).toBe("Data Analysis");
      expect(result[0].accuracy).toBe(4);
    });
  });

  // ── setSpecialties ────────────────────────────────────────────────────────

  describe("setSpecialties", () => {
    it("should set specialties for a deployment", async () => {
      const result = await caller().benchmarks.setSpecialties({
        deploymentId: DEPLOYMENT_ID,
        specialties: ["data-analysis", "python"],
        bio: "An expert data analysis bot.",
      });
      expect(result).toEqual({ success: true });
    });

    it("should reject non-owned deployment", async () => {
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
        other.benchmarks.setSpecialties({
          deploymentId: DEPLOYMENT_ID,
          specialties: ["hacking"],
        })
      ).rejects.toThrow("You do not own this deployment");
    });

    it("should reject more than 5 specialties", async () => {
      await expect(
        caller().benchmarks.setSpecialties({
          deploymentId: DEPLOYMENT_ID,
          specialties: ["a", "b", "c", "d", "e", "f"],
        })
      ).rejects.toThrow();
    });
  });

  // ── getPublicProfile ──────────────────────────────────────────────────────

  describe("getPublicProfile", () => {
    it("should return profile for a public deployment", async () => {
      const result = await anonCaller().benchmarks.getPublicProfile({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result.id).toBe(DEPLOYMENT_ID);
      expect(result.name).toBe("Bench Bot");
    });

    it("should reject non-public deployment", async () => {
      ctx.raw.exec(`UPDATE deployments SET is_public = 0 WHERE id = '${DEPLOYMENT_ID}'`);
      await expect(
        anonCaller().benchmarks.getPublicProfile({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("not public");
    });

    it("should reject non-existent deployment", async () => {
      await expect(
        anonCaller().benchmarks.getPublicProfile({ deploymentId: "nonexistent" })
      ).rejects.toThrow("Deployment not found");
    });

    it("should include domain scores after rating", async () => {
      await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 4,
        helpfulness: 5,
        creativity: 3,
      });
      const result = await anonCaller().benchmarks.getPublicProfile({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result.domainScores).toHaveLength(1);
      expect(result.domainScores[0].domainName).toBe("data-analysis");
    });
  });

  // ── leaderboard ───────────────────────────────────────────────────────────

  describe("leaderboard", () => {
    it("should reject non-existent domain slug", async () => {
      await expect(
        anonCaller().benchmarks.leaderboard({
          domainSlug: "nonexistent",
        })
      ).rejects.toThrow("not found");
    });

    it("should return empty leaderboard when no ratings meet threshold", async () => {
      // Only 1 rating, leaderboard requires >= 3
      await caller().benchmarks.rateDeployment({
        deploymentId: DEPLOYMENT_ID,
        domainId: DOMAIN_ID,
        accuracy: 5,
        helpfulness: 5,
        creativity: 5,
      });
      const result = await anonCaller().benchmarks.leaderboard({
        domainSlug: "data-analysis",
      });
      expect(result.entries).toHaveLength(0);
    });

    it("should return leaderboard domain metadata", async () => {
      const result = await anonCaller().benchmarks.leaderboard({
        domainSlug: "data-analysis",
      });
      expect(result.domain.displayName).toBe("Data Analysis");
      expect(result.metric).toBe("overall");
    });
  });

  // ── adminFeature / adminUnfeature ─────────────────────────────────────────

  describe("adminFeature", () => {
    it.skip("should feature a public deployment", async () => { // TODO: SQLite Date binding issue
      const result = await adminCaller().benchmarks.adminFeature({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ success: true, deploymentId: DEPLOYMENT_ID });
    });

    it("should reject non-admin user", async () => {
      await expect(
        caller().benchmarks.adminFeature({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("Admin access required");
    });

    it("should reject non-public deployment", async () => {
      ctx.raw.exec(`UPDATE deployments SET is_public = 0 WHERE id = '${DEPLOYMENT_ID}'`);
      await expect(
        adminCaller().benchmarks.adminFeature({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("must be public");
    });

    it("should reject non-existent deployment", async () => {
      await expect(
        adminCaller().benchmarks.adminFeature({ deploymentId: "nonexistent" })
      ).rejects.toThrow("Deployment not found");
    });
  });

  describe("adminUnfeature", () => {
    it.skip("should unfeature a deployment", async () => { // TODO: SQLite Date binding issue
      await adminCaller().benchmarks.adminFeature({ deploymentId: DEPLOYMENT_ID });
      const result = await adminCaller().benchmarks.adminUnfeature({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result).toEqual({ success: true, deploymentId: DEPLOYMENT_ID });
    });

    it("should reject non-admin user", async () => {
      await expect(
        caller().benchmarks.adminUnfeature({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("Admin access required");
    });
  });

  // ── getServiceMetrics ─────────────────────────────────────────────────────

  describe("getServiceMetrics", () => {
    it("should return empty metrics for non-existent service", async () => {
      const result = await anonCaller().benchmarks.getServiceMetrics({
        serviceId: "svc-nonexistent",
      });
      expect(result.metrics).toEqual([]);
      expect(result.period).toBe("7d");
    });
  });

  // ── serviceLeaderboard ────────────────────────────────────────────────────

  describe("serviceLeaderboard", () => {
    it("should return empty leaderboard with no published services", async () => {
      const result = await anonCaller().benchmarks.serviceLeaderboard({
        metric: "popularity",
      });
      expect(result.entries).toEqual([]);
    });

    it("should accept different metrics", async () => {
      const pop = await anonCaller().benchmarks.serviceLeaderboard({ metric: "popularity" });
      expect(pop.metric).toBe("popularity");

      const rel = await anonCaller().benchmarks.serviceLeaderboard({ metric: "reliability" });
      expect(rel.metric).toBe("reliability");

      const spd = await anonCaller().benchmarks.serviceLeaderboard({ metric: "speed" });
      expect(spd.metric).toBe("speed");
    });
  });
});
