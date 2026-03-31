/**
 * Flow Execution Engine tests.
 *
 * Tests buildExecutionOrder (topological sort), template variable resolution,
 * step execution by node type, error propagation, credit tracking, and events.
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

const mockExecuteAgentCall = vi.fn();
vi.mock("./marketplaceHub.js", () => ({
  executeAgentCall: (...args: any[]) => mockExecuteAgentCall(...args),
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({
      values: () => Promise.resolve(undefined),
    }),
  },
  tables: {
    agentCalls: "agentCalls",
  },
  dbDate: () => new Date().toISOString(),
}));

import { FlowExecutionEngine } from "./flowEngine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  type: FlowNode["type"] = "deployment",
  config?: Record<string, unknown>
): FlowNode {
  return {
    id,
    type,
    label: `Node ${id}`,
    position: { x: 0, y: 0 },
    serviceId: type === "deployment" ? `svc_${id}` : undefined,
    config,
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

function createEngine(def: FlowDefinition): FlowExecutionEngine {
  return new FlowExecutionEngine("flow_test", "fex_test", def, "user_test");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FlowExecutionEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteAgentCall.mockResolvedValue({
      result: { message: "ok" },
      creditsCharged: 5,
    });
  });

  // ── buildExecutionOrder ──────────────────────────────────────────────────

  describe("buildExecutionOrder", () => {
    it("produces correct order for a linear chain A->B->C", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C")];
      const engine = createEngine({ nodes, edges });
      const order = engine.buildExecutionOrder(nodes, edges);

      expect(order).toEqual([["A"], ["B"], ["C"]]);
    });

    it("groups parallel branches A->(B,C) in the same level", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("A", "C")];
      const engine = createEngine({ nodes, edges });
      const order = engine.buildExecutionOrder(nodes, edges);

      expect(order.length).toBe(2);
      expect(order[0]).toEqual(["A"]);
      expect(order[1].sort()).toEqual(["B", "C"]);
    });

    it("handles a diamond pattern A->(B,C)->D", () => {
      const nodes = [
        makeNode("A"),
        makeNode("B"),
        makeNode("C"),
        makeNode("D"),
      ];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("A", "C"),
        makeEdge("B", "D"),
        makeEdge("C", "D"),
      ];
      const engine = createEngine({ nodes, edges });
      const order = engine.buildExecutionOrder(nodes, edges);

      expect(order.length).toBe(3);
      expect(order[0]).toEqual(["A"]);
      expect(order[1].sort()).toEqual(["B", "C"]);
      expect(order[2]).toEqual(["D"]);
    });

    it("detects a cycle and throws", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("B", "C"),
        makeEdge("C", "A"), // cycle
      ];
      const engine = createEngine({ nodes, edges });

      expect(() => engine.buildExecutionOrder(nodes, edges)).toThrow(
        /Cycle detected/
      );
    });

    it("handles a single node with no edges", () => {
      const nodes = [makeNode("A")];
      const engine = createEngine({ nodes, edges: [] });
      const order = engine.buildExecutionOrder(nodes, []);

      expect(order).toEqual([["A"]]);
    });

    it("handles multiple disconnected nodes as a single parallel group", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const engine = createEngine({ nodes, edges: [] });
      const order = engine.buildExecutionOrder(nodes, []);

      expect(order.length).toBe(1);
      expect(order[0].sort()).toEqual(["A", "B", "C"]);
    });

    it("skips edges referencing non-existent nodes", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B"), makeEdge("X", "B")]; // X doesn't exist
      const engine = createEngine({ nodes, edges });
      const order = engine.buildExecutionOrder(nodes, edges);

      expect(order).toEqual([["A"], ["B"]]);
    });
  });

  // ── Template variable resolution ────────────────────────────────────────

  describe("resolveTemplateVars", () => {
    it("resolves {{nodeId.field}} from completed step results", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["A", { status: "completed", result: { message: "hello" } }],
      ]);

      const result = engine.resolveTemplateVars(
        "Received: {{A.message}}",
        stepResults
      );
      expect(result).toBe("Received: hello");
    });

    it("resolves nested paths {{nodeId.obj.nested}}", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        [
          "A",
          {
            status: "completed",
            result: { data: { items: [1, 2, 3] } },
          },
        ],
      ]);

      const result = engine.resolveTemplateVars(
        "{{A.data.items}}",
        stepResults
      );
      // Full match - returns the raw value (array)
      expect(result).toEqual([1, 2, 3]);
    });

    it("preserves type for full-match templates (not interpolated)", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["A", { status: "completed", result: { count: 42 } }],
      ]);

      const result = engine.resolveTemplateVars("{{A.count}}", stepResults);
      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });

    it("returns empty string for missing variables in interpolation", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>();

      const result = engine.resolveTemplateVars(
        "Value: {{missing.field}}",
        stepResults
      );
      expect(result).toBe("Value: ");
    });

    it("returns undefined for missing full-match template", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>();

      const result = engine.resolveTemplateVars("{{missing.field}}", stepResults);
      expect(result).toBeUndefined();
    });

    it("resolves variables recursively in objects", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["A", { status: "completed", result: { name: "test" } }],
      ]);

      const result = engine.resolveTemplateVars(
        { key: "{{A.name}}", nested: { val: "prefix-{{A.name}}" } },
        stepResults
      );
      expect(result).toEqual({ key: "test", nested: { val: "prefix-test" } });
    });

    it("resolves variables in arrays", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["A", { status: "completed", result: { x: 1 } }],
      ]);

      const result = engine.resolveTemplateVars(["{{A.x}}", "static"], stepResults);
      expect(result).toEqual([1, "static"]);
    });

    it("passes through non-string primitives unchanged", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>();

      expect(engine.resolveTemplateVars(42, stepResults)).toBe(42);
      expect(engine.resolveTemplateVars(true, stepResults)).toBe(true);
      expect(engine.resolveTemplateVars(null, stepResults)).toBeNull();
    });

    it("does not resolve from non-completed steps", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["A", { status: "failed", error: "boom" }],
      ]);

      const result = engine.resolveTemplateVars("{{A.field}}", stepResults);
      expect(result).toBeUndefined();
    });
  });

  // ── Step execution by node type ─────────────────────────────────────────

  describe("execute - deployment node", () => {
    it("calls executeAgentCall and records the result", async () => {
      const nodes = [
        makeNode("agent1", "deployment", { prompt: "Hello" }),
      ];
      const engine = createEngine({ nodes, edges: [] });

      const state = await engine.execute();

      expect(mockExecuteAgentCall).toHaveBeenCalledOnce();
      expect(mockExecuteAgentCall).toHaveBeenCalledWith(
        expect.objectContaining({
          calleeServiceId: "svc_agent1",
          skillName: "default",
          callerUserId: "user_test",
        })
      );
      const stepResult = state.stepResults.get("agent1");
      expect(stepResult?.status).toBe("completed");
      expect(stepResult?.result).toEqual({ message: "ok" });
      expect(stepResult?.creditsCharged).toBe(5);
    });

    it("fails when deployment node has no serviceId", async () => {
      const node: FlowNode = {
        id: "bad",
        type: "deployment",
        label: "Bad Node",
        position: { x: 0, y: 0 },
        // no serviceId
      };
      const engine = createEngine({ nodes: [node], edges: [] });
      const state = await engine.execute();

      expect(state.stepResults.get("bad")?.status).toBe("failed");
      expect(state.stepResults.get("bad")?.error).toContain("no serviceId");
    });
  });

  describe("execute - transform node", () => {
    it("applies pick transform", async () => {
      const nodes = [
        makeNode("A", "deployment"),
        makeNode("T", "transform", {
          input: "{{A}}",
          expression: "pick:message",
        }),
      ];
      const edges = [makeEdge("A", "T")];

      mockExecuteAgentCall.mockResolvedValue({
        result: { message: "hello", extra: "discard" },
        creditsCharged: 1,
      });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      const tResult = state.stepResults.get("T");
      expect(tResult?.status).toBe("completed");
      expect(tResult?.result).toEqual({ message: "hello" });
    });

    it("applies merge transform (spreads the input object)", async () => {
      const nodes = [
        makeNode("T", "transform", {
          input: { a: 1, b: 2 },
          expression: "merge",
        }),
      ];
      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      const tResult = state.stepResults.get("T");
      expect(tResult?.status).toBe("completed");
      // merge uses context.input which is { a: 1, b: 2 }, spreads it
      expect(tResult?.result).toEqual({ a: 1, b: 2 });
    });

    it("passes through config as result when no expression", async () => {
      const nodes = [
        makeNode("T", "transform", { key: "value" }),
      ];
      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      const tResult = state.stepResults.get("T");
      expect(tResult?.status).toBe("completed");
      expect(tResult?.result).toEqual({ key: "value" });
    });
  });

  describe("execute - condition node", () => {
    it("evaluates truthy value to true", async () => {
      const nodes = [
        makeNode("C", "condition", { value: "non-empty" }),
      ];
      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.stepResults.get("C")?.result).toBe(true);
    });

    it("evaluates falsy value to false", async () => {
      const nodes = [
        makeNode("C", "condition", { value: "" }),
      ];
      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.stepResults.get("C")?.result).toBe(false);
    });

    it("evaluates comparison condition string", async () => {
      const nodes = [
        makeNode("A", "deployment"),
        makeNode("C", "condition", { condition: "{{A.count}} > 5" }),
      ];
      const edges = [makeEdge("A", "C")];

      mockExecuteAgentCall.mockResolvedValue({
        result: { count: 10 },
        creditsCharged: 0,
      });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("C")?.result).toBe(true);
    });
  });

  describe("execute - output node", () => {
    it("resolves template vars and returns config as result", async () => {
      const nodes = [
        makeNode("A", "deployment"),
        makeNode("O", "output", { summary: "Got: {{A.message}}" }),
      ];
      const edges = [makeEdge("A", "O")];

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("O")?.status).toBe("completed");
      expect(state.stepResults.get("O")?.result).toEqual({
        summary: "Got: ok",
      });
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe("error handling", () => {
    it("skips dependents of a failed step but runs independent branches", async () => {
      // A -> B (fails) -> C (should skip)
      // A -> D (independent, should run)
      const nodes = [
        makeNode("A"),
        makeNode("B"),
        makeNode("C"),
        makeNode("D"),
      ];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("B", "C"),
        makeEdge("A", "D"),
      ];

      mockExecuteAgentCall
        .mockResolvedValueOnce({ result: "ok", creditsCharged: 1 }) // A
        .mockRejectedValueOnce(new Error("B failed")) // B
        .mockResolvedValue({ result: "ok", creditsCharged: 1 }); // D

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("A")?.status).toBe("completed");
      expect(state.stepResults.get("B")?.status).toBe("failed");
      expect(state.stepResults.get("C")?.status).toBe("skipped");
      expect(state.stepResults.get("D")?.status).toBe("completed");
      expect(state.status).toBe("failed"); // overall failed because B failed
    });

    it("sets cancelled status when abort is called", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      mockExecuteAgentCall.mockImplementation(async () => {
        // Simulate slow step
        await new Promise((r) => setTimeout(r, 50));
        return { result: "ok", creditsCharged: 0 };
      });

      const engine = createEngine({ nodes, edges });

      // Cancel while first step is running
      setTimeout(() => engine.cancel(), 10);

      const state = await engine.execute();
      expect(state.status).toBe("cancelled");
    });

    it("handles empty flow definition gracefully", async () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const state = await engine.execute();

      expect(state.status).toBe("completed");
      expect(state.totalCredits).toBe(0);
    });

    it("handles pure cycle A<->B during execute() - runs with iteration limit", async () => {
      // With the state-machine model, A<->B is a pure cycle.
      // Both nodes have incoming edges, so the engine picks minimum in-degree nodes.
      // The cycle runs up to maxIterations (default 10) then stops.
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "A")];
      const engine = createEngine({ nodes, edges });

      const state = await engine.execute();

      // The cycle executes successfully (up to maxIterations), not a failure
      expect(state.status).toBe("completed");
    });
  });

  // ── Credit tracking ─────────────────────────────────────────────────────

  describe("credit tracking", () => {
    it("accumulates credits from deployment steps", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      mockExecuteAgentCall
        .mockResolvedValueOnce({ result: "ok", creditsCharged: 10 })
        .mockResolvedValueOnce({ result: "ok", creditsCharged: 7 });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.totalCredits).toBe(17);
    });

    it("does not charge credits for transform or condition nodes", async () => {
      const nodes = [
        makeNode("T", "transform", { key: "val" }),
        makeNode("C", "condition", { value: "truthy" }),
      ];
      const engine = createEngine({ nodes, edges: [] });
      const state = await engine.execute();

      expect(state.totalCredits).toBe(0);
    });
  });

  // ── Event emission ──────────────────────────────────────────────────────

  describe("event emission", () => {
    it("emits step:started and step:finished for each node", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      const startedEvents: any[] = [];
      const finishedEvents: any[] = [];

      const engine = createEngine({ nodes, edges });
      engine.on("step:started", (e) => startedEvents.push(e));
      engine.on("step:finished", (e) => finishedEvents.push(e));

      await engine.execute();

      expect(startedEvents.length).toBe(2);
      expect(finishedEvents.length).toBe(2);
      expect(startedEvents[0].nodeId).toBe("A");
      expect(startedEvents[1].nodeId).toBe("B");
      expect(finishedEvents[0].status).toBe("completed");
      expect(finishedEvents[1].status).toBe("completed");
    });

    it("emits flow:completed with summary data", async () => {
      const nodes = [makeNode("A")];
      const engine = createEngine({ nodes, edges: [] });

      const completed: any[] = [];
      engine.on("flow:completed", (e) => completed.push(e));

      await engine.execute();

      expect(completed.length).toBe(1);
      expect(completed[0].executionId).toBe("fex_test");
      expect(completed[0].totalCredits).toBe(5);
      expect(typeof completed[0].durationMs).toBe("number");
    });

    it("emits flow:state events during execution", async () => {
      const nodes = [makeNode("A")];
      const engine = createEngine({ nodes, edges: [] });

      const stateEvents: any[] = [];
      engine.on("flow:state", (e) => stateEvents.push(e));

      await engine.execute();

      // At minimum: running, step finished, final state
      expect(stateEvents.length).toBeGreaterThanOrEqual(2);
      const lastState = stateEvents[stateEvents.length - 1];
      expect(lastState.status).toBe("completed");
    });

    it("emits step:finished with skipped status for dependency failures", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      mockExecuteAgentCall.mockRejectedValueOnce(new Error("fail"));

      const finishedEvents: any[] = [];
      const engine = createEngine({ nodes, edges });
      engine.on("step:finished", (e) => finishedEvents.push(e));

      await engine.execute();

      const bFinished = finishedEvents.find((e) => e.nodeId === "B");
      expect(bFinished?.status).toBe("skipped");
      expect(bFinished?.error).toContain("A");
    });
  });

  // ── Edge conditions ─────────────────────────────────────────────────────

  describe("edge conditions", () => {
    it("skips a node when edge condition is not met", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B", "{{A.go}} == yes")];

      mockExecuteAgentCall.mockResolvedValueOnce({
        result: { go: "no" },
        creditsCharged: 0,
      });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("B")?.status).toBe("skipped");
    });

    it("runs a node when edge condition is met", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B", "{{A.go}} == yes")];

      mockExecuteAgentCall
        .mockResolvedValueOnce({ result: { go: "yes" }, creditsCharged: 0 })
        .mockResolvedValueOnce({ result: "done", creditsCharged: 0 });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("B")?.status).toBe("completed");
    });
  });
});
