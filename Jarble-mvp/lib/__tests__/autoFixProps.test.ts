import { describe, it, expect } from "vitest";
import { autoFixProps, COMPONENT_NAME_MAP } from "../autoFixProps";

// ── Component Name Normalization ────────────────────────────────────────────

describe("autoFixProps", () => {
  describe("component name normalization", () => {
    it("normalizes PascalCase to snake_case", () => {
      const result = autoFixProps("DataTable", {});
      expect(result.component).toBe("data_table");
    });

    it('normalizes "graph" to "chart"', () => {
      const result = autoFixProps("graph", {});
      expect(result.component).toBe("chart");
    });

    it('normalizes "kpi" to "metric_card"', () => {
      const result = autoFixProps("kpi", {});
      expect(result.component).toBe("metric_card");
    });

    it('normalizes "table" to "data_table"', () => {
      const result = autoFixProps("table", {});
      expect(result.component).toBe("data_table");
    });

    it("leaves already-correct names unchanged", () => {
      const result = autoFixProps("chart", {});
      expect(result.component).toBe("chart");
    });

    it('normalizes "StatGrid" to "stat_grid"', () => {
      const result = autoFixProps("StatGrid", {});
      expect(result.component).toBe("stat_grid");
    });

    it('normalizes "MetricCard" to "metric_card"', () => {
      const result = autoFixProps("MetricCard", {});
      expect(result.component).toBe("metric_card");
    });

    it("records a repair when the name is normalized", () => {
      const result = autoFixProps("DataTable", {});
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          rule: expect.any(String),
          field: "component",
          from: "DataTable",
          to: "data_table",
        }),
      );
    });

    it("records no repair when name is already correct", () => {
      const result = autoFixProps("chart", {});
      const nameRepairs = result.repairs.filter((r) => r.field === "component");
      expect(nameRepairs).toHaveLength(0);
    });
  });

  // ── COMPONENT_NAME_MAP ──────────────────────────────────────────────────

  describe("COMPONENT_NAME_MAP export", () => {
    it("exports a non-empty name map", () => {
      expect(COMPONENT_NAME_MAP).toBeDefined();
      expect(typeof COMPONENT_NAME_MAP).toBe("object");
      expect(Object.keys(COMPONENT_NAME_MAP).length).toBeGreaterThan(0);
    });

    it("maps common aliases", () => {
      expect(COMPONENT_NAME_MAP["table"]).toBe("data_table");
      expect(COMPONENT_NAME_MAP["graph"]).toBe("chart");
      expect(COMPONENT_NAME_MAP["kpi"]).toBe("metric_card");
    });
  });

  // ── Type Coercion ──────────────────────────────────────────────────────

  describe("type coercion", () => {
    it("coerces string number to number for progress value", () => {
      const result = autoFixProps("progress", { value: "75" });
      expect(result.props.value).toBe(75);
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          field: "props.value",
          from: "75",
          to: 75,
        }),
      );
    });

    it("coerces number to string for metric_card label", () => {
      const result = autoFixProps("metric_card", { label: 42, value: "$100" });
      expect(result.props.label).toBe("42");
    });

    it('coerces string "true" to boolean true', () => {
      const result = autoFixProps("chart", {
        stacked: "true",
        data: [],
        dataKeys: [],
      });
      expect(result.props.stacked).toBe(true);
    });

    it('coerces string "false" to boolean false', () => {
      const result = autoFixProps("chart", {
        stacked: "false",
        data: [],
        dataKeys: [],
      });
      expect(result.props.stacked).toBe(false);
    });

    it("does not coerce non-numeric strings to numbers", () => {
      const result = autoFixProps("progress", { value: "hello" });
      // Should leave it as-is (let Zod catch the error) or attempt best-effort
      expect(result.props.value).toBeDefined();
    });
  });

  // ── Enum Normalization ──────────────────────────────────────────────────

  describe("enum normalization", () => {
    it('normalizes alert variant "danger" to "destructive"', () => {
      const result = autoFixProps("alert", { message: "test", variant: "danger" });
      expect(result.props.variant).toBe("destructive");
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          field: "props.variant",
          from: "danger",
          to: "destructive",
        }),
      );
    });

    it('normalizes chart type "doughnut" to "pie"', () => {
      const result = autoFixProps("chart", {
        type: "doughnut",
        data: [],
        dataKeys: [],
      });
      expect(result.props.type).toBe("pie");
    });

    it('normalizes avatar size "small" to "sm"', () => {
      const result = autoFixProps("avatar", { name: "A", size: "small" });
      expect(result.props.size).toBe("sm");
    });

    it('normalizes avatar size "large" to "lg"', () => {
      const result = autoFixProps("avatar", { name: "A", size: "large" });
      expect(result.props.size).toBe("lg");
    });

    it('normalizes avatar size "medium" to "md"', () => {
      const result = autoFixProps("avatar", { name: "A", size: "medium" });
      expect(result.props.size).toBe("md");
    });
  });

  // ── Missing Defaults ────────────────────────────────────────────────────

  describe("missing defaults", () => {
    it("adds default variant to alert when missing", () => {
      const result = autoFixProps("alert", { message: "test" });
      expect(result.props.variant).toBe("info");
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          rule: expect.any(String),
          field: "props.variant",
          from: undefined,
          to: "info",
        }),
      );
    });

    it("adds default current to steps when missing", () => {
      const result = autoFixProps("steps", { items: [] });
      expect(result.props.current).toBe(0);
    });

    it("does not override existing variant on alert", () => {
      const result = autoFixProps("alert", { message: "test", variant: "warning" });
      expect(result.props.variant).toBe("warning");
    });

    it("does not override existing current on steps", () => {
      const result = autoFixProps("steps", { items: [], current: 2 });
      expect(result.props.current).toBe(2);
    });
  });

  // ── Structural Fixes ────────────────────────────────────────────────────

  describe("structural fixes", () => {
    it("unwraps nested props object", () => {
      const result = autoFixProps("card", { props: { title: "test" } });
      expect(result.props.title).toBe("test");
      expect(result.props.props).toBeUndefined();
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          rule: "unwrap-nested-props",
          field: "props",
        }),
      );
    });

    it("wraps single object in array for items field", () => {
      const result = autoFixProps("list", {
        items: { text: "single" } as unknown,
      });
      expect(Array.isArray(result.props.items)).toBe(true);
      expect(result.props.items).toEqual([{ text: "single" }]);
    });

    it("converts object-of-objects rows to array-of-arrays for data_table", () => {
      const result = autoFixProps("data_table", {
        columns: ["a", "b"],
        rows: [{ a: 1, b: 2 }],
      });
      expect(result.props.rows).toEqual([[1, 2]]);
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          field: "props.rows",
        }),
      );
    });

    it("leaves correct array-of-arrays rows unchanged for data_table", () => {
      const result = autoFixProps("data_table", {
        columns: ["a", "b"],
        rows: [[1, 2]],
      });
      expect(result.props.rows).toEqual([[1, 2]]);
      // No repair should be recorded for rows
      const rowRepairs = result.repairs.filter((r) => r.field === "rows");
      expect(rowRepairs).toHaveLength(0);
    });
  });

  // ── Field Aliases ──────────────────────────────────────────────────────

  describe("field aliases", () => {
    it('renames card "content" to "body"', () => {
      const result = autoFixProps("card", { content: "hello" });
      expect(result.props.body).toBe("hello");
      // The alias rule moves content to body and deletes content
      expect(result.repairs).toContainEqual(
        expect.objectContaining({
          rule: "field-content-to-body",
          field: "props.content -> props.body",
        }),
      );
    });

    it('renames alert "description" to "message"', () => {
      const result = autoFixProps("alert", { description: "msg" });
      expect(result.props.message).toBe("msg");
    });

    it('renames metric_card "name" to "label"', () => {
      const result = autoFixProps("metric_card", { name: "Rev", value: "100" });
      expect(result.props.label).toBe("Rev");
    });

    it("does not overwrite existing target field with alias", () => {
      const result = autoFixProps("alert", {
        message: "existing",
        description: "alias",
      });
      // The existing "message" should take priority
      expect(result.props.message).toBe("existing");
    });
  });

  // ── Data Normalization ──────────────────────────────────────────────────

  describe("data normalization", () => {
    it('strips "%" from progress value and converts to number', () => {
      const result = autoFixProps("progress", { value: "75%", label: "Done" });
      expect(result.props.value).toBe(75);
    });

    it("converts string sparkline values to numbers", () => {
      const result = autoFixProps("metric_card", {
        label: "X",
        value: "1",
        sparkline: ["1", "2", 3],
      });
      expect(result.props.sparkline).toEqual([1, 2, 3]);
    });

    it("handles mixed sparkline with non-numeric strings gracefully", () => {
      const result = autoFixProps("metric_card", {
        label: "X",
        value: "1",
        sparkline: ["1", "abc", 3],
      });
      // Non-numeric strings should become NaN or be handled
      expect(Array.isArray(result.props.sparkline)).toBe(true);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles null props gracefully", () => {
      const result = autoFixProps("card", null as unknown as Record<string, unknown>);
      expect(result).toBeDefined();
      expect(result.component).toBe("card");
      expect(result.props).toBeDefined();
    });

    it("handles undefined props gracefully", () => {
      const result = autoFixProps("card", undefined as unknown as Record<string, unknown>);
      expect(result).toBeDefined();
      expect(result.component).toBe("card");
      expect(result.props).toBeDefined();
    });

    it("returns empty objects unchanged", () => {
      const result = autoFixProps("card", {});
      expect(result.component).toBe("card");
      expect(result.props).toEqual({});
      expect(result.repairs).toHaveLength(0);
    });

    it("passes unknown component names through unchanged", () => {
      const result = autoFixProps("totally_unknown_widget", { foo: "bar" });
      expect(result.component).toBe("totally_unknown_widget");
      expect(result.props.foo).toBe("bar");
    });

    it("returns no repairs when props are already correct", () => {
      const result = autoFixProps("alert", {
        message: "hello",
        variant: "info",
      });
      expect(result.repairs).toHaveLength(0);
    });

    it("applies multiple repairs to the same component", () => {
      const result = autoFixProps("alert", {
        description: "msg",
        variant: "danger",
      });
      // Should have at least 2 repairs: alias rename + enum normalization
      expect(result.repairs.length).toBeGreaterThanOrEqual(2);
    });

    it("handles empty string component name", () => {
      const result = autoFixProps("", {});
      expect(result).toBeDefined();
      expect(result.component).toBe("");
    });
  });

  // ── Repairs Tracking ────────────────────────────────────────────────────

  describe("repairs tracking", () => {
    it("records correct rule, field, from, and to for type coercion", () => {
      const result = autoFixProps("progress", { value: "75" });
      const repair = result.repairs.find((r) => r.field === "props.value");
      expect(repair).toBeDefined();
      expect(repair!.rule).toBeDefined();
      expect(repair!.from).toBe("75");
      expect(repair!.to).toBe(75);
    });

    it("records correct repair info for enum normalization", () => {
      const result = autoFixProps("alert", { message: "test", variant: "danger" });
      const repair = result.repairs.find((r) => r.field === "props.variant");
      expect(repair).toBeDefined();
      expect(repair!.from).toBe("danger");
      expect(repair!.to).toBe("destructive");
    });

    it("records correct repair info for component name normalization", () => {
      const result = autoFixProps("DataTable", {});
      const repair = result.repairs.find((r) => r.field === "component");
      expect(repair).toBeDefined();
      expect(repair!.from).toBe("DataTable");
      expect(repair!.to).toBe("data_table");
    });

    it("records correct repair info for missing defaults", () => {
      const result = autoFixProps("alert", { message: "test" });
      const repair = result.repairs.find((r) => r.field === "props.variant" && r.to === "info");
      expect(repair).toBeDefined();
      expect(repair!.from).toBeUndefined();
    });

    it("returns empty repairs array when nothing needs fixing", () => {
      const result = autoFixProps("chart", {
        type: "bar",
        data: [],
        dataKeys: [],
      });
      expect(result.repairs).toEqual([]);
    });

    it("records repair for field alias", () => {
      const result = autoFixProps("metric_card", { name: "Rev", value: "100" });
      const repair = result.repairs.find(
        (r) => r.field.includes("label") || r.field.includes("name"),
      );
      expect(repair).toBeDefined();
    });
  });

  // ── Return Shape ──────────────────────────────────────────────────────

  describe("return shape", () => {
    it("always returns component, props, and repairs", () => {
      const result = autoFixProps("card", { title: "test" });
      expect(result).toHaveProperty("component");
      expect(result).toHaveProperty("props");
      expect(result).toHaveProperty("repairs");
      expect(typeof result.component).toBe("string");
      expect(typeof result.props).toBe("object");
      expect(Array.isArray(result.repairs)).toBe(true);
    });

    it("returns props as a plain object", () => {
      const result = autoFixProps("card", { title: "test" });
      expect(result.props).toEqual(expect.any(Object));
      expect(Array.isArray(result.props)).toBe(false);
    });
  });
});
