import { describe, it, expect } from "vitest";
import { validateJsonSchema, autofixNativeProps } from "./jsonSchemaValidator.js";
import { resolveThemeTokens, tokensToCss } from "../prompts/themeTokens.js";
import type { DashboardThemeTokens } from "../prompts/themeTokens.js";

// ── validateJsonSchema ───────────────────────────────────────────────────────

describe("validateJsonSchema", () => {
  // ── Type checking ────────────────────────────────────────────────────────

  describe("type checking", () => {
    it("validates string type", () => {
      const schema = { type: "string" };
      expect(validateJsonSchema("hello", schema)).toEqual([]);
      expect(validateJsonSchema(42, schema)).toHaveLength(1);
      expect(validateJsonSchema(42, schema)[0].message).toMatch(/Expected string/);
    });

    it("validates number type", () => {
      const schema = { type: "number" };
      expect(validateJsonSchema(42, schema)).toEqual([]);
      expect(validateJsonSchema("42", schema)).toHaveLength(1);
      expect(validateJsonSchema("42", schema)[0].message).toMatch(/Expected number/);
    });

    it("validates boolean type", () => {
      const schema = { type: "boolean" };
      expect(validateJsonSchema(true, schema)).toEqual([]);
      expect(validateJsonSchema(false, schema)).toEqual([]);
      expect(validateJsonSchema("true", schema)).toHaveLength(1);
    });

    it("validates array type", () => {
      const schema = { type: "array" };
      expect(validateJsonSchema([1, 2, 3], schema)).toEqual([]);
      expect(validateJsonSchema("not-array", schema)).toHaveLength(1);
      expect(validateJsonSchema({}, schema)).toHaveLength(1);
    });

    it("validates object type", () => {
      const schema = { type: "object", properties: {} };
      expect(validateJsonSchema({}, schema)).toEqual([]);
      expect(validateJsonSchema("not-object", schema)).toHaveLength(1);
      expect(validateJsonSchema([], schema)).toHaveLength(1);
    });

    it("validates null type", () => {
      const schema = { type: "null" };
      expect(validateJsonSchema(null, schema)).toEqual([]);
      expect(validateJsonSchema(undefined, schema)).toHaveLength(1);
    });

    it("handles union types (array of types)", () => {
      const schema = { type: ["string", "number"] };
      expect(validateJsonSchema("hello", schema)).toEqual([]);
      expect(validateJsonSchema(42, schema)).toEqual([]);
      expect(validateJsonSchema(true, schema)).toHaveLength(1);
    });
  });

  // ── Required fields ──────────────────────────────────────────────────────

  describe("required fields", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    };

    it("returns empty array when all required fields are present", () => {
      const errors = validateJsonSchema({ name: "Alice", age: 30 }, schema);
      expect(errors).toEqual([]);
    });

    it("catches missing required fields", () => {
      const errors = validateJsonSchema({ name: "Alice" }, schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("/age");
      expect(errors[0].message).toContain("Required field");
      expect(errors[0].message).toContain("age");
    });

    it("reports multiple missing required fields", () => {
      const errors = validateJsonSchema({}, schema);
      expect(errors).toHaveLength(2);
      const paths = errors.map((e) => e.path);
      expect(paths).toContain("/name");
      expect(paths).toContain("/age");
    });
  });

  // ── Enum validation ──────────────────────────────────────────────────────

  describe("enum validation", () => {
    const schema = { enum: ["bar", "line", "pie"] };

    it("accepts a valid enum value", () => {
      expect(validateJsonSchema("bar", schema)).toEqual([]);
      expect(validateJsonSchema("line", schema)).toEqual([]);
    });

    it("rejects an invalid enum value", () => {
      const errors = validateJsonSchema("scatter", schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("not in enum");
      expect(errors[0].message).toContain("scatter");
    });
  });

  // ── Nested objects ───────────────────────────────────────────────────────

  describe("nested object types", () => {
    const schema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            count: { type: "number" },
          },
          required: ["enabled"],
        },
      },
      required: ["config"],
    };

    it("validates nested object with correct types", () => {
      const errors = validateJsonSchema({ config: { enabled: true, count: 5 } }, schema);
      expect(errors).toEqual([]);
    });

    it("catches type errors in nested properties", () => {
      const errors = validateJsonSchema({ config: { enabled: "yes", count: 5 } }, schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("/config/enabled");
      expect(errors[0].message).toMatch(/Expected boolean/);
    });

    it("catches missing required fields in nested objects", () => {
      const errors = validateJsonSchema({ config: {} }, schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("/config/enabled");
    });
  });

  // ── Array items ──────────────────────────────────────────────────────────

  describe("array items", () => {
    const schema = {
      type: "array",
      items: { type: "number" },
    };

    it("validates array with correct item types", () => {
      expect(validateJsonSchema([1, 2, 3], schema)).toEqual([]);
    });

    it("catches invalid items in array", () => {
      const errors = validateJsonSchema([1, "two", 3], schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("[1]");
      expect(errors[0].message).toMatch(/Expected number/);
    });

    it("validates empty array", () => {
      expect(validateJsonSchema([], schema)).toEqual([]);
    });

    it("validates array of objects", () => {
      const objArraySchema = {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "number" } },
          required: ["id"],
        },
      };
      expect(validateJsonSchema([{ id: 1 }, { id: 2 }], objArraySchema)).toEqual([]);
      const errors = validateJsonSchema([{ id: 1 }, {}], objArraySchema);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("[1]/id");
    });

    it("enforces minItems", () => {
      const minSchema = { type: "array", items: { type: "number" }, minItems: 2 };
      expect(validateJsonSchema([1, 2], minSchema)).toEqual([]);
      const errors = validateJsonSchema([1], minSchema);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("at least 2 items");
    });
  });

  // ── anyOf / oneOf ────────────────────────────────────────────────────────

  describe("anyOf / oneOf schemas", () => {
    it("accepts value matching one of anyOf schemas", () => {
      const schema = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      expect(validateJsonSchema("hello", schema)).toEqual([]);
      expect(validateJsonSchema(42, schema)).toEqual([]);
    });

    it("rejects value matching none of anyOf schemas", () => {
      const schema = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      const errors = validateJsonSchema(true, schema);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("does not match any");
    });

    it("handles oneOf the same way as anyOf", () => {
      const schema = {
        oneOf: [{ type: "string" }, { type: "boolean" }],
      };
      expect(validateJsonSchema("hello", schema)).toEqual([]);
      expect(validateJsonSchema(true, schema)).toEqual([]);
      const errors = validateJsonSchema(42, schema);
      expect(errors).toHaveLength(1);
    });

    it("anyOf with complex sub-schemas", () => {
      const schema = {
        anyOf: [
          { type: "object", properties: { kind: { enum: ["a"] } }, required: ["kind"] },
          { type: "object", properties: { kind: { enum: ["b"] } }, required: ["kind"] },
        ],
      };
      expect(validateJsonSchema({ kind: "a" }, schema)).toEqual([]);
      expect(validateJsonSchema({ kind: "b" }, schema)).toEqual([]);
      const errors = validateJsonSchema({ kind: "c" }, schema);
      expect(errors).toHaveLength(1);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty array for valid input", () => {
      const schema = {
        type: "object",
        properties: {
          title: { type: "string" },
          count: { type: "number" },
        },
        required: ["title"],
      };
      expect(validateJsonSchema({ title: "test", count: 10 }, schema)).toEqual([]);
    });

    it("returns empty array for null/undefined schema", () => {
      expect(validateJsonSchema("anything", null as unknown as Record<string, unknown>)).toEqual([]);
      expect(validateJsonSchema("anything", undefined as unknown as Record<string, unknown>)).toEqual([]);
    });

    it("respects custom path prefix", () => {
      const schema = { type: "string" };
      const errors = validateJsonSchema(42, schema, "/root/field");
      expect(errors[0].path).toBe("/root/field");
    });

    it("skips validation for properties not present in value", () => {
      const schema = {
        type: "object",
        properties: {
          optional: { type: "number" },
        },
      };
      // "optional" is not required and not present - should not error
      expect(validateJsonSchema({}, schema)).toEqual([]);
    });
  });
});

// ── autofixNativeProps ───────────────────────────────────────────────────────

describe("autofixNativeProps", () => {
  describe("data_table", () => {
    it("converts rows from objects to arrays of values", () => {
      const props = {
        columns: ["name", "age"],
        rows: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
      };
      const fixed = autofixNativeProps("data_table", props);
      expect(fixed.rows).toEqual([
        ["Alice", 30],
        ["Bob", 25],
      ]);
    });

    it("leaves rows that are already arrays unchanged", () => {
      const props = {
        columns: ["name", "age"],
        rows: [
          ["Alice", 30],
          ["Bob", 25],
        ],
      };
      const fixed = autofixNativeProps("data_table", props);
      expect(fixed.rows).toEqual([
        ["Alice", 30],
        ["Bob", 25],
      ]);
    });

    it("wraps scalar row values in arrays", () => {
      const props = {
        columns: ["value"],
        rows: ["one", "two"],
      };
      const fixed = autofixNativeProps("data_table", props);
      expect(fixed.rows).toEqual([["one"], ["two"]]);
    });

    it("handles mixed row formats", () => {
      const props = {
        columns: ["a", "b"],
        rows: [
          { a: 1, b: 2 },
          [3, 4],
          "scalar",
        ],
      };
      const fixed = autofixNativeProps("data_table", props);
      expect(fixed.rows).toEqual([[1, 2], [3, 4], ["scalar"]]);
    });
  });

  describe("chart", () => {
    it("auto-derives dataKeys from data when missing", () => {
      const props = {
        data: [
          { month: "Jan", revenue: 100, costs: 50 },
          { month: "Feb", revenue: 200, costs: 75 },
        ],
      };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.dataKeys).toEqual(["revenue", "costs"]);
    });

    it("auto-derives xAxisKey from data when missing", () => {
      const props = {
        data: [
          { month: "Jan", revenue: 100 },
          { month: "Feb", revenue: 200 },
        ],
      };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.xAxisKey).toBe("month");
    });

    it("does not override existing dataKeys", () => {
      const props = {
        data: [
          { month: "Jan", revenue: 100, costs: 50 },
        ],
        dataKeys: ["revenue"],
        xAxisKey: "month",
      };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.dataKeys).toEqual(["revenue"]);
    });

    it("does not override existing xAxisKey", () => {
      const props = {
        data: [
          { month: "Jan", label: "January", revenue: 100 },
        ],
        xAxisKey: "label",
      };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.xAxisKey).toBe("label");
    });

    it("excludes xAxisKey from auto-derived dataKeys", () => {
      const props = {
        data: [
          { category: "A", count: 10, total: 30 },
        ],
        xAxisKey: "category",
      };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.dataKeys).toEqual(["count", "total"]);
      expect(fixed.dataKeys).not.toContain("category");
    });

    it("skips derivation when data is empty", () => {
      const props = { data: [] };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.dataKeys).toBeUndefined();
      expect(fixed.xAxisKey).toBeUndefined();
    });

    it("skips derivation when data rows are not objects", () => {
      const props = { data: [1, 2, 3] };
      const fixed = autofixNativeProps("chart", props);
      expect(fixed.dataKeys).toBeUndefined();
    });
  });

  describe("stat_grid", () => {
    it("wraps single stat object in array", () => {
      const props = {
        stats: { label: "Revenue", value: "$1M" },
      };
      const fixed = autofixNativeProps("stat_grid", props);
      expect(Array.isArray(fixed.stats)).toBe(true);
      expect(fixed.stats).toEqual([{ label: "Revenue", value: "$1M" }]);
    });

    it("leaves stats array unchanged", () => {
      const props = {
        stats: [
          { label: "Revenue", value: "$1M" },
          { label: "Users", value: "500" },
        ],
      };
      const fixed = autofixNativeProps("stat_grid", props);
      expect(fixed.stats).toHaveLength(2);
    });
  });

  describe("form", () => {
    it("wraps single field object in array", () => {
      const props = {
        fields: { name: "email", type: "text", label: "Email" },
      };
      const fixed = autofixNativeProps("form", props);
      expect(Array.isArray(fixed.fields)).toBe(true);
      expect(fixed.fields).toEqual([{ name: "email", type: "text", label: "Email" }]);
    });

    it("leaves fields array unchanged", () => {
      const props = {
        fields: [
          { name: "email", type: "text" },
          { name: "password", type: "password" },
        ],
      };
      const fixed = autofixNativeProps("form", props);
      expect(fixed.fields).toHaveLength(2);
    });
  });

  describe("card field aliases", () => {
    it("renames content to body", () => {
      const props = { content: "Hello world", title: "Card" };
      const fixed = autofixNativeProps("card", props);
      expect(fixed.body).toBe("Hello world");
      expect(fixed.content).toBeUndefined();
    });

    it("does not rename content if body already exists", () => {
      const props = { content: "old", body: "existing", title: "Card" };
      const fixed = autofixNativeProps("card", props);
      expect(fixed.body).toBe("existing");
      expect(fixed.content).toBe("old");
    });
  });

  describe("alert field aliases", () => {
    it("renames description to message", () => {
      const props = { description: "Something went wrong", variant: "error" };
      const fixed = autofixNativeProps("alert", props);
      expect(fixed.message).toBe("Something went wrong");
      expect(fixed.description).toBeUndefined();
    });

    it("does not rename description if message already exists", () => {
      const props = { description: "old", message: "existing" };
      const fixed = autofixNativeProps("alert", props);
      expect(fixed.message).toBe("existing");
      expect(fixed.description).toBe("old");
    });
  });

  describe("no-op for unknown components", () => {
    it("returns props unchanged for unrecognized component", () => {
      const props = { foo: "bar", baz: 123 };
      const fixed = autofixNativeProps("unknown_component", { ...props });
      expect(fixed).toEqual(props);
    });
  });
});

// ── themeTokens ──────────────────────────────────────────────────────────────

describe("resolveThemeTokens", () => {
  it("returns default (dark) tokens when no argument is passed", () => {
    const tokens = resolveThemeTokens();
    expect(tokens.primary).toBe("#7C3AED");
    expect(tokens.background).toBe("#0A0A0F");
    expect(tokens.surface).toBe("#111118");
    expect(tokens.chartPalette).toHaveLength(6);
    expect(tokens.chartPalette[0]).toBe("#7C3AED");
  });

  it("returns default tokens for undefined", () => {
    const tokens = resolveThemeTokens(undefined);
    expect(tokens.primary).toBe("#7C3AED");
  });

  it("returns default tokens for empty string", () => {
    const tokens = resolveThemeTokens("");
    expect(tokens.primary).toBe("#7C3AED");
  });

  it("resolves 'midnight' preset", () => {
    const tokens = resolveThemeTokens("midnight");
    expect(tokens.primary).toBe("#38bdf8");
    expect(tokens.background).toBe("#0a0e1a");
    expect(tokens.surface).toBe("#111827"); // card field
    expect(tokens.text).toBe("#e2e8f0"); // foreground field
    expect(tokens.muted).toBe("#94a3b8"); // muted-foreground field
    expect(tokens.border).toBe("#1e3a5f");
    expect(tokens.error).toBe("#ef4444"); // destructive field
    expect(tokens.chartPalette).toHaveLength(5);
    expect(tokens.chartPalette[0]).toBe("#38bdf8");
  });

  it("resolves preset names case-insensitively", () => {
    const upper = resolveThemeTokens("MIDNIGHT");
    const lower = resolveThemeTokens("midnight");
    expect(upper.primary).toBe(lower.primary);
    expect(upper.background).toBe(lower.background);
  });

  it("resolves preset names with whitespace trimmed", () => {
    const tokens = resolveThemeTokens("  midnight  ");
    expect(tokens.primary).toBe("#38bdf8");
  });

  it("returns light theme tokens for 'light'", () => {
    const tokens = resolveThemeTokens("light");
    expect(tokens.primary).toBe("#2563EB");
    expect(tokens.background).toBe("#FAFAFA");
    expect(tokens.surface).toBe("#FFFFFF");
    expect(tokens.text).toBe("#111827");
    expect(tokens.muted).toBe("#6B7280");
    expect(tokens.border).toBe("rgba(0,0,0,0.06)");
    expect(tokens.chartPalette).toHaveLength(6);
  });

  it("returns light theme for strings containing 'light'", () => {
    const tokens = resolveThemeTokens("my-light-theme");
    expect(tokens.primary).toBe("#2563EB");
    expect(tokens.background).toBe("#FAFAFA");
  });

  it("returns default tokens for unknown preset", () => {
    const tokens = resolveThemeTokens("unknown");
    expect(tokens.primary).toBe("#7C3AED");
    expect(tokens.background).toBe("#0A0A0F");
  });

  it("resolves 'forest' preset", () => {
    const tokens = resolveThemeTokens("forest");
    expect(tokens.primary).toBe("#4ade80");
    expect(tokens.background).toBe("#0c1a0e");
  });

  it("resolves 'cyberpunk' preset", () => {
    const tokens = resolveThemeTokens("cyberpunk");
    expect(tokens.primary).toBe("#f0abfc");
    expect(tokens.background).toBe("#0d0015");
  });

  it("all returned tokens have the full DashboardThemeTokens shape", () => {
    const requiredKeys: (keyof DashboardThemeTokens)[] = [
      "primary", "accent", "background", "surface", "text",
      "muted", "border", "success", "warning", "error", "chartPalette",
    ];
    for (const theme of [undefined, "midnight", "light", "unknown"]) {
      const tokens = resolveThemeTokens(theme);
      for (const key of requiredKeys) {
        expect(tokens).toHaveProperty(key);
      }
      expect(Array.isArray(tokens.chartPalette)).toBe(true);
      expect(tokens.chartPalette.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("tokensToCss", () => {
  it("produces valid CSS with all custom properties", () => {
    const tokens = resolveThemeTokens();
    const css = tokensToCss(tokens);

    expect(css).toContain(":root {");
    expect(css).toContain("--dash-primary:");
    expect(css).toContain("--dash-accent:");
    expect(css).toContain("--dash-bg:");
    expect(css).toContain("--dash-surface:");
    expect(css).toContain("--dash-text:");
    expect(css).toContain("--dash-muted:");
    expect(css).toContain("--dash-border:");
    expect(css).toContain("--dash-success:");
    expect(css).toContain("--dash-warning:");
    expect(css).toContain("--dash-error:");
    expect(css).toContain("--dash-chart-1:");
    expect(css).toContain("--dash-chart-2:");
    expect(css).toContain("--dash-chart-3:");
    expect(css).toContain("--dash-chart-4:");
    expect(css).toContain("--dash-chart-5:");
    expect(css).toContain("}");
  });

  it("uses actual token values in the CSS output", () => {
    const tokens = resolveThemeTokens();
    const css = tokensToCss(tokens);

    expect(css).toContain(`--dash-primary: ${tokens.primary}`);
    expect(css).toContain(`--dash-accent: ${tokens.accent}`);
    expect(css).toContain(`--dash-bg: ${tokens.background}`);
    expect(css).toContain(`--dash-surface: ${tokens.surface}`);
    expect(css).toContain(`--dash-chart-1: ${tokens.chartPalette[0]}`);
  });

  it("works correctly with light theme tokens", () => {
    const tokens = resolveThemeTokens("light");
    const css = tokensToCss(tokens);

    expect(css).toContain(`--dash-primary: #2563EB`);
    expect(css).toContain(`--dash-bg: #FAFAFA`);
    expect(css).toContain(`--dash-text: #111827`);
  });

  it("works correctly with preset theme tokens", () => {
    const tokens = resolveThemeTokens("midnight");
    const css = tokensToCss(tokens);

    expect(css).toContain(`--dash-primary: #38bdf8`);
    expect(css).toContain(`--dash-bg: #0a0e1a`);
  });

  it("output starts with :root and ends with closing brace", () => {
    const tokens = resolveThemeTokens();
    const css = tokensToCss(tokens);

    expect(css.trimStart().startsWith(":root {")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });
});
