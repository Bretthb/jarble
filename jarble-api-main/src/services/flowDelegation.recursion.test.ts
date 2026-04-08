/**
 * N-level recursive delegation tests (JAR-fractal).
 *
 * Exercises `executeDelegation` end-to-end against a real in-memory SQLite
 * mirror of the production schema, with the outbound edges (`chatViaExec`
 * into pods, `findPodForDeployment`) stubbed via vi.mock.
 *
 * Coverage:
 *   - 2-level recursion (entry → A → B)
 *   - 3-level recursion (entry → A → B → C)
 *   - Cycle detection (A → B → A is refused inline)
 *   - Depth-limit enforcement (env-overridden MAX)
 *   - Backward compat (1-level, child emits no jarble_delegate block)
 *   - parent_call_id chain is persisted so a tree can be rebuilt
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";

// ── Hoisted state for mocks ─────────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  ctxRef: { current: null as any },
  // Map of deploymentId → function (task) → bot response text
  botBrain: new Map<string, (task: string) => string>(),
}));

// ── Mock k8s: every deployment has a fake pod named mock-pod-{deploymentId} ──

vi.mock("../k8s/index.js", () => ({
  findPodForDeployment: vi.fn(
    async (deploymentId: string) => `mock-pod-${deploymentId}`,
  ),
}));

// ── Mock openclawGateway: responses come from `botBrain` keyed by pod id ─────

vi.mock("./openclawGateway.js", () => ({
  chatViaExec: vi.fn(
    async (
      podName: string,
      _sessionId: string,
      message: string,
      _onDelta?: any,
      _canvasImage?: any,
      _signal?: any,
    ) => {
      const deploymentId = podName.replace(/^mock-pod-/, "");
      const brain = hoisted.botBrain.get(deploymentId);
      const text = brain ? brain(message) : "(no brain configured)";
      return {
        rawText: text,
        text,
        uiBlocks: [],
        uiUpdates: [],
        componentDefs: [],
        suggestions: [],
        designContext: null,
        nativeThinking: "",
      };
    },
  ),
}));

// ── Mock orchestration events (fire and forget) ─────────────────────────────

vi.mock("../utils/agentCallEvents.js", () => ({
  emitOrchestrationStart: vi.fn(),
  emitOrchestrationEnd: vi.fn(),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Mock db: wires the real in-memory SQLite test db into the module ─────────

vi.mock("../db/index.js", async () => {
  const { createTestDb } = await import("../__tests__/helpers/testDb.js");
  const schema = await import("../__tests__/helpers/testSchema.sqlite.js");
  hoisted.ctxRef.current = createTestDb();
  return {
    db: hoisted.ctxRef.current.db,
    tables: schema,
    dbDate: (date: Date = new Date()) => date.toISOString(),
  };
});

// ── Import the SUT after mocks are registered ───────────────────────────────
import {
  executeDelegation,
  getMaxDelegationDepth,
  DelegationCycleError,
  DelegationDepthExceededError,
  stripDelegationBlocks,
} from "./flowDelegation.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ENTRY_DEP = "dep-entry";
const SPEC_A_DEP = "dep-spec-a";
const SPEC_B_DEP = "dep-spec-b";
const SPEC_C_DEP = "dep-spec-c";
const FLOW_ID = "flow-recursion-test";

function seedFlow() {
  const ctx = hoisted.ctxRef.current!;
  const raw = ctx.raw;

  // Deployments: entry → spec-a → spec-b → spec-c. All running.
  raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
    VALUES
      ('${ENTRY_DEP}', '${ctx.testUserId}', 'Entry', 'openclaw', ${ctx.openclawCatalogId}, 'running'),
      ('${SPEC_A_DEP}', '${ctx.testUserId}', 'Specialist A', 'openclaw', ${ctx.openclawCatalogId}, 'running'),
      ('${SPEC_B_DEP}', '${ctx.testUserId}', 'Specialist B', 'openclaw', ${ctx.openclawCatalogId}, 'running'),
      ('${SPEC_C_DEP}', '${ctx.testUserId}', 'Specialist C', 'openclaw', ${ctx.openclawCatalogId}, 'running');
  `);

  // Flow definition: 4 nodes, each delegates to the next in a chain.
  // Every node can also delegate back to the entry (so cycle tests work).
  //
  // Roles are intentionally single-word ("entry", "a", "b", "c") because
  // `buildDelegationTools` slugifies `role || label || id`, so a role of
  // "Specialist B" would slug to `specialist_b` (tool `delegate_to_specialist_b`).
  // Keeping roles single-word makes the delegate-block `to` field match the
  // slug the bot would actually see.
  const definition = {
    nodes: [
      {
        id: "n_entry",
        type: "deployment",
        deploymentId: ENTRY_DEP,
        role: "entry",
        label: "Entry",
        position: { x: 0, y: 0 },
      },
      {
        id: "n_a",
        type: "deployment",
        deploymentId: SPEC_A_DEP,
        role: "a",
        label: "Specialist A",
        position: { x: 100, y: 0 },
      },
      {
        id: "n_b",
        type: "deployment",
        deploymentId: SPEC_B_DEP,
        role: "b",
        label: "Specialist B",
        position: { x: 200, y: 0 },
      },
      {
        id: "n_c",
        type: "deployment",
        deploymentId: SPEC_C_DEP,
        role: "c",
        label: "Specialist C",
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "n_entry", target: "n_a", type: "delegates" },
      { id: "e2", source: "n_a", target: "n_b", type: "delegates" },
      { id: "e3", source: "n_b", target: "n_c", type: "delegates" },
      // Back-edges so cycle tests can fire
      { id: "e4", source: "n_a", target: "n_entry", type: "delegates" },
      { id: "e5", source: "n_b", target: "n_entry", type: "delegates" },
    ],
  };

  raw.exec(`
    INSERT INTO orchestration_flows (id, user_id, name, definition, status)
    VALUES ('${FLOW_ID}', '${ctx.testUserId}', 'Test Flow', '${JSON.stringify(definition).replace(/'/g, "''")}', 'active');
  `);

  // flow_deployment_memberships — one row per (flow, deployment, node).
  for (const node of definition.nodes) {
    raw.exec(`
      INSERT INTO flow_deployment_memberships (id, flow_id, deployment_id, node_id, role, is_entry_point)
      VALUES ('mem-${node.id}', '${FLOW_ID}', '${node.deploymentId}', '${node.id}', '${node.role}', ${node.id === "n_entry" ? 1 : 0});
    `);
  }
}

function clearDb() {
  const raw = hoisted.ctxRef.current!.raw;
  raw.exec(`
    DELETE FROM agent_calls;
    DELETE FROM flow_deployment_memberships;
    DELETE FROM orchestration_flows;
    DELETE FROM deployments WHERE id LIKE 'dep-%';
  `);
  hoisted.botBrain.clear();
}

beforeAll(() => {
  // Ensure the mocked db is created before any tests run.
  // (vi.mock factory runs on first import above.)
  expect(hoisted.ctxRef.current).toBeTruthy();
});

beforeEach(() => {
  clearDb();
  seedFlow();
  vi.clearAllMocks();
});

afterAll(() => {
  if (hoisted.ctxRef.current?.raw) {
    try {
      hoisted.ctxRef.current.raw.close();
    } catch {
      /* ignore */
    }
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function delegateBlock(toSlug: string, task: string): string {
  return (
    "```jarble_delegate\n" +
    JSON.stringify({ to: toSlug, task }) +
    "\n```"
  );
}

async function readAgentCalls(): Promise<any[]> {
  const raw = hoisted.ctxRef.current!.raw;
  return raw
    .prepare(
      `SELECT id, caller_deployment_id, callee_deployment_id, parent_call_id, depth, kind, status FROM agent_calls ORDER BY created_at ASC`,
    )
    .all() as any[];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("executeDelegation — N-level recursion", () => {
  describe("getMaxDelegationDepth", () => {
    it("returns a sensible default", () => {
      expect(getMaxDelegationDepth()).toBeGreaterThanOrEqual(1);
      expect(getMaxDelegationDepth()).toBeLessThan(20);
    });
  });

  describe("stripDelegationBlocks", () => {
    it("removes jarble_delegate fences and collapses blank lines", () => {
      const input = "Hello.\n\n```jarble_delegate\n{\"to\":\"x\",\"task\":\"y\"}\n```\n\nWorld.";
      expect(stripDelegationBlocks(input)).toBe("Hello.\n\nWorld.");
    });

    it("removes legacy json delegate fences", () => {
      const input =
        "Prefix\n\n```json\n{\"tool\":\"delegate_to_x\",\"task\":\"y\"}\n```\n\nSuffix";
      expect(stripDelegationBlocks(input)).toBe("Prefix\n\nSuffix");
    });
  });

  describe("1-level (backward compat)", () => {
    it("returns the child response verbatim when no nested delegation", async () => {
      hoisted.botBrain.set(SPEC_A_DEP, () => "Plain answer from Specialist A.");

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "What is the answer?",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: 1,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
      });

      expect(result.response).toBe("Plain answer from Specialist A.");
      expect(result.children).toBeUndefined();
      expect(result.depth).toBe(1);

      const rows = await readAgentCalls();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        caller_deployment_id: ENTRY_DEP,
        callee_deployment_id: SPEC_A_DEP,
        parent_call_id: null,
        depth: 1,
        kind: "delegation",
        status: "completed",
      });
    });

    it("still works when no parentCallId/ancestorDeploymentIds/flowId are provided", async () => {
      // Simulates a legacy caller that predates the fractal params.
      hoisted.botBrain.set(SPEC_A_DEP, () => "Legacy response.");

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "Legacy task",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        depth: 1,
      });

      expect(result.response).toBe("Legacy response.");
      expect(result.children).toBeUndefined();
    });
  });

  describe("2-level recursion", () => {
    it("executes entry → A → B and merges B's response under A's", async () => {
      hoisted.botBrain.set(
        SPEC_A_DEP,
        () => `Let me ask B.\n\n${delegateBlock("b", "dig deeper")}`,
      );
      hoisted.botBrain.set(
        SPEC_B_DEP,
        () => "Deep answer from Specialist B.",
      );

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "Investigate",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: 1,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
      });

      expect(result.response).toContain("Let me ask B.");
      expect(result.response).toContain("Deep answer from Specialist B.");
      // A's delegation fence must NOT leak into parent output
      expect(result.response).not.toContain("jarble_delegate");
      // B's role slug is rendered in the merged output
      expect(result.response).toContain("**b:**");

      expect(result.children).toHaveLength(1);
      expect(result.children![0].targetDeploymentId).toBe(SPEC_B_DEP);
      expect(result.children![0].depth).toBe(2);

      const rows = await readAgentCalls();
      expect(rows).toHaveLength(2);
      const parentRow = rows.find((r) => r.depth === 1)!;
      const childRow = rows.find((r) => r.depth === 2)!;
      expect(parentRow.caller_deployment_id).toBe(ENTRY_DEP);
      expect(parentRow.callee_deployment_id).toBe(SPEC_A_DEP);
      expect(parentRow.parent_call_id).toBeNull();
      expect(childRow.caller_deployment_id).toBe(SPEC_A_DEP);
      expect(childRow.callee_deployment_id).toBe(SPEC_B_DEP);
      expect(childRow.parent_call_id).toBe(parentRow.id);
      expect(childRow.status).toBe("completed");
    });
  });

  describe("3-level recursion", () => {
    it("executes entry → A → B → C with correct parent_call_id chain", async () => {
      hoisted.botBrain.set(
        SPEC_A_DEP,
        () => `Routing to B.\n${delegateBlock("b", "level-2 task")}`,
      );
      hoisted.botBrain.set(
        SPEC_B_DEP,
        () => `Routing to C.\n${delegateBlock("c", "level-3 task")}`,
      );
      hoisted.botBrain.set(
        SPEC_C_DEP,
        () => "Final answer from Specialist C.",
      );

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "Multi-hop",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: 1,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
      });

      expect(result.response).toContain("Routing to B.");
      expect(result.response).toContain("Routing to C.");
      expect(result.response).toContain("Final answer from Specialist C.");
      expect(result.response).not.toContain("jarble_delegate");

      const rows = await readAgentCalls();
      expect(rows).toHaveLength(3);
      const row1 = rows.find((r) => r.depth === 1 && r.callee_deployment_id === SPEC_A_DEP)!;
      const row2 = rows.find((r) => r.depth === 2 && r.callee_deployment_id === SPEC_B_DEP)!;
      const row3 = rows.find((r) => r.depth === 3 && r.callee_deployment_id === SPEC_C_DEP)!;
      expect(row1.parent_call_id).toBeNull();
      expect(row2.parent_call_id).toBe(row1.id);
      expect(row3.parent_call_id).toBe(row2.id);
      // Tree chain must be reconstructable
      expect(row1.caller_deployment_id).toBe(ENTRY_DEP);
      expect(row2.caller_deployment_id).toBe(SPEC_A_DEP);
      expect(row3.caller_deployment_id).toBe(SPEC_B_DEP);
    });
  });

  describe("cycle detection", () => {
    it("refuses a sub-delegation that would cycle back to an ancestor", async () => {
      // A delegates BACK to entry — must be refused inline with an annotation
      hoisted.botBrain.set(
        SPEC_A_DEP,
        () => `Let me loop back.\n${delegateBlock("entry", "do it yourself")}`,
      );

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "Try cycling",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: 1,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
      });

      expect(result.response).toContain("Let me loop back.");
      expect(result.response).toMatch(/cycle back to ancestor/);
      // No sub-delegation happened, so no children
      expect(result.children).toBeUndefined();

      const rows = await readAgentCalls();
      // Only A's row, not entry's (cycle was refused BEFORE firing a child)
      expect(rows).toHaveLength(1);
      expect(rows[0].callee_deployment_id).toBe(SPEC_A_DEP);
    });

    it("throws DelegationCycleError when the direct target is in ancestor chain", async () => {
      hoisted.botBrain.set(SPEC_A_DEP, () => "unreachable");

      await expect(
        executeDelegation({
          targetDeploymentId: SPEC_A_DEP,
          targetNodeId: "n_a",
          task: "x",
          contextScope: "task",
          sourceDeploymentId: ENTRY_DEP,
          depth: 2,
          parentCallId: "fake-parent",
          ancestorDeploymentIds: [ENTRY_DEP, SPEC_A_DEP],
          flowId: FLOW_ID,
        }),
      ).rejects.toBeInstanceOf(DelegationCycleError);
    });
  });

  describe("depth limit", () => {
    it("throws DelegationDepthExceededError when depth exceeds max", async () => {
      const max = getMaxDelegationDepth();

      await expect(
        executeDelegation({
          targetDeploymentId: SPEC_A_DEP,
          targetNodeId: "n_a",
          task: "too deep",
          contextScope: "task",
          sourceDeploymentId: ENTRY_DEP,
          depth: max + 1,
          parentCallId: null,
          ancestorDeploymentIds: [ENTRY_DEP],
          flowId: FLOW_ID,
        }),
      ).rejects.toBeInstanceOf(DelegationDepthExceededError);
    });

    it("refuses a sub-delegation inline when the next hop would exceed max", async () => {
      const max = getMaxDelegationDepth();

      // Chain: A (depth=max) → B (would be depth=max+1, refused inline)
      hoisted.botBrain.set(
        SPEC_A_DEP,
        () => `Need more.\n${delegateBlock("b", "deeper")}`,
      );
      hoisted.botBrain.set(SPEC_B_DEP, () => "unreachable");

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "at the edge",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: max,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
      });

      expect(result.response).toContain("Need more.");
      expect(result.response).toMatch(/depth \d+ > max/);
      expect(result.children).toBeUndefined();

      // Only A ran — B was refused without being invoked
      const rows = await readAgentCalls();
      expect(rows).toHaveLength(1);
      expect(rows[0].callee_deployment_id).toBe(SPEC_A_DEP);
      expect(rows[0].depth).toBe(max);
    });
  });

  describe("MAX_DELEGATION_DEPTH bounds", () => {
    it("has a default within sane bounds [1, 20)", () => {
      // getMaxDelegationDepth is memoised at module load — without
      // `vi.resetModules()` we can't test env-override here. This is a
      // smoke test on the memoised default; the parser lives in the
      // IIFE at the top of flowDelegation.ts.
      const max = getMaxDelegationDepth();
      expect(max).toBeGreaterThanOrEqual(1);
      expect(max).toBeLessThan(20);
    });
  });

  describe("ownership: flow lookup is scoped to the requesting user", () => {
    it("refuses to recurse into a flow owned by a different user", async () => {
      // Re-own the flow under a DIFFERENT user. The deployment rows still
      // belong to `testUserId`, but the flow definition now belongs to
      // someone else. When we call executeDelegation with
      // `userId: testUserId`, the child flow-context lookup must fail,
      // so no sub-delegation should fire even though SPEC_A emits a
      // well-formed `jarble_delegate` block.
      const raw = hoisted.ctxRef.current!.raw;
      raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      raw
        .prepare("UPDATE orchestration_flows SET user_id = ? WHERE id = ?")
        .run("other-user", FLOW_ID);

      hoisted.botBrain.set(
        SPEC_A_DEP,
        () => `Try cross-tenant.\n${delegateBlock("b", "leak please")}`,
      );
      hoisted.botBrain.set(SPEC_B_DEP, () => "unreachable");

      const result = await executeDelegation({
        targetDeploymentId: SPEC_A_DEP,
        targetNodeId: "n_a",
        task: "cross-tenant",
        contextScope: "task",
        sourceDeploymentId: ENTRY_DEP,
        toolName: "delegate_to_a",
        depth: 1,
        parentCallId: null,
        ancestorDeploymentIds: [ENTRY_DEP],
        flowId: FLOW_ID,
        // Pass the REQUESTING user's id — not the flow's owner
        userId: hoisted.ctxRef.current!.testUserId,
      });

      // Sub-delegation must NOT have fired; child response is A's text only.
      expect(result.response).toContain("Try cross-tenant.");
      expect(result.response).not.toContain("unreachable");
      expect(result.children).toBeUndefined();

      // Only A's row exists (B was refused at the flow ownership gate)
      const rows = await readAgentCalls();
      expect(rows).toHaveLength(1);
      expect(rows[0].callee_deployment_id).toBe(SPEC_A_DEP);
    });
  });
});
