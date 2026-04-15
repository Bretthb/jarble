/**
 * Access-control tests for the deployment tRPC router (JAR-83).
 *
 * Verifies that `findDeploymentWithAccess` replacements allow org members
 * the correct access to deployments owned by their org, and reject
 * non-members / insufficient roles appropriately.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

// ── Mocks (mirror deployment.test.ts so the router imports resolve) ──────────
vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20, percentUsed: 5 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "hello", podName: "pod-1" }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
  appsApi: {},
  NAMESPACE: "jarble-test",
}));

vi.mock("../../k8s/nodeManager.js", () => ({
  ensureCapacityForDeployment: vi.fn().mockResolvedValue(undefined),
  checkScaleDown: vi.fn().mockResolvedValue(undefined),
  getCapacityStatus: vi.fn().mockResolvedValue({ totalNodes: 0, managedNodes: 0, maxManagedNodes: 0, availableSlots: 0, nodes: [] }),
  CapacityError: class CapacityError extends Error {},
  SERVER_TYPES: [{ usableLonghornGb: 500 }],
}));

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn(),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash" }),
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

const ORG_ID = "org-alpha";
const OWNER_ID = "user-owner";
const OWNER_AUTH0 = "auth0|owner";
const MEMBER_ID = "user-member";
const MEMBER_AUTH0 = "auth0|member";
const OUTSIDER_ID = "user-outsider";
const OUTSIDER_AUTH0 = "auth0|outsider";

const ORG_DEPLOYMENT_ID = "dep-org-1";

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();

  // Seed three users: org owner (creator), org member (member role), outsider
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES
      ('${OWNER_ID}', 'owner@test.com', 'Owner', '${OWNER_AUTH0}', 1),
      ('${MEMBER_ID}', 'member@test.com', 'Member', '${MEMBER_AUTH0}', 1),
      ('${OUTSIDER_ID}', 'outsider@test.com', 'Outsider', '${OUTSIDER_AUTH0}', 1);
  `);

  // Seed the org + memberships
  ctx.raw.exec(`
    INSERT INTO organizations (id, name, slug, owner_id) VALUES
      ('${ORG_ID}', 'Alpha', 'alpha', '${OWNER_ID}');
    INSERT INTO org_members (id, org_id, user_id, role) VALUES
      ('m-owner', '${ORG_ID}', '${OWNER_ID}', 'owner'),
      ('m-member', '${ORG_ID}', '${MEMBER_ID}', 'member');
  `);

  // Seed an org-owned deployment (created by the owner, assigned to the org)
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ORG_DEPLOYMENT_ID,
    OWNER_ID,
    "Shared Bot",
    "openclaw",
    ctx.openclawCatalogId,
    "running",
    "byok",
    "openrouter",
    "legacy",
    ORG_ID,
  );
});

afterAll(() => {
  ctx?.raw.close();
});

function callerFor(userId: string, auth0Id: string) {
  return createTestCaller(ctx.db, {
    id: userId,
    email: `${userId}@test.com`,
    name: userId,
    auth0Id,
    emailVerified: true,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deployment access (JAR-83)", () => {
  describe("getStatus", () => {
    it("org member can read deployment status", async () => {
      const caller = callerFor(MEMBER_ID, MEMBER_AUTH0);
      const result = await caller.deployment.getStatus({ id: ORG_DEPLOYMENT_ID });
      expect(result.status).toBe("running");
    });

    it("outsider (non-member) gets not_found", async () => {
      const caller = callerFor(OUTSIDER_ID, OUTSIDER_AUTH0);
      const result = await caller.deployment.getStatus({ id: ORG_DEPLOYMENT_ID });
      expect((result as any).status).toBe("not_found");
    });
  });

  describe("getLogs", () => {
    it("org member can read deployment logs", async () => {
      const caller = callerFor(MEMBER_ID, MEMBER_AUTH0);
      const result = await caller.deployment.getLogs({ id: ORG_DEPLOYMENT_ID, tailLines: 50 });
      expect(result.logs).toBe("hello");
    });

    it("outsider gets NOT_FOUND on getLogs", async () => {
      const caller = callerFor(OUTSIDER_ID, OUTSIDER_AUTH0);
      await expect(
        caller.deployment.getLogs({ id: ORG_DEPLOYMENT_ID, tailLines: 50 }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("update", () => {
    it("org owner can update a shared deployment", async () => {
      const caller = callerFor(OWNER_ID, OWNER_AUTH0);
      const result = await caller.deployment.update({
        id: ORG_DEPLOYMENT_ID,
        name: "Renamed By Owner",
      });
      expect(result).toBeTruthy();
      expect(result!.name).toBe("Renamed By Owner");
    });

    it("org member (role=member) gets FORBIDDEN when updating", async () => {
      const caller = callerFor(MEMBER_ID, MEMBER_AUTH0);
      await expect(
        caller.deployment.update({ id: ORG_DEPLOYMENT_ID, name: "Sneaky Rename" }),
      ).rejects.toThrow(/owner or admin/i);
    });

    it("outsider gets NOT_FOUND when updating an org deployment", async () => {
      const caller = callerFor(OUTSIDER_ID, OUTSIDER_AUTH0);
      await expect(
        caller.deployment.update({ id: ORG_DEPLOYMENT_ID, name: "Hostile Rename" }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
