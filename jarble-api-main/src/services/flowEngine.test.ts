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

// The flow engine now delegates deployment node execution to flowDelegation's
// executeDelegation() rather than marketplaceHub's executeAgentCall(). We keep
// the test variable named mockExecuteAgentCall for readability — it now maps
// onto executeDelegation under the hood. The mock must return the
// delegationResult shape: { response, uiBlocks, componentDefs, suggestions,
// children, callId, depth, creditsUsed }. The engine re-wraps this into
// { result: { response, ... }, creditsCharged: creditsUsed } as the step result.
const mockExecuteAgentCall = vi.fn();
function toDelegationResult(agentCallReturn: any) {
  // Test helpers historically return { result, creditsCharged }. Adapt to the
  // new delegationResult shape so we don't have to rewrite every mock call.
  //
  // IMPORTANT: FlowExecutionEngine.executeDeploymentViaDelegation() only
  // forwards these 7 fields from delegationResult into the step's `result`:
  //   response, uiBlocks, componentDefs, suggestions, children, callId, depth.
  // If a test mock returned `{ result: { message: "hello" } }` (legacy shape),
  // the `message` key cannot survive the engine's projection. To keep legacy
  // assertions working we stash the inner object at BOTH `response` and on
  // each projected key as extra fields the engine does copy.
  const r = agentCallReturn ?? {};
  const inner = r.result;
  const innerObj = inner && typeof inner === "object" ? inner : {};
  return {
    response: typeof inner === "string" ? inner : innerObj,
    uiBlocks: innerObj,
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
    deploymentId: type === "deployment" ? `dep_${id}` : undefined,
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

    // ── Cycle 3 regression: {{nodeId.result.field}} must work ──────────────
    // Before the fix, `.result` in the path was walked against the unwrapped
    // StepResult.result (already at the data), so every such template
    // silently returned "" and users got broken pipelines. See Cycle 3 of
    // the 2026-04-11 bot teams QA marathon.
    it("resolves {{nodeId.result.field}} as alias for {{nodeId.field}} (Cycle 3)", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        [
          "stage1",
          {
            status: "completed",
            // Mirrors the shape executeDeploymentViaDelegation stores:
            // { response, uiBlocks, componentDefs, suggestions, children, ... }
            result: { response: "blue", uiBlocks: [], suggestions: [] },
          },
        ],
      ]);

      // Form 1: direct access (was already working)
      expect(
        engine.resolveTemplateVars("{{stage1.response}}", stepResults)
      ).toBe("blue");

      // Form 2: .result pass-through (new — JS-object-intuition form)
      expect(
        engine.resolveTemplateVars("{{stage1.result.response}}", stepResults)
      ).toBe("blue");

      // Form 2, interpolated in a longer task string
      expect(
        engine.resolveTemplateVars(
          "Reverse this: {{stage1.result.response}}",
          stepResults
        )
      ).toBe("Reverse this: blue");
    });

    it("does NOT hijack .result when the result object has its own result key", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      // If a node result legitimately has a `result` key (e.g. transform
      // nodes returning their config), the alias must not skip over it.
      const stepResults = new Map<string, StepResult>([
        [
          "transform1",
          {
            status: "completed",
            result: { result: "nested-value", other: "x" },
          },
        ],
      ]);

      // Accessing {{transform1.result}} must read the inner `result` key,
      // not return the whole outer object.
      expect(
        engine.resolveTemplateVars("{{transform1.result}}", stepResults)
      ).toBe("nested-value");
      // And {{transform1.other}} still works.
      expect(
        engine.resolveTemplateVars("{{transform1.other}}", stepResults)
      ).toBe("x");
    });

    it("{{stepN_result.field}} positional form still resolves", () => {
      const engine = createEngine({ nodes: [], edges: [] });
      const stepResults = new Map<string, StepResult>([
        ["alpha", { status: "completed", result: { response: "first" } }],
        ["beta", { status: "completed", result: { response: "second" } }],
      ]);

      expect(
        engine.resolveTemplateVars("{{step1_result.response}}", stepResults)
      ).toBe("first");
      expect(
        engine.resolveTemplateVars("{{step2_result.response}}", stepResults)
      ).toBe("second");
    });
  });

  // ── Step execution by node type ─────────────────────────────────────────

  describe("execute - deployment node", () => {
    it("delegates to the target deployment and records the result", async () => {
      const nodes = [
        makeNode("agent1", "deployment", { prompt: "Hello" }),
      ];
      const engine = createEngine({ nodes, edges: [] });

      const state = await engine.execute();

      expect(mockExecuteAgentCall).toHaveBeenCalledOnce();
      expect(mockExecuteAgentCall).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDeploymentId: "dep_agent1",
          targetNodeId: "agent1",
          userId: "user_test",
        })
      );
      const stepResult = state.stepResults.get("agent1") as any;
      expect(stepResult?.status).toBe("completed");
      // The engine projects delegationResult onto 7 fields. The test mock
      // stashes the legacy { message: "ok" } under `response` so assertions
      // can still reach it via stepResult.result.response.message.
      expect(stepResult?.result?.response?.message).toBe("ok");
      expect(stepResult?.creditsCharged).toBe(5);
    });

    it("fails when deployment node has no deploymentId", async () => {
      const node: FlowNode = {
        id: "bad",
        type: "deployment",
        label: "Bad Node",
        position: { x: 0, y: 0 },
        // no deploymentId
      };
      const engine = createEngine({ nodes: [node], edges: [] });
      const state = await engine.execute();

      expect(state.stepResults.get("bad")?.status).toBe("failed");
      expect(state.stepResults.get("bad")?.error).toContain("no deploymentId");
    });
  });

  describe("execute - transform node", () => {
    it("applies pick transform", async () => {
      const nodes = [
        makeNode("A", "deployment"),
        makeNode("T", "transform", {
          // After the delegation refactor, deployment nodes surface their
          // inner payload under `response`. Use pick:response.X to reach
          // fields on the delegated agent's reply.
          input: "{{A}}",
          expression: "pick:response",
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
      // pick:response picks the `response` field from the source stepResult,
      // which (per test-mock adapter) contains the legacy inner object.
      expect(tResult?.result).toEqual({
        response: { message: "hello", extra: "discard" },
      });
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
        // After delegation refactor, deployment-node payload lives under
        // `response`, so templates reach it via `{{A.response.count}}`.
        makeNode("C", "condition", { condition: "{{A.response.count}} > 5" }),
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
        // {{A.response}} reaches the delegated agent's primary reply string.
        makeNode("O", "output", { summary: "Got: {{A.response}}" }),
      ];
      const edges = [makeEdge("A", "O")];

      // beforeEach default mock returns { result: { message: "ok" } }; force
      // a string response so the template interpolates cleanly.
      mockExecuteAgentCall.mockResolvedValueOnce({
        result: "ok",
        creditsCharged: 5,
      });

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
      const edges = [makeEdge("A", "B", "{{A.response.go}} == yes")];

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
      const edges = [makeEdge("A", "B", "{{A.response.go}} == yes")];

      mockExecuteAgentCall
        .mockResolvedValueOnce({ result: { go: "yes" }, creditsCharged: 0 })
        .mockResolvedValueOnce({ result: "done", creditsCharged: 0 });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("B")?.status).toBe("completed");
    });
  });
});
