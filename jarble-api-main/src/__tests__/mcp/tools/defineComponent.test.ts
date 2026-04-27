/**
 * Unit tests for the `define_component` MCP tool.
 *
 * The tool persists a reusable UI component template to the bot's
 * PVC. Bots compose templates from built-in primitives (card,
 * data_table, etc.) with `{{variable}}` placeholders, then call
 * `render_ui` to instantiate them with concrete props.
 *
 * Three contracts pinned:
 *
 *   1. **Validation runs BEFORE the PVC write** — name validation
 *      and full-definition validation both run first, and a failure
 *      returns `success: false` without touching the pod. A
 *      regression that wrote first then validated would let
 *      malformed templates land on disk and crash later renders.
 *
 *   2. **Required-param shape** — `name` and `layout` are both
 *      mandatory; missing either returns a friendly error string
 *      to the LLM (so the bot can retry with fixes).
 *
 *   3. **PVC write failure surfaces as `success: false`** — when
 *      `writeComponentToPvc` throws (no pod, K8s API down), the
 *      tool catches and returns the error message. NEVER throws
 *      because that would crash the chat turn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWriteComponentToPvc = vi.fn();
const mockValidateComponentName = vi.fn();
const mockValidateComponentDefinition = vi.fn();

vi.mock("../../../k8s/index.js", () => ({
  writeComponentToPvc: (...args: any[]) => mockWriteComponentToPvc(...args),
}));

vi.mock("../../../utils/componentResolver.js", () => ({
  validateComponentName: (...args: any[]) => mockValidateComponentName(...args),
  validateComponentDefinition: (...args: any[]) => mockValidateComponentDefinition(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { defineComponentTool } from "../../../mcp/tools/defineComponent.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockWriteComponentToPvc.mockReset();
  mockValidateComponentName.mockReset();
  mockValidateComponentDefinition.mockReset();
  // Defaults: validations pass.
  mockValidateComponentName.mockReturnValue(null);
  mockValidateComponentDefinition.mockReturnValue(null);
  mockWriteComponentToPvc.mockResolvedValue(undefined);
});

function ctx(overrides: Partial<any> = {}): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      managedBy: "legacy",
      ...overrides,
    },
  };
}

const validLayout = [
  { component: "card", props: { title: "{{title}}", body: "{{body}}" } },
];

// ── Metadata ────────────────────────────────────────────────────────────────

describe("defineComponentTool — metadata", () => {
  it("registers under the name 'define_component'", () => {
    expect(defineComponentTool.name).toBe("define_component");
  });

  it("description mentions reusable templates + {{variable}} placeholders (LLM cue)", () => {
    const desc = defineComponentTool.description.toLowerCase();
    expect(desc).toContain("template");
    expect(desc).toContain("{{variable}}");
  });

  it("declares name + layout as required parameters", () => {
    const params = defineComponentTool.parameters as any;
    expect(params.required).toEqual(["name", "layout"]);
  });

  it("declares description as optional", () => {
    const params = defineComponentTool.parameters as any;
    expect(params.properties.description).toBeDefined();
    expect(params.required).not.toContain("description");
  });

  it("layout items require both component + props", () => {
    const params = defineComponentTool.parameters as any;
    expect(params.properties.layout.items.required).toEqual(["component", "props"]);
  });
});

// ── Required-param validation ──────────────────────────────────────────────

describe("defineComponentTool — required params", () => {
  it("rejects when name is missing", async () => {
    const r = await defineComponentTool.execute({ layout: validLayout }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing required parameters");
    expect(mockWriteComponentToPvc).not.toHaveBeenCalled();
  });

  it("rejects when layout is missing", async () => {
    const r = await defineComponentTool.execute({ name: "my_card" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing required parameters");
    expect(mockWriteComponentToPvc).not.toHaveBeenCalled();
  });

  it("rejects when name is empty string (falsy guard catches it)", async () => {
    const r = await defineComponentTool.execute({ name: "", layout: validLayout }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing required parameters");
    expect(mockWriteComponentToPvc).not.toHaveBeenCalled();
  });
});

// ── Validation runs BEFORE write ────────────────────────────────────────────

describe("defineComponentTool — validation precedes PVC write", () => {
  it("rejects on name validation error WITHOUT touching the PVC", async () => {
    mockValidateComponentName.mockReturnValueOnce("Name must be lowercase");

    const r = await defineComponentTool.execute(
      { name: "BadName", layout: validLayout },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toBe("Name must be lowercase");
    expect(mockValidateComponentName).toHaveBeenCalledWith("BadName");
    // Definition validation should NOT have run after name failed.
    expect(mockValidateComponentDefinition).not.toHaveBeenCalled();
    // PVC MUST NOT be touched.
    expect(mockWriteComponentToPvc).not.toHaveBeenCalled();
  });

  it("rejects on definition validation error WITHOUT touching the PVC", async () => {
    mockValidateComponentDefinition.mockReturnValueOnce(
      "Layout component 'unknown' is not a built-in",
    );

    const r = await defineComponentTool.execute(
      { name: "my_card", layout: [{ component: "unknown", props: {} }] },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("not a built-in");
    expect(mockValidateComponentDefinition).toHaveBeenCalledTimes(1);
    expect(mockWriteComponentToPvc).not.toHaveBeenCalled();
  });

  it("includes optional description in the validated definition", async () => {
    await defineComponentTool.execute(
      { name: "my_card", description: "A user card", layout: validLayout },
      ctx(),
    );

    const defArg = mockValidateComponentDefinition.mock.calls[0][0];
    expect(defArg).toEqual({
      name: "my_card",
      description: "A user card",
      layout: validLayout,
    });
  });

  it("OMITS description from the definition when not provided (no empty-string leak)", async () => {
    await defineComponentTool.execute({ name: "my_card", layout: validLayout }, ctx());

    const defArg = mockValidateComponentDefinition.mock.calls[0][0];
    expect(defArg).toEqual({ name: "my_card", layout: validLayout });
    // Critical: don't have a description key with empty/undefined value.
    expect(Object.keys(defArg)).not.toContain("description");
  });
});

// ── PVC write success ──────────────────────────────────────────────────────

describe("defineComponentTool — PVC write success", () => {
  it("returns success and a friendly message when write succeeds", async () => {
    const r = await defineComponentTool.execute(
      { name: "user_card", layout: validLayout },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("user_card");
    expect(r.message).toContain("saved");
    expect(r.message).toContain("render_ui");
  });

  it("calls writeComponentToPvc with deploymentId, name, definition, managedBy", async () => {
    await defineComponentTool.execute(
      { name: "my_card", description: "desc", layout: validLayout },
      ctx({ managedBy: "operator" }),
    );

    expect(mockWriteComponentToPvc).toHaveBeenCalledWith(
      "dep-abc",
      "my_card",
      { name: "my_card", description: "desc", layout: validLayout },
      "operator",
    );
  });

  it("defaults managedBy to 'legacy' when not on the deployment row", async () => {
    await defineComponentTool.execute(
      { name: "my_card", layout: validLayout },
      ctx({ managedBy: undefined }),
    );

    const args = mockWriteComponentToPvc.mock.calls[0];
    expect(args[3]).toBe("legacy");
  });
});

// ── PVC write failure ──────────────────────────────────────────────────────

describe("defineComponentTool — PVC write failure", () => {
  it("returns success=false when writeComponentToPvc throws", async () => {
    mockWriteComponentToPvc.mockRejectedValueOnce(new Error("No running pod"));

    const r = await defineComponentTool.execute(
      { name: "my_card", layout: validLayout },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to save component");
    expect(r.message).toContain("No running pod");
  });

  it("does NOT throw — caller (chat turn) must not crash on write failure", async () => {
    mockWriteComponentToPvc.mockRejectedValueOnce(new Error("kaboom"));

    await expect(
      defineComponentTool.execute({ name: "my_card", layout: validLayout }, ctx()),
    ).resolves.toBeDefined();
  });

  it("handles non-Error rejection (string, etc.)", async () => {
    mockWriteComponentToPvc.mockRejectedValueOnce("string error");

    const r = await defineComponentTool.execute(
      { name: "my_card", layout: validLayout },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("string error");
  });
});
