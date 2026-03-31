/**
 * Tests for list_components MCP Tool - component discovery.
 *
 * Covers: built-in listing, custom component integration, response format,
 * edge cases with empty/failing PVC reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock K8s listComponentsOnPvc
vi.mock("../../k8s/index.js", () => ({
  listComponentsOnPvc: vi.fn(),
}));

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { listComponentsTool } from "./listComponents.js";
import { listComponentsOnPvc } from "../../k8s/index.js";
import { COMPONENT_NAME_SET } from "@jarble/component-manifest";
import type { ToolContext } from "../toolRegistry.js";

const mockListComponents = vi.mocked(listComponentsOnPvc);

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-1",
  deployment: { id: "dep-1", managedBy: "legacy" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListComponents.mockResolvedValue([]);
});

// ── Tool metadata ──────────────────────────────────────────────────────────

describe("listComponentsTool metadata", () => {
  it("has the correct name", () => {
    expect(listComponentsTool.name).toBe("list_components");
  });

  it("has a description", () => {
    expect(listComponentsTool.description).toBeTruthy();
    expect(listComponentsTool.description).toContain("List all available UI components");
  });

  it("has no required parameters", () => {
    const params = listComponentsTool.parameters as any;
    expect(params.required).toBeUndefined();
  });

  it("sets rendersComponent to canvas_block", () => {
    expect(listComponentsTool.rendersComponent).toBe("canvas_block");
  });
});

// ── Built-in components listing ────────────────────────────────────────────

describe("built-in components listing", () => {
  it("returns all built-in components", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    expect(result.success).toBe(true);
    const rows = (result.data as any).props.rows;
    const builtinRows = rows.filter((r: string[]) => r[1] === "built-in");
    expect(builtinRows.length).toBe(COMPONENT_NAME_SET.size);
  });

  it("includes component names as first column", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const names = rows.map((r) => r[0]);
    // Verify some known components are present
    expect(names).toContain("card");
    expect(names).toContain("chart");
    expect(names).toContain("data_table");
    expect(names).toContain("sandbox");
  });

  it("marks all built-in components as type built-in", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const builtins = rows.filter((r) => r[1] === "built-in");
    expect(builtins.length).toBeGreaterThan(30);
  });

  it("includes descriptions for built-in components", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const cardRow = rows.find((r) => r[0] === "card");
    expect(cardRow).toBeDefined();
    // Description should be non-empty for card
    expect(cardRow![2].length).toBeGreaterThan(0);
  });
});

// ── Response format ────────────────────────────────────────────────────────

describe("response format", () => {
  it("returns data_table component", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    expect((result.data as any).component).toBe("data_table");
  });

  it("has correct column headers", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    expect((result.data as any).props.columns).toEqual([
      "Name",
      "Type",
      "Description",
    ]);
  });

  it("has title Available Components", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    expect((result.data as any).props.title).toBe("Available Components");
  });

  it("includes summary message with counts", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    expect(result.message).toContain(`${COMPONENT_NAME_SET.size} built-in`);
    expect(result.message).toContain("0 custom");
  });

  it("each row is a 3-element tuple", async () => {
    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as unknown[][];
    for (const row of rows) {
      expect(row).toHaveLength(3);
    }
  });
});

// ── Custom components from PVC ─────────────────────────────────────────────

describe("custom components from PVC", () => {
  it("includes custom components after builtins", async () => {
    mockListComponents.mockResolvedValue([
      { name: "kpi_row", description: "Custom KPI row widget" },
    ]);

    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const customRows = rows.filter((r) => r[1] === "custom");
    expect(customRows).toHaveLength(1);
    expect(customRows[0][0]).toBe("kpi_row");
    expect(customRows[0][2]).toBe("Custom KPI row widget");
  });

  it("handles multiple custom components", async () => {
    mockListComponents.mockResolvedValue([
      { name: "widget_a", description: "Widget A" },
      { name: "widget_b", description: "Widget B" },
      { name: "widget_c" },
    ]);

    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const customRows = rows.filter((r) => r[1] === "custom");
    expect(customRows).toHaveLength(3);
    expect(result.message).toContain("3 custom");
  });

  it("handles custom components with no description", async () => {
    mockListComponents.mockResolvedValue([
      { name: "no_desc_widget" },
    ]);

    const result = await listComponentsTool.execute({}, ctx);
    const rows = (result.data as any).props.rows as string[][];
    const customRow = rows.find((r) => r[0] === "no_desc_widget");
    expect(customRow).toBeDefined();
    expect(customRow![2]).toBe("");
  });

  it("passes managedBy from deployment context", async () => {
    const ctxWithManaged: ToolContext = {
      ...ctx,
      deployment: { id: "dep-1", managedBy: "helm" },
    };
    await listComponentsTool.execute({}, ctxWithManaged);
    expect(mockListComponents).toHaveBeenCalledWith("dep-1", "helm");
  });

  it("defaults managedBy to legacy when not set", async () => {
    const ctxNoManaged: ToolContext = {
      ...ctx,
      deployment: { id: "dep-1" },
    };
    await listComponentsTool.execute({}, ctxNoManaged);
    expect(mockListComponents).toHaveBeenCalledWith("dep-1", "legacy");
  });
});
