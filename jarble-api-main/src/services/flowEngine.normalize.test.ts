/**
 * Tests for normalizeFlowNode / normalizeFlowDefinition.
 *
 * Regression guard for the 2026-04-11 bot teams QA finding: the canvas
 * saves orchestration fields (role, goal, canDelegate, contextScope,
 * isEntryPoint, modelOverride) under node.config.*, while the Zod schema
 * also accepts them at the top level and all server code reads from the
 * top level. Without normalization, UI-saved flows silently ignore
 * canDelegate=false and keep building delegation tools for specialists.
 *
 * These tests must NOT require DB/network — they exercise pure helpers.
 */
import { describe, it, expect, vi } from "vitest";

// Mock the db and logger modules because flowEngine.ts imports them transitively
// and db/index.ts throws if DATABASE_URL is not set. These tests only exercise
// pure helpers (normalizeFlowNode, normalizeFlowDefinition) + buildDelegationTools
// which itself is pure on this code path.
vi.mock("../db/index.js", () => ({
  db: {},
  tables: {},
  dbDate: () => new Date().toISOString(),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  normalizeFlowNode,
  normalizeFlowDefinition,
  type FlowNode,
  type FlowDefinition,
} from "./flowEngine.js";

describe("normalizeFlowNode", () => {
  it("promotes config.canDelegate=false to the top level (UI save shape)", () => {
    const raw = {
      id: "t2",
      type: "deployment" as const,
      deploymentId: "f30qkp1rzy1x",
      label: "t2",
      position: { x: 0, y: 0 },
      config: { canDelegate: false, role: "Analyst", goal: "Analyze" },
    };
    const out = normalizeFlowNode(raw);
    expect(out.canDelegate).toBe(false);
    expect(out.role).toBe("Analyst");
    expect(out.goal).toBe("Analyze");
  });

  it("promotes every orchestration field from config to the top level", () => {
    const raw = {
      id: "n1",
      type: "deployment" as const,
      label: "Coordinator",
      position: { x: 0, y: 0 },
      config: {
        role: "Lead",
        goal: "Coordinate",
        canDelegate: true,
        contextScope: "full" as const,
        isEntryPoint: true,
        modelOverride: "anthropic/claude-opus-4-6",
      },
    };
    const out = normalizeFlowNode(raw);
    expect(out.role).toBe("Lead");
    expect(out.goal).toBe("Coordinate");
    expect(out.canDelegate).toBe(true);
    expect(out.contextScope).toBe("full");
    expect(out.isEntryPoint).toBe(true);
    expect(out.modelOverride).toBe("anthropic/claude-opus-4-6");
  });

  it("keeps top-level values when both top-level and config are set", () => {
    const raw = {
      id: "n1",
      type: "deployment" as const,
      label: "x",
      position: { x: 0, y: 0 },
      canDelegate: false,
      role: "TopRole",
      config: { canDelegate: true, role: "ConfigRole" },
    };
    const out = normalizeFlowNode(raw);
    // Top-level wins on conflict — matches the "most explicit wins" principle.
    expect(out.canDelegate).toBe(false);
    expect(out.role).toBe("TopRole");
  });

  it("leaves top-level fields untouched when config is missing", () => {
    const raw = {
      id: "n1",
      type: "deployment" as const,
      label: "api-save",
      position: { x: 0, y: 0 },
      role: "API Role",
      canDelegate: true,
      isEntryPoint: true,
    };
    const out = normalizeFlowNode(raw);
    expect(out.role).toBe("API Role");
    expect(out.canDelegate).toBe(true);
    expect(out.isEntryPoint).toBe(true);
  });

  it("is idempotent (normalize twice equals normalize once)", () => {
    const raw = {
      id: "n1",
      type: "deployment" as const,
      label: "x",
      position: { x: 0, y: 0 },
      config: { canDelegate: false, role: "A" },
    };
    const once = normalizeFlowNode(raw);
    const twice = normalizeFlowNode(once);
    expect(twice).toEqual(once);
  });

  it("returns undefined when neither location defines a field", () => {
    const raw = {
      id: "n1",
      type: "deployment" as const,
      label: "x",
      position: { x: 0, y: 0 },
    };
    const out = normalizeFlowNode(raw);
    expect(out.canDelegate).toBeUndefined();
    expect(out.role).toBeUndefined();
    expect(out.isEntryPoint).toBeUndefined();
  });
});

describe("normalizeFlowDefinition", () => {
  it("normalizes every node in a definition", () => {
    const def: FlowDefinition = {
      nodes: [
        {
          id: "t1",
          type: "deployment",
          label: "t1",
          position: { x: 0, y: 0 },
          config: { canDelegate: true, isEntryPoint: true },
        } as any,
        {
          id: "t2",
          type: "deployment",
          label: "t2",
          position: { x: 0, y: 0 },
          config: { canDelegate: false, role: "Analyst" },
        } as any,
      ],
      edges: [],
    };
    const out = normalizeFlowDefinition(def);
    expect(out.nodes[0].canDelegate).toBe(true);
    expect(out.nodes[0].isEntryPoint).toBe(true);
    expect(out.nodes[1].canDelegate).toBe(false);
    expect(out.nodes[1].role).toBe("Analyst");
  });

  it("leaves edges alone", () => {
    const def = {
      nodes: [],
      edges: [{ id: "e1", source: "a", target: "b", type: "delegates" }],
    } as any;
    const out = normalizeFlowDefinition(def);
    expect(out.edges).toEqual(def.edges);
  });

  it("is safe on empty / malformed input", () => {
    expect(normalizeFlowDefinition({ nodes: [], edges: [] } as any).nodes).toEqual([]);
    expect(normalizeFlowDefinition({} as any)).toEqual({});
    expect(normalizeFlowDefinition(null as any)).toBeNull();
  });
});

describe("integration: normalize + buildDelegationTools", () => {
  it("blocks delegation tool construction when config.canDelegate is false", async () => {
    // Dynamic import after vitest module setup — buildDelegationTools is pure
    // (no DB calls on this path), safe to import directly.
    const { buildDelegationTools } = await import("./flowDelegation.js");

    const rawNode: any = {
      id: "n1",
      type: "deployment",
      deploymentId: "dep-coord",
      label: "Coordinator",
      position: { x: 0, y: 0 },
      // UI-style save shape — canDelegate is hidden inside config.
      config: { canDelegate: false },
    };
    const nodes: any[] = [
      rawNode,
      {
        id: "n2",
        type: "deployment",
        deploymentId: "dep-specialist",
        label: "Specialist",
        position: { x: 0, y: 0 },
      },
    ];
    const edges: any[] = [{ id: "e1", source: "n1", target: "n2", type: "delegates" }];

    // Before normalization: buildDelegationTools reads rawNode.canDelegate
    // (undefined) and falls through → builds a tool. This is the bug.
    const beforeFix = buildDelegationTools(rawNode, nodes, edges);
    expect(beforeFix.length).toBe(1);

    // After normalization: canDelegate is promoted to top level → builds no tools.
    const normalized = normalizeFlowNode(rawNode);
    const afterFix = buildDelegationTools(normalized as FlowNode, nodes, edges);
    expect(afterFix.length).toBe(0);
  });
});
