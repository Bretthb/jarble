/**
 * Flow Engine Phase 2 tests - cycles, human-in-the-loop, nested subflows.
 *
 * Mocks: executeAgentCall, db, logger.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowNode, FlowEdge, FlowDefinition, StepResult } from "./flowEngine.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Engine now uses executeDelegation (from ./flowDelegation.js), not
// executeAgentCall (from ./marketplaceHub.js). Adapter maps legacy mock
// returns { result, creditsCharged } onto the delegationResult shape.
const mockExecuteAgentCall = vi.fn();
function toDelegationResult(agentCallReturn: any) {
  const r = agentCallReturn ?? {};
  const inner = r.result;
  const innerObj = inner && typeof inner === "object" ? inner : {};
  return {
    response: typeof inner === "string" ? inner : innerObj,
    uiBlocks: [],
    componentDefs: [],
    suggestions: [],
    children: [],
    callId: "call_test",
    depth: 0,
    creditsUsed: r.creditsCharged ?? 0,
  };
}
vi.mock("./flowDelegation.js", () => ({
  buildDelegationTools: () => [],
  executeDelegation: (...args: any[]) =>
    Promise.resolve(mockExecuteAgentCall(...args)).then(toDelegationResult),
}));

vi.mock("../db/index.js", () => {
  return {
    db: {
      select: (...args: any[]) => {
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: () => Promise.resolve([]),
        };
        return chain;
      },
      insert: () => ({
        values: () => Promise.resolve(undefined),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
    },
    tables: {
      agentCalls: "agentCalls",
      flowExecutions: { id: "id" },
      orchestrationFlows: {
        id: "id",
        definition: "definition",
        userId: "userId",
        isPublic: "isPublic",
      },
    },
    dbDate: () => new Date().toISOString(),
  };
});

import { FlowExecutionEngine } from "./flowEngine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  type: FlowNode["type"] = "deployment",
  config?: Record<string, unknown>,
  maxIterations?: number
): FlowNode {
  return {
    id,
    type,
    label: `Node ${id}`,
    position: { x: 0, y: 0 },
    deploymentId: type === "deployment" ? `dep_${id}` : undefined,
    config,
    maxIterations,
  };
}

function makeEdge(source: string, target: string, condition?: string): FlowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    condition,
  };
}

function createEngine(def: FlowDefinition, nestingDepth?: number): FlowExecutionEngine {
  return new FlowExecutionEngine("flow_test", "fex_test", def, "user_test", undefined, nestingDepth);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FlowExecutionEngine Phase 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteAgentCall.mockResolvedValue({
      result: { message: "ok" },
      creditsCharged: 5,
    });
  });

  // ── Feature 1: Cycle/Loop Support ─────────────────────────────────────────

  describe("Cycle/Loop Support", () => {
    it("executes A->B->A cycle with maxIterations=3, stopping after 3 iterations", async () => {
      let callCount = 0;
      mockExecuteAgentCall.mockImplementation(async () => {
        callCount++;
        return { result: { count: callCount }, creditsCharged: 1 };
      });

      const nodes = [
        makeNode("A", "deployment", undefined, 3),
        makeNode("B", "deployment", undefined, 3),
      ];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("B", "A"), // back-edge creating cycle
      ];

      const iterationEvents: any[] = [];
      const engine = createEngine({ nodes, edges });
      engine.on("step:iteration", (e) => iterationEvents.push(e));

      const state = await engine.execute();

      // A runs first (visit 1), then B (visit 1), then A again (visit 2), B (visit 2),
      // A (visit 3), B (visit 3), then A would be visit 4 which exceeds max of 3
      expect(state.status).toBe("completed");

      // Both A and B should have been visited 3 times each = 6 calls total
      expect(callCount).toBe(6);

      // Iteration events:
      // - A visit 2 (iteration event), A visit 3 (iteration event)
      // - B visit 2 (iteration event), B visit 3 (iteration event)
      // - A would be visit 4 (exceeds max=3, so "max reached" iteration event from the loop)
      // - B would be visit 4 (but B is never queued because A was skipped at max)
      // Total: 4 from node executions + 1 from max-reached check = 5
      // Actually: after A(3) completes, B is queued. After B(3) completes, A is checked:
      //   visitCount=3 >= maxIter=3, so max-reached event is emitted = 1 more
      // Total iteration events = 4 (from visits) + 1 (max-reached) = 5
      expect(iterationEvents.length).toBeGreaterThanOrEqual(4);

      // Verify iteration event structure for node A
      const aIterations = iterationEvents.filter((e) => e.nodeId === "A");
      expect(aIterations.length).toBeGreaterThanOrEqual(2);
      expect(aIterations[0].iteration).toBe(2);
      expect(aIterations[0].maxIterations).toBe(3);
    });

    it("prevents infinite loops with default maxIterations=10", async () => {
      let callCount = 0;
      mockExecuteAgentCall.mockImplementation(async () => {
        callCount++;
        return { result: { n: callCount }, creditsCharged: 0 };
      });

      // Single node self-loop
      const nodes = [makeNode("A", "deployment")]; // default maxIterations=10
      const edges = [makeEdge("A", "A")]; // self-loop

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      // Should execute exactly 10 times (default maxIterations)
      expect(callCount).toBe(10);
    });

    it("handles cycle with condition that eventually stops", async () => {
      let counter = 0;
      mockExecuteAgentCall.mockImplementation(async () => {
        counter++;
        return { result: { done: counter >= 3 }, creditsCharged: 1 };
      });

      const nodes = [
        makeNode("A", "deployment", undefined, 10),
        makeNode("B", "condition", { condition: "{{A.done}} == false" }, 10),
      ];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("B", "A"), // loop back when condition is true (B result is true meaning "not done")
      ];

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      // A runs, B checks condition. When counter >= 3, B's condition "done == false"
      // resolves to "true == false" which is false, so B is skipped and loop stops
      expect(counter).toBeGreaterThanOrEqual(3);
    });

    it("still works for acyclic graphs (linear chain)", async () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      expect(state.stepResults.get("A")?.status).toBe("completed");
      expect(state.stepResults.get("B")?.status).toBe("completed");
      expect(state.stepResults.get("C")?.status).toBe("completed");
      expect(mockExecuteAgentCall).toHaveBeenCalledTimes(3);
    });

    it("handles parallel branches correctly in state machine model", async () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("A", "C"),
        makeEdge("B", "D"),
        makeEdge("C", "D"),
      ];

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      for (const id of ["A", "B", "C", "D"]) {
        expect(state.stepResults.get(id)?.status).toBe("completed");
      }
    });
  });

  // ── Feature 2: Human-in-the-Loop (waitForInput) ───────────────────────────

  describe("Human-in-the-Loop (waitForInput)", () => {
    it("pauses on waitForInput node, then resume completes the flow", async () => {
      const nodes = [
        makeNode("A", "deployment"),
        makeNode("W", "waitForInput", {
          inputSchema: { type: "string", description: "Enter your name" },
        }),
        makeNode("O", "output", { greeting: "Hello, {{W}}" }),
      ];
      const edges = [
        makeEdge("A", "W"),
        makeEdge("W", "O"),
      ];

      const pausedEvents: any[] = [];
      const engine = createEngine({ nodes, edges });
      engine.on("flow:paused", (e) => pausedEvents.push(e));

      // Start execution - should pause at W synchronously (no blocking)
      const firstState = await engine.execute();

      // Verify engine returned with "paused" status
      expect(firstState.status).toBe("paused");
      expect(firstState.pausedAtNodeId).toBe("W");

      // Verify paused event was emitted
      expect(pausedEvents.length).toBe(1);
      expect(pausedEvents[0].nodeId).toBe("W");
      expect(pausedEvents[0].label).toBe("Node W");
      expect(pausedEvents[0].inputSchema).toEqual({
        type: "string",
        description: "Enter your name",
      });

      // A should be completed, W should be running (waiting for input)
      expect(firstState.stepResults.get("A")?.status).toBe("completed");
      expect(firstState.stepResults.get("W")?.status).toBe("running");

      // Now resume with input - this completes W and continues the flow
      const finalState = await engine.resume("W", "World");

      expect(finalState.status).toBe("completed");
      expect(finalState.stepResults.get("W")?.status).toBe("completed");
      expect(finalState.stepResults.get("W")?.result).toBe("World");
      expect(finalState.stepResults.get("O")?.status).toBe("completed");
      expect(finalState.stepResults.get("O")?.result).toEqual({
        greeting: "Hello, World",
      });
    });

    it("throws error when resume is called with wrong nodeId", async () => {
      const nodes = [
        makeNode("W", "waitForInput", { inputSchema: {} }),
      ];

      const engine = createEngine({ nodes, edges: [] });

      // Execute - pauses at W
      const state = await engine.execute();
      expect(state.status).toBe("paused");

      // Try to resume with wrong nodeId
      await expect(engine.resume("WRONG_NODE", "data")).rejects.toThrow(
        /Cannot resume: execution is paused at node "W", not "WRONG_NODE"/
      );
    });

    it("throws error when resume is called on non-paused execution", async () => {
      const nodes = [makeNode("A", "deployment")];
      const engine = createEngine({ nodes, edges: [] });

      // Execute completes immediately (no waitForInput)
      await engine.execute();

      await expect(engine.resume("A", "data")).rejects.toThrow(
        /Cannot resume: execution is "completed", not "paused"/
      );
    });

    it("pauses at waitForInput as the only node, then resumes", async () => {
      const nodes = [
        makeNode("W", "waitForInput", { inputSchema: { type: "number" } }),
      ];
      const engine = createEngine({ nodes, edges: [] });

      const state = await engine.execute();
      expect(state.status).toBe("paused");

      // Resume
      const finalState = await engine.resume("W", 42);

      expect(finalState.status).toBe("completed");
      expect(finalState.stepResults.get("W")?.status).toBe("completed");
      expect(finalState.stepResults.get("W")?.result).toBe(42);
    });
  });

  // ── Feature 3: Nested Flows (Subgraphs) ──────────────────────────────────

  describe("Nested Flows (Subflow)", () => {
    it("executes a subflow node and returns the child flow result", async () => {
      // We need to mock the DB to return a child flow definition
      const childDefinition: FlowDefinition = {
        nodes: [
          makeNode("childA", "transform", { value: "child-result" }),
          makeNode("childO", "output", { data: "{{childA.value}}" }),
        ],
        edges: [makeEdge("childA", "childO")],
      };

      // Override db.select to return the child flow when queried
      const { db: mockDb } = await import("../db/index.js");

      vi.spyOn(mockDb, "select").mockImplementation((...args: any[]) => {
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: () =>
            Promise.resolve([
              {
                id: "child_flow_1",
                definition: JSON.stringify(childDefinition),
                userId: "user_test",
                isPublic: false,
              },
            ]),
        };
        return chain;
      });

      const nodes = [
        makeNode("S", "subflow", { flowId: "child_flow_1" }),
      ];

      const substepEvents: any[] = [];
      const engine = createEngine({ nodes, edges: [] });
      engine.on("substep:started", (e) => substepEvents.push(e));
      engine.on("substep:finished", (e) => substepEvents.push(e));

      const state = await engine.execute();

      expect(state.status).toBe("completed");
      expect(state.stepResults.get("S")?.status).toBe("completed");

      // The subflow's output node result should be the parent node's result
      const subResult = state.stepResults.get("S")?.result;
      expect(subResult).toEqual({ data: "child-result" });

      // Substep events should have been emitted
      expect(substepEvents.length).toBeGreaterThan(0);

      // Restore
      vi.restoreAllMocks();
    });

    it("enforces nesting depth limit of 3", async () => {
      const nodes = [
        makeNode("S", "subflow", { flowId: "child_flow_1" }),
      ];

      // Create engine at nesting depth 3 (already at max)
      const engine = createEngine({ nodes, edges: [] }, 3);

      const state = await engine.execute();

      expect(state.status).toBe("failed");
      expect(state.stepResults.get("S")?.status).toBe("failed");
      expect(state.stepResults.get("S")?.error).toContain(
        "nesting depth exceeded"
      );
    });

    it("fails gracefully when subflow flowId is missing", async () => {
      const nodes = [
        makeNode("S", "subflow", {}), // no flowId
      ];

      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.status).toBe("failed");
      expect(state.stepResults.get("S")?.error).toContain("no config.flowId");
    });

    it("fails gracefully when subflow is not found in DB", async () => {
      const { db: mockDb } = await import("../db/index.js");

      vi.spyOn(mockDb, "select").mockImplementation((...args: any[]) => {
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: () => Promise.resolve([]), // not found
        };
        return chain;
      });

      const nodes = [
        makeNode("S", "subflow", { flowId: "nonexistent_flow" }),
      ];

      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.status).toBe("failed");
      expect(state.stepResults.get("S")?.error).toContain("not found");

      vi.restoreAllMocks();
    });

    it("accumulates child credits into parent total", async () => {
      const childDefinition: FlowDefinition = {
        nodes: [makeNode("childA", "deployment")],
        edges: [],
      };

      mockExecuteAgentCall.mockResolvedValue({
        result: { message: "ok" },
        creditsCharged: 15,
      });

      const { db: mockDb } = await import("../db/index.js");
      vi.spyOn(mockDb, "select").mockImplementation((...args: any[]) => {
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: () =>
            Promise.resolve([
              {
                id: "credit_flow",
                definition: JSON.stringify(childDefinition),
                userId: "user_test",
                isPublic: false,
              },
            ]),
        };
        return chain;
      });

      const nodes = [
        makeNode("S", "subflow", { flowId: "credit_flow" }),
      ];

      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      // The subflow's child deployment charged 15 credits
      expect(state.stepResults.get("S")?.creditsCharged).toBe(15);
      expect(state.totalCredits).toBe(15);

      vi.restoreAllMocks();
    });
  });

  // ── Backward compatibility ────────────────────────────────────────────────

  describe("Backward compatibility", () => {
    it("buildExecutionOrder still detects cycles and throws", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "A")];
      const engine = createEngine({ nodes, edges });

      expect(() => engine.buildExecutionOrder(nodes, edges)).toThrow(
        /Cycle detected/
      );
    });

    it("handles empty flow gracefully", async () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      expect(state.totalCredits).toBe(0);
    });

    it("cancellation still works", async () => {
      mockExecuteAgentCall.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { result: "ok", creditsCharged: 0 };
      });

      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      const engine = createEngine({ nodes, edges });
      setTimeout(() => engine.cancel(), 10);

      const state = await engine.execute();
      expect(state.status).toBe("cancelled");
    });
  });
});
