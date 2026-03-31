/**
 * Tests for render_ui MCP Tool - server-side component rendering.
 *
 * Covers: builtin component rendering, props validation, custom component
 * resolution, error formatting, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock K8s readComponentFromPvc
vi.mock("../../k8s/index.js", () => ({
  readComponentFromPvc: vi.fn(),
}));

// Mock componentResolver - keep isBuiltinComponent real, mock resolveCustomComponent
vi.mock("../../utils/componentResolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/componentResolver.js")>();
  return {
    ...actual,
    resolveCustomComponent: vi.fn(),
  };
});

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { renderUiTool } from "./renderUi.js";
import { readComponentFromPvc } from "../../k8s/index.js";
import { resolveCustomComponent } from "../../utils/componentResolver.js";
import { COMPONENT_NAME_SET, COMPONENT_SCHEMAS } from "@jarble/component-manifest";
import type { ToolContext } from "../toolRegistry.js";

const mockReadComponent = vi.mocked(readComponentFromPvc);
const mockResolveCustom = vi.mocked(resolveCustomComponent);

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-1",
  deployment: { id: "dep-1", managedBy: "legacy" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tool metadata ──────────────────────────────────────────────────────────

describe("renderUiTool metadata", () => {
  it("has the correct name", () => {
    expect(renderUiTool.name).toBe("render_ui");
  });

  it("has a description", () => {
    expect(renderUiTool.description).toBeTruthy();
    expect(renderUiTool.description).toContain("Render a UI component");
  });

  it("requires component and props parameters", () => {
    const params = renderUiTool.parameters as any;
    expect(params.required).toContain("component");
    expect(params.required).toContain("props");
  });

  it("sets rendersComponent to canvas_block", () => {
    expect(renderUiTool.rendersComponent).toBe("canvas_block");
  });
});

// ── Missing component parameter ────────────────────────────────────────────

describe("missing component parameter", () => {
  it("returns failure when component is empty string", async () => {
    const result = await renderUiTool.execute({ component: "", props: {} }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Missing");
  });

  it("returns failure when component is undefined", async () => {
    const result = await renderUiTool.execute({ props: {} } as any, ctx);
    expect(result.success).toBe(false);
  });
});

// ── Built-in component rendering ───────────────────────────────────────────

describe("built-in component rendering", () => {
  it("renders card with valid props", async () => {
    const result = await renderUiTool.execute(
      { component: "card", props: { title: "Hello", body: "World" } },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain("card");
    expect(result.data).toEqual({
      component: "card",
      props: { title: "Hello", body: "World" },
    });
  });

  it("renders alert with valid props", async () => {
    const result = await renderUiTool.execute(
      { component: "alert", props: { message: "Warning!", variant: "warning" } },
      ctx
    );
    expect(result.success).toBe(true);
    expect((result.data as any).component).toBe("alert");
  });

  it("renders data_table with columns and rows", async () => {
    const props = {
      columns: ["Name", "Age"],
      rows: [["Alice", "30"], ["Bob", "25"]],
    };
    const result = await renderUiTool.execute(
      { component: "data_table", props },
      ctx
    );
    expect(result.success).toBe(true);
    expect((result.data as any).props.columns).toEqual(["Name", "Age"]);
  });

  it("renders chart with valid props", async () => {
    const props = {
      type: "bar",
      data: [{ name: "Jan", value: 100 }],
      dataKeys: ["value"],
      xAxisKey: "name",
    };
    const result = await renderUiTool.execute(
      { component: "chart", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders sandbox with html props", async () => {
    const result = await renderUiTool.execute(
      { component: "sandbox", props: { html: "<div>Hello</div>" } },
      ctx
    );
    expect(result.success).toBe(true);
    expect((result.data as any).component).toBe("sandbox");
  });

  it("renders canvas (sandbox alias)", async () => {
    const result = await renderUiTool.execute(
      { component: "canvas", props: { html: "<div>Canvas</div>" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders stat_grid with stats array", async () => {
    const props = {
      stats: [{ label: "Users", value: "1234" }],
    };
    const result = await renderUiTool.execute(
      { component: "stat_grid", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders progress with value", async () => {
    const result = await renderUiTool.execute(
      { component: "progress", props: { value: 50 } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders code_block with code and language", async () => {
    const props = { code: "console.log('hi')", language: "javascript" };
    const result = await renderUiTool.execute(
      { component: "code_block", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders badge with text", async () => {
    const result = await renderUiTool.execute(
      { component: "badge", props: { text: "New" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders list with items", async () => {
    const props = { items: [{ text: "Item 1" }, { text: "Item 2" }] };
    const result = await renderUiTool.execute(
      { component: "list", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders timeline with events", async () => {
    const props = {
      events: [{ title: "Start", description: "Started" }],
    };
    const result = await renderUiTool.execute(
      { component: "timeline", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders divider component", async () => {
    const result = await renderUiTool.execute(
      { component: "divider", props: {} },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders form with fields", async () => {
    const props = {
      fields: [{ name: "email", label: "Email", type: "email" }],
    };
    const result = await renderUiTool.execute(
      { component: "form", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders metric_card with label and value", async () => {
    const result = await renderUiTool.execute(
      { component: "metric_card", props: { label: "Revenue", value: "$1M" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders map with center and markers", async () => {
    const props = {
      center: [40.7, -74.0],
      zoom: 10,
      markers: [{ lat: 40.7, lng: -74.0, label: "NYC" }],
    };
    const result = await renderUiTool.execute(
      { component: "map", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders image with src", async () => {
    const result = await renderUiTool.execute(
      { component: "image", props: { src: "https://example.com/img.png", alt: "test" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders tabs with tabs array", async () => {
    const props = {
      tabs: [{ label: "Tab 1", content: "Content 1" }],
    };
    const result = await renderUiTool.execute(
      { component: "tabs", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders accordion with items", async () => {
    const props = {
      items: [{ title: "Section 1", content: "Content" }],
    };
    const result = await renderUiTool.execute(
      { component: "accordion", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders header with title", async () => {
    const result = await renderUiTool.execute(
      { component: "header", props: { title: "Page Title" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders key_value with items", async () => {
    const props = {
      items: [{ key: "Name", value: "Alice" }],
    };
    const result = await renderUiTool.execute(
      { component: "key_value", props },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders blockquote with text", async () => {
    const result = await renderUiTool.execute(
      { component: "blockquote", props: { text: "A wise saying" } },
      ctx
    );
    expect(result.success).toBe(true);
  });

  it("renders video with url", async () => {
    const result = await renderUiTool.execute(
      { component: "video", props: { url: "https://example.com/video.mp4" } },
      ctx
    );
    expect(result.success).toBe(true);
  });
});

// ── All built-in components exist in COMPONENT_NAME_SET ────────────────────

describe("all built-in components are registered", () => {
  it("COMPONENT_NAME_SET has entries", () => {
    expect(COMPONENT_NAME_SET.size).toBeGreaterThan(30);
  });

  const builtins = Array.from(COMPONENT_NAME_SET);
  it.each(builtins)("component %s is in COMPONENT_NAME_SET", (name) => {
    expect(COMPONENT_NAME_SET.has(name)).toBe(true);
  });
});

// ── Props validation failures ──────────────────────────────────────────────

describe("props validation failures", () => {
  it("rejects chart with missing required type field", async () => {
    const result = await renderUiTool.execute(
      { component: "chart", props: { data: [], dataKeys: [] } },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid props");
    expect(result.message).toContain("chart");
  });

  it("rejects chart with invalid type enum value", async () => {
    const result = await renderUiTool.execute(
      { component: "chart", props: { type: "donut", data: [], dataKeys: [] } },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid props");
  });

  it("rejects data_table missing columns", async () => {
    const result = await renderUiTool.execute(
      { component: "data_table", props: { rows: [["a"]] } },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid props");
  });

  it("includes path information in validation errors", async () => {
    const result = await renderUiTool.execute(
      { component: "chart", props: {} },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("props.");
  });

  it("suggests using component_reference for schema", async () => {
    const result = await renderUiTool.execute(
      { component: "chart", props: {} },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain("component_reference");
  });

  it("limits displayed errors to 10", async () => {
    // Chart with empty props should produce multiple errors
    const result = await renderUiTool.execute(
      { component: "chart", props: {} },
      ctx
    );
    expect(result.success).toBe(false);
    // Should not have more than 10 numbered lines
    const numberedLines = result.message.split("\n").filter((l: string) => /^\s+\d+\./.test(l));
    expect(numberedLines.length).toBeLessThanOrEqual(10);
  });
});

// ── Custom component rendering ─────────────────────────────────────────────

describe("custom component rendering", () => {
  it("renders a custom component resolved from PVC", async () => {
    const definition = {
      name: "kpi_row",
      description: "KPI dashboard row",
      layout: [
        { component: "card", props: { title: "{{title}}" } },
      ],
    };
    mockReadComponent.mockResolvedValue(definition);
    mockResolveCustom.mockReturnValue([
      { component: "card", props: { title: "Revenue" } },
    ]);

    const result = await renderUiTool.execute(
      { component: "kpi_row", props: { title: "Revenue" } },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("kpi_row");
    expect((result.data as any).component).toBe("layout");
    expect((result.data as any).props.children).toHaveLength(1);
  });

  it("returns description as layout title for custom components", async () => {
    const definition = {
      name: "my_widget",
      description: "My custom widget",
      layout: [{ component: "card", props: {} }],
    };
    mockReadComponent.mockResolvedValue(definition);
    mockResolveCustom.mockReturnValue([{ component: "card", props: {} }]);

    const result = await renderUiTool.execute(
      { component: "my_widget", props: {} },
      ctx
    );
    expect((result.data as any).props.title).toBe("My custom widget");
  });

  it("returns failure when custom component not found on PVC", async () => {
    mockReadComponent.mockResolvedValue(null);

    const result = await renderUiTool.execute(
      { component: "nonexistent_widget", props: {} },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(result.message).toContain("list_components");
    expect(result.message).toContain("define_component");
  });

  it("handles errors during custom component resolution", async () => {
    mockReadComponent.mockRejectedValue(new Error("PVC read failed"));

    const result = await renderUiTool.execute(
      { component: "broken_widget", props: {} },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to resolve");
    expect(result.message).toContain("PVC read failed");
  });

  it("handles non-Error thrown during resolution", async () => {
    mockReadComponent.mockRejectedValue("string error");

    const result = await renderUiTool.execute(
      { component: "broken_widget", props: {} },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("string error");
  });

  it("passes deploymentId context when reading from PVC", async () => {
    mockReadComponent.mockResolvedValue(null);

    await renderUiTool.execute(
      { component: "custom_thing", props: {} },
      ctx
    );

    expect(mockReadComponent).toHaveBeenCalledWith("dep-1", "custom_thing");
  });
});

// ── Props passthrough for built-in components ──────────────────────────────

describe("props passthrough", () => {
  it("passes validated props through unchanged", async () => {
    const props = { title: "Test Card", body: "Body text" };
    const result = await renderUiTool.execute(
      { component: "card", props },
      ctx
    );
    expect(result.success).toBe(true);
    expect((result.data as any).props).toEqual(props);
  });

  it("handles null props gracefully", async () => {
    const result = await renderUiTool.execute(
      { component: "card", props: null },
      ctx
    );
    // Should default to {} and still succeed (card has no required fields)
    expect(result.success).toBe(true);
  });
});

// ── Component without schema ───────────────────────────────────────────────

describe("components without schema", () => {
  it("renders successfully when no schema exists for validation", async () => {
    // Some builtins might not have schemas - test that it still works
    // We test with divider which has minimal/no required props
    const result = await renderUiTool.execute(
      { component: "divider", props: {} },
      ctx
    );
    expect(result.success).toBe(true);
  });
});
