/**
 * Tests for Strategy E: deployment.delete rewrites affected flow definitions.
 *
 * When a deployment is deleted, the FK on flow_deployment_memberships
 * cascades, but orchestration_flows.definition (a JSON text blob) keeps
 * orphan deploymentId references. This file verifies the rewrite step
 * inside deployment.delete removes the dead nodes and any edges that
 * touched them.
 *
 * See docs/audits/stale-flow-deployment-ids.md Strategy E.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";
// Local test-only SQLite schema mirror — Drizzle can't generate SQLite SQL
// from the production pg schema, so tests use a dedicated sibling file.
import * as sqliteSchema from "../helpers/testSchema.sqlite.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockDeleteDeployment = vi.fn().mockResolvedValue(undefined);
const mockCheckScaleDown = vi.fn().mockResolvedValue(undefined);

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: (...args: any[]) => mockDeleteDeployment(...args),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi
    .fn()
    .mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi
    .fn()
    .mockResolvedValue({ logs: "", podName: null }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
  appsApi: {},
  NAMESPACE: "jarble",
}));

vi.mock("../../k8s/nodeManager.js", () => ({
  ensureCapacityForDeployment: vi.fn().mockResolvedValue(undefined),
  checkScaleDown: (...args: any[]) => mockCheckScaleDown(...args),
  getCapacityStatus: vi.fn().mockResolvedValue({
    totalNodes: 0,
    managedNodes: 0,
    maxManagedNodes: 0,
    availableSlots: 0,
    nodes: [],
  }),
  CapacityError: class CapacityError extends Error {},
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
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi
    .fn()
    .mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
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

// Mock db/index.js — the real module throws on missing DATABASE_URL at
// module-load time, before vi.mock on utils/env can take effect. Use a
// getter so `ctx.db` (set in beforeEach) is returned at call time.
// tables are populated lazily in beforeEach to avoid TDZ issues with the
// sqliteSchema import being hoisted below the vi.mock factory.
vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return {
    get db() {
      return ctx.db;
    },
    tables: schema,
    dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
    getRowsAffected: (result: any) => {
      if (!result) return 0;
      if (result.rowCount != null) return result.rowCount;
      if (result.rowsAffected != null) return result.rowsAffected;
      if (result.changes != null) return result.changes;
      if (Array.isArray(result) && result[0]?.affectedRows != null) return result[0].affectedRows;
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

afterEach(() => {
  if (ctx) ctx.raw.close();
});

function authedCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

function seedDeployment(id: string, name = `Deployment ${id}`) {
  ctx.raw
    .prepare(
      `INSERT INTO deployments (id, user_id, name, runtime, deployment_type, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.testUserId,
      name,
      "openclaw",
      "agent",
      ctx.openclawCatalogId,
      "running",
      "byok",
      "openrouter",
      "legacy",
    );
  return id;
}

function insertFlow(id: string, definition: object) {
  const json = JSON.stringify(definition).replace(/'/g, "''");
  ctx.raw.exec(
    `INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, team_type, created_at, updated_at)
     VALUES ('${id}', '${ctx.testUserId}', 'Flow ${id}', '${json}', 'draft', 0, 0, 'hierarchy', datetime('now'), datetime('now'));`,
  );
}

function getFlowDefinition(id: string): { nodes: any[]; edges: any[] } {
  const row = ctx.raw
    .prepare("SELECT definition FROM orchestration_flows WHERE id = ?")
    .get(id) as { definition: string } | undefined;
  if (!row) throw new Error(`flow ${id} not found`);
  return JSON.parse(row.definition);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deployment.delete — flow rewrite (Strategy E)", () => {
  it("removes the deployment node and its edges from a referencing flow", async () => {
    seedDeployment("dep-target");
    seedDeployment("dep-other");

    insertFlow("flw_a", {
      nodes: [
        {
          id: "n1",
          type: "deployment",
          label: "Target",
          position: { x: 0, y: 0 },
          deploymentId: "dep-target",
        },
        {
          id: "n2",
          type: "deployment",
          label: "Other",
          position: { x: 200, y: 0 },
          deploymentId: "dep-other",
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });

    await authedCaller().deployment.delete({ id: "dep-target" });

    const def = getFlowDefinition("flw_a");
    expect(def.nodes).toHaveLength(1);
    expect(def.nodes[0].id).toBe("n2");
    expect(def.edges).toHaveLength(0); // edge touched n1, removed
  });

  it("only strips matching nodes when a flow references multiple deployments", async () => {
    seedDeployment("dep-1");
    seedDeployment("dep-2");
    seedDeployment("dep-3");

    insertFlow("flw_multi", {
      nodes: [
        { id: "n1", deploymentId: "dep-1", label: "A", type: "deployment", position: { x: 0, y: 0 } },
        { id: "n2", deploymentId: "dep-2", label: "B", type: "deployment", position: { x: 200, y: 0 } },
        { id: "n3", deploymentId: "dep-3", label: "C", type: "deployment", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
      ],
    });

    await authedCaller().deployment.delete({ id: "dep-2" });

    const def = getFlowDefinition("flw_multi");
    expect(def.nodes.map((n: any) => n.id).sort()).toEqual(["n1", "n3"]);
    expect(def.edges).toHaveLength(0); // both edges touched n2
  });

  it("removes nodes referenced via nested config.deploymentId", async () => {
    seedDeployment("dep-nested");

    insertFlow("flw_nested", {
      nodes: [
        {
          id: "n1",
          type: "subflow",
          label: "Subflow",
          position: { x: 0, y: 0 },
          config: { deploymentId: "dep-nested" },
        },
        {
          id: "n2",
          type: "output",
          label: "Out",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });

    await authedCaller().deployment.delete({ id: "dep-nested" });

    const def = getFlowDefinition("flw_nested");
    expect(def.nodes).toHaveLength(1);
    expect(def.nodes[0].id).toBe("n2");
    expect(def.edges).toHaveLength(0);
  });

  it("is a no-op when there are no flows referencing the deployment", async () => {
    seedDeployment("dep-lonely");

    insertFlow("flw_unrelated", {
      nodes: [
        { id: "n1", type: "output", label: "Out", position: { x: 0, y: 0 } },
      ],
      edges: [],
    });

    await authedCaller().deployment.delete({ id: "dep-lonely" });

    const def = getFlowDefinition("flw_unrelated");
    expect(def.nodes).toHaveLength(1);
  });

  it("skips flows whose definition is not valid JSON without aborting the delete", async () => {
    seedDeployment("dep-with-bad-flow");

    // Insert a flow with broken JSON. We need a row whose definition contains
    // the deploymentId substring so the LIKE filter picks it up.
    ctx.raw.exec(
      `INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, team_type, created_at, updated_at)
       VALUES ('flw_bad', '${ctx.testUserId}', 'Bad', '{this is not valid json "dep-with-bad-flow"', 'draft', 0, 0, 'hierarchy', datetime('now'), datetime('now'));`,
    );

    // Should not throw — the rewrite step swallows individual flow JSON errors
    const result = await authedCaller().deployment.delete({
      id: "dep-with-bad-flow",
    });
    expect(result.success).toBe(true);

    // Deployment row is removed
    const dep = ctx.raw
      .prepare("SELECT id FROM deployments WHERE id = ?")
      .get("dep-with-bad-flow");
    expect(dep).toBeUndefined();
  });

  it("does not rewrite a flow when the LIKE matches a coincidental substring (no real reference)", async () => {
    seedDeployment("dep-AB");
    // Insert a flow whose definition contains "dep-AB" substring inside a
    // label, but never as an actual deploymentId. After the rewrite pass,
    // the JSON should be unchanged (no nodes were stripped).
    insertFlow("flw_substring", {
      nodes: [
        {
          id: "n1",
          type: "output",
          label: "label mentions dep-AB but no real reference",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    const beforeRow = ctx.raw
      .prepare("SELECT definition, updated_at FROM orchestration_flows WHERE id = ?")
      .get("flw_substring") as { definition: string; updated_at: string };

    await authedCaller().deployment.delete({ id: "dep-AB" });

    const afterRow = ctx.raw
      .prepare("SELECT definition, updated_at FROM orchestration_flows WHERE id = ?")
      .get("flw_substring") as { definition: string; updated_at: string };

    // Re-verify post-filter prevents an unnecessary write — definition
    // should be byte-identical and updated_at unchanged.
    expect(afterRow.definition).toBe(beforeRow.definition);
    expect(afterRow.updated_at).toBe(beforeRow.updated_at);
  });

  it("still completes the deployment delete when the rewrite block throws", async () => {
    seedDeployment("dep-throw");

    // Trigger a real error inside the rewrite block by dropping the
    // orchestration_flows table. We also drop flow_deployment_memberships
    // because its FK references orchestration_flows — leaving the join
    // table behind would break SQLite's cascade-prepare step on the final
    // deployments delete.
    ctx.raw.exec(`DROP TABLE flow_deployment_memberships`);
    ctx.raw.exec(`DROP TABLE orchestration_flows`);

    const result = await authedCaller().deployment.delete({ id: "dep-throw" });
    expect(result.success).toBe(true);

    // Deployment is fully gone even though the rewrite step errored out.
    const dep = ctx.raw
      .prepare("SELECT id FROM deployments WHERE id = ?")
      .get("dep-throw");
    expect(dep).toBeUndefined();
  });
});
