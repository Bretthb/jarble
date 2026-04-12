/**
 * Integration tests for Bot Teams via the flows tRPC router.
 *
 * Tests flow creation with team topologies and the syncFlowMemberships
 * side-effect that populates the flow_deployment_memberships join table.
 * Uses real in-memory SQLite with seeded deployments representing a 3-bot team.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../helpers/testSchema.sqlite.js";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

// The flows router imports db at module level for validateDeploymentReferences
// and syncFlowMemberships. The getter pattern ensures the mock resolves to the
// current test db instance (swapped in beforeEach).
let ctx: TestDbContext;

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
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

// Critical: use getter so module-level `db` in flows.ts resolves to the
// current test db (which is recreated in beforeEach).
vi.mock("../../db/index.js", () => ({
  get db() {
    return ctx.db;
  },
  tables: sqliteSchema,
  dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
  getRowsAffected: (result: any) => {
    if (result?.rowCount != null) return result.rowCount;
    if (result?.rowsAffected != null) return result.rowsAffected;
    if (result?.changes != null) return result.changes;
    return 0;
  },
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
  getSubscriptionBreakdown: vi.fn().mockReturnValue({
    baseCents: 0,
    managedKeyCents: 0,
    totalCents: 0,
  }),
  findManagedKeyItem: vi.fn().mockResolvedValue(null),
  updateManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  removeManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  addManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

// Import appRouter AFTER mocks are set up (vi.mock is hoisted)
import { appRouter } from "../../trpc/index.js";
import type { Context } from "../../trpc/context.js";

// ── Setup ────────────────────────────────────────────────────────────────────

const DEPLOYMENT_1_ID = "dep-team-001";
const DEPLOYMENT_2_ID = "dep-team-002";
const DEPLOYMENT_3_ID = "dep-team-003";

function seedData() {
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
    VALUES
      ('${DEPLOYMENT_1_ID}', '${ctx.testUserId}', 'Coordinator', 'openclaw', ${ctx.openclawCatalogId}, 'running'),
      ('${DEPLOYMENT_2_ID}', '${ctx.testUserId}', 'Analyst', 'openclaw', ${ctx.openclawCatalogId}, 'running'),
      ('${DEPLOYMENT_3_ID}', '${ctx.testUserId}', 'Specialist', 'openclaw', ${ctx.openclawCatalogId}, 'running');
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
  const c: Context = {
    user: {
      id: ctx.testUserId,
      email: "test@jarble.ai",
      name: "Test User",
      auth0Id: ctx.testAuth0Id,
      emailVerified: true,
    } as any,
    db: ctx.db as any,
    requestId: "test-request",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

function anonCaller() {
  const c: Context = {
    user: null,
    db: ctx.db as any,
    requestId: "test-request",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDefinition(overrides?: {
  nodes?: any[];
  edges?: any[];
}) {
  return {
    nodes: overrides?.nodes ?? [
      {
        id: "node-1",
        type: "deployment" as const,
        deploymentId: DEPLOYMENT_1_ID,
        label: "Coordinator",
        role: "Lead Coordinator",
        goal: "Orchestrate the team",
        isEntryPoint: true,
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "node-2",
        type: "deployment" as const,
        deploymentId: DEPLOYMENT_2_ID,
        label: "Analyst",
        role: "Data Analyst",
        config: {},
        position: { x: 200, y: 0 },
      },
    ],
    edges: overrides?.edges ?? [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        type: "delegates" as const,
        label: "delegates",
      },
    ],
  };
}

function getMemberships(flowId: string): any[] {
  return ctx.raw
    .prepare("SELECT * FROM flow_deployment_memberships WHERE flow_id = ? ORDER BY node_id")
    .all(flowId);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("flows.botTeams", () => {
  // ── Flow creation with team topology ────────────────────────────────────

  describe("flow creation with team topology", () => {
    it("creates a flow with hierarchy teamType stored in definition", async () => {
      const result = await caller().flows.create({
        name: "Hierarchy Team",
        description: "A hierarchical team",
        definition: makeDefinition(),
        teamType: "hierarchy",
      });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^flw_/);

      const flow = await caller().flows.getById({ id: result.id });
      expect(flow.teamType).toBe("hierarchy");
    });

    it("creates a flow with pipeline teamType", async () => {
      const result = await caller().flows.create({
        name: "Pipeline Team",
        description: "A pipeline team",
        definition: makeDefinition(),
        teamType: "pipeline",
      });

      const flow = await caller().flows.getById({ id: result.id });
      expect(flow.teamType).toBe("pipeline");
    });

    it("creates a flow with collaborative teamType", async () => {
      const result = await caller().flows.create({
        name: "Collaborative Team",
        description: "A collaborative team",
        definition: makeDefinition(),
        teamType: "collaborative",
      });

      const flow = await caller().flows.getById({ id: result.id });
      expect(flow.teamType).toBe("collaborative");
    });
  });

  // ── flow-deployment memberships (syncFlowMemberships) ──────────────────

  describe("flow-deployment memberships (syncFlowMemberships)", () => {
    it("creating a flow with deployment nodes populates flow_deployment_memberships table", async () => {
      const result = await caller().flows.create({
        name: "Team Alpha",
        definition: makeDefinition(),
      });

      const memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(2);

      const depIds = memberships.map((m: any) => m.deployment_id).sort();
      expect(depIds).toEqual([DEPLOYMENT_1_ID, DEPLOYMENT_2_ID].sort());
    });

    it("membership has correct role from node.role (top-level)", async () => {
      const result = await caller().flows.create({
        name: "Role Test",
        definition: makeDefinition({
          nodes: [
            {
              id: "node-1",
              type: "deployment",
              deploymentId: DEPLOYMENT_1_ID,
              label: "Bot One",
              role: "Chief Strategist",
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        }),
      });

      const memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("Chief Strategist");
    });

    it("membership has correct role from node.config.role (fallback for old saved data)", async () => {
      const result = await caller().flows.create({
        name: "Config Role Test",
        definition: makeDefinition({
          nodes: [
            {
              id: "node-1",
              type: "deployment",
              deploymentId: DEPLOYMENT_1_ID,
              label: "Bot One",
              // No top-level role -- falls through to config.role
              config: { role: "Backend Specialist" },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        }),
      });

      const memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("Backend Specialist");
    });

    it("membership uses node.label as role fallback when no role set", async () => {
      const result = await caller().flows.create({
        name: "Label Fallback Test",
        definition: makeDefinition({
          nodes: [
            {
              id: "node-1",
              type: "deployment",
              deploymentId: DEPLOYMENT_1_ID,
              label: "Research Agent",
              // No role or config.role -- falls through to label
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        }),
      });

      const memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("Research Agent");
    });

    it("isEntryPoint is stored correctly", async () => {
      const result = await caller().flows.create({
        name: "Entry Point Test",
        definition: makeDefinition({
          nodes: [
            {
              id: "node-1",
              type: "deployment",
              deploymentId: DEPLOYMENT_1_ID,
              label: "Entry Bot",
              role: "Coordinator",
              isEntryPoint: true,
              config: {},
              position: { x: 0, y: 0 },
            },
            {
              id: "node-2",
              type: "deployment",
              deploymentId: DEPLOYMENT_2_ID,
              label: "Worker Bot",
              role: "Worker",
              isEntryPoint: false,
              config: {},
              position: { x: 200, y: 0 },
            },
          ],
          edges: [
            { id: "edge-1", source: "node-1", target: "node-2" },
          ],
        }),
      });

      const memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(2);

      const entryMembership = memberships.find((m: any) => m.deployment_id === DEPLOYMENT_1_ID);
      const workerMembership = memberships.find((m: any) => m.deployment_id === DEPLOYMENT_2_ID);

      // SQLite stores booleans as integers: 1 = true, 0 = false
      expect(entryMembership.is_entry_point).toBe(1);
      expect(workerMembership.is_entry_point).toBe(0);
    });

    it("updating a flow re-syncs memberships (old ones deleted, new ones created)", async () => {
      // Create with deployments 1 and 2
      const result = await caller().flows.create({
        name: "Re-sync Test",
        definition: makeDefinition(),
      });

      let memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(2);
      const depIdsBefore = memberships.map((m: any) => m.deployment_id).sort();
      expect(depIdsBefore).toEqual([DEPLOYMENT_1_ID, DEPLOYMENT_2_ID].sort());

      // Update: replace deployment 2 with deployment 3
      await caller().flows.update({
        id: result.id,
        definition: makeDefinition({
          nodes: [
            {
              id: "node-1",
              type: "deployment",
              deploymentId: DEPLOYMENT_1_ID,
              label: "Coordinator",
              role: "Lead",
              config: {},
              position: { x: 0, y: 0 },
            },
            {
              id: "node-3",
              type: "deployment",
              deploymentId: DEPLOYMENT_3_ID,
              label: "Specialist",
              role: "Domain Expert",
              config: {},
              position: { x: 200, y: 0 },
            },
          ],
          edges: [
            { id: "edge-1", source: "node-1", target: "node-3" },
          ],
        }),
      });

      memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(2);

      const depIdsAfter = memberships.map((m: any) => m.deployment_id).sort();
      expect(depIdsAfter).toEqual([DEPLOYMENT_1_ID, DEPLOYMENT_3_ID].sort());

      // Deployment 2 should no longer have a membership
      const dep2Membership = memberships.find((m: any) => m.deployment_id === DEPLOYMENT_2_ID);
      expect(dep2Membership).toBeUndefined();
    });

    it("deleting a flow (hard delete) cascades to memberships", async () => {
      const result = await caller().flows.create({
        name: "Cascade Delete Test",
        definition: makeDefinition(),
      });

      // Verify memberships exist
      let memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(2);

      // Hard delete the flow
      await caller().flows.delete({ id: result.id, hard: true });

      // Memberships should be gone (ON DELETE CASCADE)
      memberships = getMemberships(result.id);
      expect(memberships).toHaveLength(0);
    });
  });
});
