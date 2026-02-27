import { describe, it, expect } from "vitest";
import {
  validateComponentName,
  validateComponentDefinition,
  resolveCustomComponent,
  isBuiltinComponent,
  BUILTIN_COMPONENTS,
  type ComponentDefinition,
} from "./componentResolver.js";

// ── validateComponentName ────────────────────────────────────────────────────

describe("validateComponentName", () => {
  it("accepts valid lowercase names", () => {
    expect(validateComponentName("kpi_row")).toBeNull();
    expect(validateComponentName("my_component")).toBeNull();
    expect(validateComponentName("a")).toBeNull();
    expect(validateComponentName("widget2")).toBeNull();
  });

  it("rejects uppercase letters", () => {
    expect(validateComponentName("KpiRow")).not.toBeNull();
  });

  it("rejects hyphens", () => {
    expect(validateComponentName("my-component")).not.toBeNull();
  });

  it("rejects names starting with number", () => {
    expect(validateComponentName("2bad")).not.toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateComponentName("")).not.toBeNull();
  });

  it("rejects built-in component names", () => {
    for (const name of ["card", "chart", "layout", "sandbox", "data_table"]) {
      expect(validateComponentName(name)).toContain("built-in");
    }
  });

  it("accepts names up to 64 chars", () => {
    const longName = "a" + "_b".repeat(31); // 63 chars
    expect(validateComponentName(longName)).toBeNull();
  });

  it("rejects names over 64 chars", () => {
    const tooLong = "a" + "b".repeat(64); // 65 chars
    expect(validateComponentName(tooLong)).not.toBeNull();
  });
});

// ── validateComponentDefinition ──────────────────────────────────────────────

describe("validateComponentDefinition", () => {
  const validDef = {
    name: "test_comp",
    layout: [{ component: "card", props: { title: "{{title}}" } }],
  };

  it("accepts a valid definition", () => {
    expect(validateComponentDefinition(validDef)).toBeNull();
  });

  it("accepts definition with description", () => {
    expect(validateComponentDefinition({ ...validDef, description: "A test" })).toBeNull();
  });

  it("rejects non-object", () => {
    expect(validateComponentDefinition("string")).not.toBeNull();
    expect(validateComponentDefinition(null)).not.toBeNull();
    expect(validateComponentDefinition(42)).not.toBeNull();
  });

  it("rejects missing name", () => {
    expect(validateComponentDefinition({ layout: [{ component: "card", props: {} }] })).not.toBeNull();
  });

  it("rejects invalid name", () => {
    expect(validateComponentDefinition({ name: "LOUD", layout: [{ component: "card", props: {} }] })).not.toBeNull();
  });

  it("rejects built-in name", () => {
    expect(validateComponentDefinition({ name: "chart", layout: [{ component: "card", props: {} }] })).toContain("built-in");
  });

  it("rejects missing layout", () => {
    expect(validateComponentDefinition({ name: "foo" })).not.toBeNull();
  });

  it("rejects empty layout", () => {
    expect(validateComponentDefinition({ name: "foo", layout: [] })).toContain("at least one");
  });

  it("rejects layout over 20 children", () => {
    const layout = Array.from({ length: 21 }, () => ({ component: "card", props: {} }));
    expect(validateComponentDefinition({ name: "foo", layout })).toContain("max is 20");
  });

  it("rejects child with non-builtin component", () => {
    const def = { name: "foo", layout: [{ component: "nonexistent_thing", props: {} }] };
    expect(validateComponentDefinition(def)).toContain("unknown built-in");
  });

  it("rejects child missing props", () => {
    const def = { name: "foo", layout: [{ component: "card" }] };
    expect(validateComponentDefinition(def)).toContain("props");
  });

  it("rejects child with null props", () => {
    const def = { name: "foo", layout: [{ component: "card", props: null }] };
    expect(validateComponentDefinition(def)).toContain("props");
  });
});

// ── resolveCustomComponent ───────────────────────────────────────────────────

describe("resolveCustomComponent", () => {
  it("substitutes string placeholders", () => {
    const def: ComponentDefinition = {
      name: "simple",
      layout: [
        { component: "card", props: { title: "{{title}}", body: "{{body}}" } },
      ],
    };
    const result = resolveCustomComponent(def, { title: "Hello", body: "World" });
    expect(result).toHaveLength(1);
    expect(result[0].component).toBe("card");
    expect(result[0].props.title).toBe("Hello");
    expect(result[0].props.body).toBe("World");
  });

  it("preserves raw type when entire value is a single placeholder", () => {
    const def: ComponentDefinition = {
      name: "typed",
      layout: [
        { component: "chart", props: { data: "{{chartData}}", stacked: "{{isStacked}}" } },
      ],
    };
    const data = [{ x: 1, y: 2 }];
    const result = resolveCustomComponent(def, { chartData: data, isStacked: true });
    expect(result[0].props.data).toEqual(data);
    expect(result[0].props.stacked).toBe(true);
  });

  it("does string interpolation for mixed text + placeholders", () => {
    const def: ComponentDefinition = {
      name: "mixed",
      layout: [
        { component: "card", props: { title: "Sales: {{region}} - {{year}}" } },
      ],
    };
    const result = resolveCustomComponent(def, { region: "US", year: "2026" });
    expect(result[0].props.title).toBe("Sales: US - 2026");
  });

  it("leaves unmatched placeholders as-is", () => {
    const def: ComponentDefinition = {
      name: "partial",
      layout: [
        { component: "card", props: { title: "{{provided}}", subtitle: "{{missing}}" } },
      ],
    };
    const result = resolveCustomComponent(def, { provided: "yes" });
    expect(result[0].props.title).toBe("yes");
    expect(result[0].props.subtitle).toBe("{{missing}}");
  });

  it("handles nested objects", () => {
    const def: ComponentDefinition = {
      name: "nested",
      layout: [
        {
          component: "chart",
          props: {
            config: { title: "{{title}}", axis: { label: "{{xlabel}}" } },
          },
        },
      ],
    };
    const result = resolveCustomComponent(def, { title: "Revenue", xlabel: "Month" });
    const config = result[0].props.config as Record<string, unknown>;
    expect(config.title).toBe("Revenue");
    expect((config.axis as Record<string, unknown>).label).toBe("Month");
  });

  it("handles arrays in props", () => {
    const def: ComponentDefinition = {
      name: "with_array",
      layout: [
        {
          component: "list",
          props: {
            items: ["{{item1}}", "{{item2}}"],
          },
        },
      ],
    };
    const result = resolveCustomComponent(def, { item1: "First", item2: "Second" });
    expect(result[0].props.items).toEqual(["First", "Second"]);
  });

  it("resolves multiple layout children", () => {
    const def: ComponentDefinition = {
      name: "multi",
      layout: [
        { component: "metric_card", props: { label: "{{l1}}", value: "{{v1}}" } },
        { component: "metric_card", props: { label: "{{l2}}", value: "{{v2}}" } },
        { component: "metric_card", props: { label: "{{l3}}", value: "{{v3}}" } },
      ],
    };
    const result = resolveCustomComponent(def, {
      l1: "Revenue", v1: "$5M",
      l2: "Users", v2: "10K",
      l3: "Growth", v3: "+12%",
    });
    expect(result).toHaveLength(3);
    expect(result[0].props.label).toBe("Revenue");
    expect(result[1].props.label).toBe("Users");
    expect(result[2].props.label).toBe("Growth");
  });

  it("passes through non-placeholder values unchanged", () => {
    const def: ComponentDefinition = {
      name: "static",
      layout: [
        { component: "chart", props: { type: "bar", stacked: true, colors: ["#f00", "#0f0"] } },
      ],
    };
    const result = resolveCustomComponent(def, {});
    expect(result[0].props.type).toBe("bar");
    expect(result[0].props.stacked).toBe(true);
    expect(result[0].props.colors).toEqual(["#f00", "#0f0"]);
  });

  it("JSON-stringifies non-string values in mixed interpolation", () => {
    const def: ComponentDefinition = {
      name: "mixed_types",
      layout: [
        { component: "card", props: { body: "Count: {{count}} items" } },
      ],
    };
    const result = resolveCustomComponent(def, { count: 42 });
    expect(result[0].props.body).toBe("Count: 42 items");
  });
});

// ── isBuiltinComponent ───────────────────────────────────────────────────────

describe("isBuiltinComponent", () => {
  it("returns true for known built-ins", () => {
    expect(isBuiltinComponent("card")).toBe(true);
    expect(isBuiltinComponent("chart")).toBe(true);
    expect(isBuiltinComponent("sandbox")).toBe(true);
    expect(isBuiltinComponent("layout")).toBe(true);
  });

  it("returns false for custom component names", () => {
    expect(isBuiltinComponent("kpi_row")).toBe(false);
    expect(isBuiltinComponent("my_widget")).toBe(false);
  });

  it("BUILTIN_COMPONENTS set has expected components", () => {
    expect(BUILTIN_COMPONENTS.size).toBeGreaterThan(20);
    expect(BUILTIN_COMPONENTS.has("data_table")).toBe(true);
    expect(BUILTIN_COMPONENTS.has("metric_card")).toBe(true);
    expect(BUILTIN_COMPONENTS.has("video")).toBe(true);
  });
});
