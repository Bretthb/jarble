/**
 * Integration tests for Flow CRUD + Execution end-to-end.
 *
 * Tests that creating a flow, then recording executions, then querying
 * execution history works correctly via tRPC callers with a real SQLite DB.
 *
 * Covers edge cases not in flows.test.ts: concurrent creates, very large
 * definitions, execution state transitions, and cross-flow isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import * as sqliteSchema from "../../db/schema.sqlite.js";

let ctx: TestDbContext;

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
  createRequestLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
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

vi.mock("../../db/index.js", () => ({
  get db() { return ctx.db; },
  tables: sqliteSchema,
  dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
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
    baseCents: 0, managedKeyCents: 0, totalCents: 0,
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

// Import appRouter AFTER mocks
import { appRouter } from "../../trpc/index.js";
import type { Context } from "../../trpc/context.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: "test-user-001",
  email: "test@jarble.ai",
  name: "Test User",
  auth0Id: "auth0|test-integration-001",
  emailVerified: true,
  freeDeploymentUsed: false,
};

const SECOND_USER = {
  id: "test-user-002",
  email: "test2@jarble.ai",
  name: "Test User 2",
  auth0Id: "auth0|test-integration-002",
  emailVerified: true,
  freeDeploymentUsed: false,
};

const VALID_DEFINITION = {
  nodes: [
    { id: "n1", type: "deployment" as const, label: "Step 1", position: { x: 0, y: 0 }, serviceId: "svc_test" },
    { id: "n2", type: "output" as const, label: "Output", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

function makeCaller(user: any = TEST_USER) {
  const c: Context = {
    user: user as any,
    db: ctx.db as any,
    requestId: "test-request",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  // Seed second user
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('${SECOND_USER.id}', '${SECOND_USER.email}', '${SECOND_USER.name}', '${SECOND_USER.auth0Id}', 1, 0);
  `);
  vi.clearAllMocks();
});

afterEach(() => {
  if (ctx) ctx.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("flows end-to-end integration", () => {

  describe("create → getById → list → listExecutions lifecycle", () => {
    it("creates a flow, retrieves it, lists it, and lists its empty executions", async () => {
      const caller = makeCaller();

      // Create
      const { id } = await caller.flows.create({
        name: "E2E Test Flow",
        description: "End-to-end test",
        definition: VALID_DEFINITION,
      });
      expect(id).toMatch(/^flw_/);

      // GetById
      const flow = await caller.flows.getById({ id });
      expect(flow.name).toBe("E2E Test Flow");
      expect(flow.description).toBe("End-to-end test");
      expect(flow.status).toBe("draft");
      expect(flow.executions).toEqual([]);

      // List
      const flows = await caller.flows.list();
      expect(flows.length).toBe(1);
      expect(flows[0].id).toBe(id);

      // ListExecutions
      const execs = await caller.flows.listExecutions({ flowId: id });
      expect(execs).toEqual([]);
    });

    it("creates a flow, adds executions, then verifies getById includes them", async () => {
      const caller = makeCaller();
      const { id: flowId } = await caller.flows.create({
        name: "Exec Flow",
        definition: VALID_DEFINITION,
      });

      // Insert executions directly
      ctx.raw.exec(`
        INSERT INTO flow_executions (id, flow_id, user_id, status, total_credits_charged, created_at)
        VALUES
          ('fex_a', '${flowId}', '${TEST_USER.id}', 'completed', 3, datetime('now', '-2 minutes')),
          ('fex_b', '${flowId}', '${TEST_USER.id}', 'running', 0, datetime('now', '-1 minutes')),
          ('fex_c', '${flowId}', '${TEST_USER.id}', 'failed', 1, datetime('now'));
      `);

      // GetById should include executions
      const flow = await caller.flows.getById({ id: flowId });
      expect(flow.executions.length).toBe(3);

      // ListExecutions should also return all 3
      const execs = await caller.flows.listExecutions({ flowId });
      expect(execs.length).toBe(3);
    });
  });

  describe("concurrent flow creation", () => {
    it("creates multiple flows in parallel without collision", async () => {
      const caller = makeCaller();
      const results = await Promise.all([
        caller.flows.create({ name: "Parallel 1", definition: VALID_DEFINITION }),
        caller.flows.create({ name: "Parallel 2", definition: VALID_DEFINITION }),
        caller.flows.create({ name: "Parallel 3", definition: VALID_DEFINITION }),
      ]);

      const ids = results.map((r) => r.id);
      // All IDs must be unique
      expect(new Set(ids).size).toBe(3);

      const flows = await caller.flows.list();
      expect(flows.length).toBe(3);
    });
  });

  describe("large definition handling", () => {
    it("handles a definition with many nodes (50+)", async () => {
      const manyNodes = Array.from({ length: 50 }, (_, i) => ({
        id: `n${i}`,
        type: "deployment" as const,
        label: `Node ${i}`,
        position: { x: i * 100, y: 0 },
        serviceId: `svc_${i}`,
      }));
      const manyEdges = Array.from({ length: 49 }, (_, i) => ({
        id: `e${i}`,
        source: `n${i}`,
        target: `n${i + 1}`,
      }));
      const largeDef = { nodes: manyNodes, edges: manyEdges };

      const caller = makeCaller();
      const { id } = await caller.flows.create({
        name: "Large Flow",
        definition: largeDef,
      });

      const flow = await caller.flows.getById({ id });
      const parsed = JSON.parse(flow.definition as string);
      expect(parsed.nodes.length).toBe(50);
      expect(parsed.edges.length).toBe(49);
    });

    it("handles a definition with a very long node label (10KB)", async () => {
      const longLabel = "A".repeat(10_000);
      const def = {
        nodes: [
          { id: "n1", type: "output" as const, label: longLabel, position: { x: 0, y: 0 } },
        ],
        edges: [],
      };

      const caller = makeCaller();
      const { id } = await caller.flows.create({ name: "Long Label", definition: def });

      const flow = await caller.flows.getById({ id });
      const parsed = JSON.parse(flow.definition as string);
      expect(parsed.nodes[0].label.length).toBe(10_000);
    });
  });

  describe("cross-user isolation", () => {
    it("user A cannot see user B flows in list", async () => {
      const callerA = makeCaller(TEST_USER);
      const callerB = makeCaller(SECOND_USER);

      await callerA.flows.create({ name: "User A Flow", definition: VALID_DEFINITION });
      await callerB.flows.create({ name: "User B Flow", definition: VALID_DEFINITION });

      const flowsA = await callerA.flows.list();
      const flowsB = await callerB.flows.list();

      expect(flowsA.length).toBe(1);
      expect(flowsA[0].name).toBe("User A Flow");
      expect(flowsB.length).toBe(1);
      expect(flowsB[0].name).toBe("User B Flow");
    });

    it("user A cannot update user B flow", async () => {
      const callerB = makeCaller(SECOND_USER);
      const { id } = await callerB.flows.create({ name: "B Private", definition: VALID_DEFINITION });

      const callerA = makeCaller(TEST_USER);
      await expect(
        callerA.flows.update({ id, name: "Hacked" })
      ).rejects.toThrow(/not found/i);
    });

    it("user A cannot delete user B flow", async () => {
      const callerB = makeCaller(SECOND_USER);
      const { id } = await callerB.flows.create({ name: "B Flow", definition: VALID_DEFINITION });

      const callerA = makeCaller(TEST_USER);
      await expect(
        callerA.flows.delete({ id })
      ).rejects.toThrow(/not found/i);
    });

    it("user A cannot list executions of user B flow", async () => {
      const callerB = makeCaller(SECOND_USER);
      const { id: flowId } = await callerB.flows.create({ name: "B Flow", definition: VALID_DEFINITION });

      const callerA = makeCaller(TEST_USER);
      await expect(
        callerA.flows.listExecutions({ flowId })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("execution state transitions", () => {
    it("tracks multiple execution statuses correctly", async () => {
      const caller = makeCaller();
      const { id: flowId } = await caller.flows.create({
        name: "State Flow",
        definition: VALID_DEFINITION,
      });

      // Insert executions with different statuses
      ctx.raw.exec(`
        INSERT INTO flow_executions (id, flow_id, user_id, status, total_credits_charged, created_at)
        VALUES
          ('fex_pending', '${flowId}', '${TEST_USER.id}', 'pending', 0, datetime('now')),
          ('fex_running', '${flowId}', '${TEST_USER.id}', 'running', 0, datetime('now')),
          ('fex_completed', '${flowId}', '${TEST_USER.id}', 'completed', 5, datetime('now')),
          ('fex_failed', '${flowId}', '${TEST_USER.id}', 'failed', 2, datetime('now'));
      `);

      const execs = await caller.flows.listExecutions({ flowId });
      expect(execs.length).toBe(4);

      const statuses = execs.map((e: any) => e.status);
      expect(statuses).toContain("pending");
      expect(statuses).toContain("running");
      expect(statuses).toContain("completed");
      expect(statuses).toContain("failed");
    });

    it("execution with step results stores and returns JSON", async () => {
      const caller = makeCaller();
      const { id: flowId } = await caller.flows.create({
        name: "Steps Flow",
        definition: VALID_DEFINITION,
      });

      const stepResults = JSON.stringify([
        { nodeId: "n1", status: "completed", output: "Hello world" },
        { nodeId: "n2", status: "completed", output: "Formatted" },
      ]);

      ctx.raw.exec(`
        INSERT INTO flow_executions (id, flow_id, user_id, status, step_results, total_credits_charged, created_at)
        VALUES ('fex_steps', '${flowId}', '${TEST_USER.id}', 'completed', '${stepResults}', 3, datetime('now'));
      `);

      const execs = await caller.flows.listExecutions({ flowId });
      expect(execs.length).toBe(1);
      const parsed = JSON.parse(execs[0].stepResults as string);
      expect(parsed.length).toBe(2);
      expect(parsed[0].nodeId).toBe("n1");
    });
  });

  describe("create → update → duplicate lifecycle", () => {
    it("creates, updates definition, then duplicates preserves updated definition", async () => {
      const caller = makeCaller();
      const { id } = await caller.flows.create({
        name: "Original",
        definition: VALID_DEFINITION,
      });

      // Update definition
      const updatedDef = {
        ...VALID_DEFINITION,
        nodes: [
          ...VALID_DEFINITION.nodes,
          { id: "n3", type: "transform" as const, label: "Transform", position: { x: 400, y: 0 } },
        ],
      };
      await caller.flows.update({ id, definition: updatedDef });

      // Duplicate
      const { id: forkId } = await caller.flows.duplicate({ sourceFlowId: id });
      const fork = await caller.flows.getById({ id: forkId });
      const forkedDef = JSON.parse(fork.definition as string);
      expect(forkedDef.nodes.length).toBe(3); // Updated definition, not original
    });
  });

  describe("delete then re-access", () => {
    it("archived flow is still accessible via getById", async () => {
      const caller = makeCaller();
      const { id } = await caller.flows.create({ name: "Archivable", definition: VALID_DEFINITION });

      await caller.flows.delete({ id });
      const flow = await caller.flows.getById({ id });
      expect(flow.status).toBe("archived");
    });

    it("hard-deleted flow is not accessible via getById", async () => {
      const caller = makeCaller();
      const { id } = await caller.flows.create({ name: "Deletable", definition: VALID_DEFINITION });

      await caller.flows.delete({ id, hard: true });
      await expect(caller.flows.getById({ id })).rejects.toThrow(/not found/i);
    });

    it("hard-deleted flow cascades to executions", async () => {
      const caller = makeCaller();
      const { id: flowId } = await caller.flows.create({ name: "Cascade", definition: VALID_DEFINITION });

      ctx.raw.exec(`
        INSERT INTO flow_executions (id, flow_id, user_id, status, total_credits_charged, created_at)
        VALUES ('fex_cascade', '${flowId}', '${TEST_USER.id}', 'completed', 1, datetime('now'));
      `);

      await caller.flows.delete({ id: flowId, hard: true });

      // Execution should be cascade-deleted
      const row = ctx.raw.prepare("SELECT * FROM flow_executions WHERE id = 'fex_cascade'").get();
      expect(row).toBeUndefined();
    });
  });

  describe("schema validation edge cases", () => {
    it("accepts definition with empty nodes array (valid empty flow)", async () => {
      const result = await makeCaller().flows.create({
        name: "Empty Nodes",
        definition: { nodes: [], edges: [] },
      });
      expect(result.id).toBeTruthy();
    });

    it("rejects node with empty id", async () => {
      await expect(
        makeCaller().flows.create({
          name: "Bad Node",
          definition: {
            nodes: [{ id: "", type: "output", label: "X", position: { x: 0, y: 0 } }],
            edges: [],
          },
        })
      ).rejects.toThrow();
    });

    it("accepts all node types", async () => {
      const def = {
        nodes: [
          { id: "n1", type: "deployment" as const, label: "Deploy", position: { x: 0, y: 0 } },
          { id: "n2", type: "transform" as const, label: "Transform", position: { x: 100, y: 0 } },
          { id: "n3", type: "condition" as const, label: "Condition", position: { x: 200, y: 0 } },
          { id: "n4", type: "output" as const, label: "Output", position: { x: 300, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "n1", target: "n2" },
          { id: "e2", source: "n2", target: "n3" },
          { id: "e3", source: "n3", target: "n4" },
        ],
      };

      const { id } = await makeCaller().flows.create({ name: "All Types", definition: def });
      const flow = await makeCaller().flows.getById({ id });
      const parsed = JSON.parse(flow.definition as string);
      expect(parsed.nodes.length).toBe(4);
    });
  });
});
