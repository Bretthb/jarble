/**
 * Flow Execution Engine tests.
 *
 * Tests buildExecutionOrder (topological sort), template variable resolution,
 * step execution by node type, error propagation, credit tracking, and events.
 *
 * Mocks: executeDelegation (from flowDelegation.js), db, logger.
 *
 * NOTE: flowEngine.ts was migrated from executeAgentCall (marketplaceHub.js)
 * to executeDelegation (flowDelegation.js). These mocks reflect the current API.
 * Deployment node step results now have shape { response: string, ... } instead
 * of the old arbitrary object shape. Template vars like {{A.response}} resolve
 * the agent's text reply.
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

// flowEngine.ts imports executeDelegation + buildDelegationTools + buildFlowSystemPrompt
// from flowDelegation.js. We mock the whole module so no real DB/K8s/pod calls happen.
const mockExecuteDelegation = vi.fn();
vi.mock("./flowDelegation.js", () => ({
  executeDelegation: (...args: any[]) => mockExecuteDelegation(...args),
  // buildDelegationTools returns [] so no team tools are injected (not what these tests measure)
  buildDelegationTools: () => [],
  buildFlowSystemPrompt: (_node: any, _tools: any, basePrompt: string) => basePrompt,
  // Re-export error classes and pure helpers that flowEngine.ts may import
  DelegationDepthExceededError: class DelegationDepthExceededError extends Error {},
  DelegationCycleError: class DelegationCycleError extends Error {},
  wouldExceedDepth: () => false,
  wouldCreateCycle: () => false,
  sanitizeDelegationError: (e: unknown) => String(e),
  stripDelegationBlocks: (s: string) => s,
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
    // deploymentId (not serviceId) is what the current flow engine reads
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
    // Default delegation result: agent replies "ok" and costs 5 credits.
    // Deployment node step result will be { response: "ok", ... }
    mockExecuteDelegation.mockResolvedValue({
      response: "ok",
      creditsUsed: 5,
      durationMs: 10,
      targetNodeId: "n",
      targetDeploymentId: "dep",
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
    it("calls executeDelegation and records the result", async () => {
      const nodes = [
        makeNode("agent1", "deployment", { prompt: "Hello" }),
      ];
      const engine = createEngine({ nodes, edges: [] });

      const state = await engine.execute();

      expect(mockExecuteDelegation).toHaveBeenCalledOnce();
      expect(mockExecuteDelegation).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDeploymentId: "dep_agent1",
          userId: "user_test",
        })
      );
      const stepResult = state.stepResults.get("agent1");
      expect(stepResult?.status).toBe("completed");
      // Result wraps delegation output: { response, uiBlocks, ... }
      expect((stepResult?.result as any)?.response).toBe("ok");
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
          input: "{{A}}",
          expression: "pick:response",
        }),
      ];
      const edges = [makeEdge("A", "T")];

      mockExecuteDelegation.mockResolvedValue({
        response: "hello",
        creditsUsed: 1,
        durationMs: 0,
        targetNodeId: "A",
        targetDeploymentId: "dep_A",
      });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      const tResult = state.stepResults.get("T");
      expect(tResult?.status).toBe("completed");
      expect(tResult?.result).toEqual({ response: "hello" });
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
        // Use {{A.response}} — the text reply from the agent, compared as a number
        makeNode("C", "condition", { condition: "{{A.response}} > 5" }),
      ];
      const edges = [makeEdge("A", "C")];

      mockExecuteDelegation.mockResolvedValue({
        response: "10",
        creditsUsed: 0,
        durationMs: 0,
        targetNodeId: "A",
        targetDeploymentId: "dep_A",
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
        // Deployment result has { response: "ok", ... } so use {{A.response}}
        makeNode("O", "output", { summary: "Got: {{A.response}}" }),
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

      const okResult = { response: "ok", creditsUsed: 1, durationMs: 0, targetNodeId: "x", targetDeploymentId: "dep_x" };
      mockExecuteDelegation
        .mockResolvedValueOnce(okResult) // A
        .mockRejectedValueOnce(new Error("B failed")) // B
        .mockResolvedValue(okResult); // D

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

      mockExecuteDelegation.mockImplementation(async () => {
        // Simulate slow step
        await new Promise((r) => setTimeout(r, 50));
        return { response: "ok", creditsUsed: 0, durationMs: 50, targetNodeId: "x", targetDeploymentId: "dep_x" };
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

      const base = { response: "ok", durationMs: 0, targetNodeId: "x", targetDeploymentId: "dep" };
      mockExecuteDelegation
        .mockResolvedValueOnce({ ...base, creditsUsed: 10 })
        .mockResolvedValueOnce({ ...base, creditsUsed: 7 });

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
      expect(completed[0].totalCredits).toBe(5); // default mock returns creditsUsed: 5
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

      mockExecuteDelegation.mockRejectedValueOnce(new Error("fail"));

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
      // {{A.response}} resolves to the agent's text reply — compare as string
      const edges = [makeEdge("A", "B", "{{A.response}} == yes")];

      mockExecuteDelegation.mockResolvedValueOnce({
        response: "no",
        creditsUsed: 0,
        durationMs: 0,
        targetNodeId: "A",
        targetDeploymentId: "dep_A",
      });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("B")?.status).toBe("skipped");
    });

    it("runs a node when edge condition is met", async () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B", "{{A.response}} == yes")];

      const base = { durationMs: 0, targetNodeId: "x", targetDeploymentId: "dep_x" };
      mockExecuteDelegation
        .mockResolvedValueOnce({ ...base, response: "yes", creditsUsed: 0 })
        .mockResolvedValueOnce({ ...base, response: "done", creditsUsed: 0 });

      const engine = createEngine({ nodes, edges });
      const state = await engine.execute();

      expect(state.stepResults.get("B")?.status).toBe("completed");
    });
  });
});
