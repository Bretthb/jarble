/**
 * Component Resolver tests.
 *
 * Tests template substitution, component name validation,
 * definition validation, expansion limits, and size guards.
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateComponentName,
  validateComponentDefinition,
  resolveCustomComponent,
  isBuiltinComponent,
  BUILTIN_COMPONENTS,
  type ComponentDefinition,
} from "../componentResolver.js";

// Suppress logger output during tests
vi.mock("../logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── validateComponentName ────────────────────────────────────────────────────

describe("validateComponentName", () => {
  it("accepts a valid custom name", () => {
    expect(validateComponentName("my_widget")).toBeNull();
  });

  it("accepts a single letter name", () => {
    expect(validateComponentName("a")).toBeNull();
  });

  it("accepts a name with digits", () => {
    expect(validateComponentName("widget2")).toBeNull();
  });

  it("accepts max-length name (64 chars)", () => {
    const name = "a" + "b".repeat(63);
    expect(validateComponentName(name)).toBeNull();
  });

  it("rejects name starting with digit", () => {
    expect(validateComponentName("1widget")).not.toBeNull();
  });

  it("rejects name starting with underscore", () => {
    expect(validateComponentName("_widget")).not.toBeNull();
  });

  it("rejects name with hyphens", () => {
    expect(validateComponentName("my-widget")).not.toBeNull();
  });

  it("rejects name with uppercase", () => {
    expect(validateComponentName("MyWidget")).not.toBeNull();
  });

  it("rejects name with spaces", () => {
    expect(validateComponentName("my widget")).not.toBeNull();
  });

  it("rejects empty name", () => {
    expect(validateComponentName("")).not.toBeNull();
  });

  it("rejects name longer than 64 chars", () => {
    const name = "a" + "b".repeat(64); // 65 chars total
    expect(validateComponentName(name)).not.toBeNull();
  });

  it("rejects name with special characters", () => {
    expect(validateComponentName("wid$get")).not.toBeNull();
    expect(validateComponentName("widget!")).not.toBeNull();
    expect(validateComponentName("widget.name")).not.toBeNull();
  });

  it("rejects built-in component names", () => {
    // "card" is definitely a built-in
    expect(validateComponentName("card")).toContain("built-in");
    expect(validateComponentName("chart")).toContain("built-in");
    expect(validateComponentName("data_table")).toContain("built-in");
  });
});

// ── isBuiltinComponent ──────────────────────────────────────────────────────

describe("isBuiltinComponent", () => {
  it("returns true for known built-in names", () => {
    expect(isBuiltinComponent("card")).toBe(true);
    expect(isBuiltinComponent("chart")).toBe(true);
    expect(isBuiltinComponent("data_table")).toBe(true);
  });

  it("returns false for custom names", () => {
    expect(isBuiltinComponent("my_custom_widget")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBuiltinComponent("")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isBuiltinComponent("Card")).toBe(false);
    expect(isBuiltinComponent("CHART")).toBe(false);
  });

  it("BUILTIN_COMPONENTS set has known components", () => {
    expect(BUILTIN_COMPONENTS.has("card")).toBe(true);
    expect(BUILTIN_COMPONENTS.has("sandbox")).toBe(true);
  });
});

// ── validateComponentDefinition ─────────────────────────────────────────────

describe("validateComponentDefinition", () => {
  function validDef(overrides?: Partial<ComponentDefinition>) {
    return {
      name: "my_widget",
      layout: [
        { component: "card", props: { title: "{{title}}" } },
      ],
      ...overrides,
    };
  }

  it("accepts a valid definition", () => {
    expect(validateComponentDefinition(validDef())).toBeNull();
  });

  it("rejects null", () => {
    expect(validateComponentDefinition(null)).not.toBeNull();
  });

  it("rejects undefined", () => {
    expect(validateComponentDefinition(undefined)).not.toBeNull();
  });

  it("rejects a string", () => {
    expect(validateComponentDefinition("not an object")).not.toBeNull();
  });

  it("rejects a number", () => {
    expect(validateComponentDefinition(42)).not.toBeNull();
  });

  it("rejects missing name", () => {
    expect(validateComponentDefinition({ layout: [{ component: "card", props: {} }] })).not.toBeNull();
  });

  it("rejects non-string name", () => {
    expect(validateComponentDefinition({ name: 42, layout: [{ component: "card", props: {} }] })).not.toBeNull();
  });

  it("rejects invalid component name (propagates validateComponentName)", () => {
    expect(validateComponentDefinition(validDef({ name: "1bad" }))).not.toBeNull();
  });

  it("rejects built-in name", () => {
    expect(validateComponentDefinition(validDef({ name: "card" }))).toContain("built-in");
  });

  it("rejects missing layout", () => {
    expect(validateComponentDefinition({ name: "my_widget" })).not.toBeNull();
  });

  it("rejects non-array layout", () => {
    expect(validateComponentDefinition({ name: "my_widget", layout: "not array" })).not.toBeNull();
  });

  it("rejects empty layout array", () => {
    expect(validateComponentDefinition(validDef({ layout: [] }))).toContain("at least one");
  });

  it("rejects layout exceeding MAX_CHILDREN (20)", () => {
    const layout = Array.from({ length: 21 }, () => ({
      component: "card",
      props: { title: "test" },
    }));
    expect(validateComponentDefinition(validDef({ layout }))).toContain("max is 20");
  });

  it("accepts layout at exactly MAX_CHILDREN (20)", () => {
    const layout = Array.from({ length: 20 }, () => ({
      component: "card",
      props: { title: "test" },
    }));
    expect(validateComponentDefinition(validDef({ layout }))).toBeNull();
  });

  it("rejects non-object layout child", () => {
    expect(validateComponentDefinition(validDef({
      layout: ["not an object"] as any,
    }))).toContain("child 0");
  });

  it("rejects null layout child", () => {
    expect(validateComponentDefinition(validDef({
      layout: [null] as any,
    }))).toContain("child 0");
  });

  it("rejects layout child without component", () => {
    expect(validateComponentDefinition(validDef({
      layout: [{ props: {} }] as any,
    }))).toContain("string 'component'");
  });

  it("rejects layout child with numeric component", () => {
    expect(validateComponentDefinition(validDef({
      layout: [{ component: 42, props: {} }] as any,
    }))).toContain("string 'component'");
  });

  it("rejects layout child referencing unknown built-in", () => {
    expect(validateComponentDefinition(validDef({
      layout: [{ component: "nonexistent_component", props: {} }],
    }))).toContain("unknown built-in");
  });

  it("rejects layout child without props", () => {
    expect(validateComponentDefinition(validDef({
      layout: [{ component: "card" }] as any,
    }))).toContain("object 'props'");
  });

  it("rejects layout child with null props", () => {
    expect(validateComponentDefinition(validDef({
      layout: [{ component: "card", props: null }] as any,
    }))).toContain("object 'props'");
  });

  it("rejects definition exceeding size limit (50KB)", () => {
    const bigProps = { data: "x".repeat(60 * 1024) };
    expect(validateComponentDefinition(validDef({
      layout: [{ component: "card", props: bigProps }],
    }))).toContain("bytes");
  });

  it("accepts definition near but under size limit", () => {
    // 50KB = 51200 bytes. A small definition should be fine.
    expect(validateComponentDefinition(validDef())).toBeNull();
  });
});

// ── resolveCustomComponent ──────────────────────────────────────────────────

describe("resolveCustomComponent", () => {
  // ── Basic substitution ──────────────────────────────────────────────────

  describe("template substitution", () => {
    it("substitutes a single placeholder with the raw value", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { title: "{{title}}" } }],
      };
      const result = resolveCustomComponent(def, { title: "Hello" });
      expect(result).toHaveLength(1);
      expect(result[0].props.title).toBe("Hello");
    });

    it("preserves non-string types for single placeholder substitution", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { count: "{{count}}" } }],
      };
      const result = resolveCustomComponent(def, { count: 42 });
      expect(result[0].props.count).toBe(42);
    });

    it("preserves arrays for single placeholder substitution", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { items: "{{items}}" } }],
      };
      const result = resolveCustomComponent(def, { items: [1, 2, 3] });
      expect(result[0].props.items).toEqual([1, 2, 3]);
    });

    it("preserves objects for single placeholder substitution", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { config: "{{config}}" } }],
      };
      const result = resolveCustomComponent(def, { config: { key: "val" } });
      expect(result[0].props.config).toEqual({ key: "val" });
    });

    it("does mixed string interpolation for multiple placeholders", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { label: "Hello {{name}}, you are {{age}} years old" } }],
      };
      const result = resolveCustomComponent(def, { name: "Alice", age: 30 });
      expect(result[0].props.label).toBe("Hello Alice, you are 30 years old");
    });

    it("JSON-stringifies non-string values in mixed interpolation", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { label: "Items: {{items}}" } }],
      };
      const result = resolveCustomComponent(def, { items: [1, 2] });
      expect(result[0].props.label).toBe("Items: [1,2]");
    });

    it("leaves unmatched placeholders as-is", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { title: "{{missing}}" } }],
      };
      const result = resolveCustomComponent(def, {});
      expect(result[0].props.title).toBe("{{missing}}");
    });

    it("leaves unmatched placeholders in mixed strings", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { label: "Hello {{name}} and {{missing}}" } }],
      };
      const result = resolveCustomComponent(def, { name: "Alice" });
      expect(result[0].props.label).toBe("Hello Alice and {{missing}}");
    });
  });

  // ── Nested substitution ─────────────────────────────────────────────────

  describe("nested object/array substitution", () => {
    it("substitutes within nested objects", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{
          component: "card",
          props: { config: { title: "{{title}}", nested: { value: "{{value}}" } } },
        }],
      };
      const result = resolveCustomComponent(def, { title: "Hi", value: "world" });
      expect(result[0].props.config).toEqual({
        title: "Hi",
        nested: { value: "world" },
      });
    });

    it("substitutes within arrays", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{
          component: "card",
          props: { items: ["{{first}}", "static", "{{second}}"] },
        }],
      };
      const result = resolveCustomComponent(def, { first: "A", second: "B" });
      expect(result[0].props.items).toEqual(["A", "static", "B"]);
    });

    it("stops recursion at MAX_DEPTH (3)", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{
          component: "card",
          props: {
            l1: { l2: { l3: { l4: "{{deep}}" } } },
          },
        }],
      };
      const result = resolveCustomComponent(def, { deep: "found" });
      // Depth: props=0, l1=1, l2=2, l3=3, l4=4 (beyond MAX_DEPTH=3)
      // At depth > 3, substitution stops
      expect(result[0].props.l1).toEqual({ l2: { l3: { l4: "{{deep}}" } } });
    });

    it("passes through non-string/non-object/non-array values unchanged", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{
          component: "card",
          props: { num: 42, bool: true, nil: null },
        }],
      };
      const result = resolveCustomComponent(def, {});
      expect(result[0].props.num).toBe(42);
      expect(result[0].props.bool).toBe(true);
      expect(result[0].props.nil).toBeNull();
    });
  });

  // ── Multiple children ─────────────────────────────────────────────────────

  describe("multiple layout children", () => {
    it("resolves all children", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [
          { component: "card", props: { title: "{{title}}" } },
          { component: "alert", props: { message: "{{msg}}" } },
        ],
      };
      const result = resolveCustomComponent(def, { title: "Hi", msg: "Alert!" });
      expect(result).toHaveLength(2);
      expect(result[0].component).toBe("card");
      expect(result[0].props.title).toBe("Hi");
      expect(result[1].component).toBe("alert");
      expect(result[1].props.message).toBe("Alert!");
    });
  });

  // ── Expansion limit (MAX_EXPANDED = 50) ────────────────────────────────────

  describe("expansion limits", () => {
    it("truncates to 50 children if layout exceeds limit", () => {
      const layout = Array.from({ length: 60 }, (_, i) => ({
        component: "card",
        props: { idx: i },
      }));
      const def: ComponentDefinition = { name: "my_widget", layout };
      const result = resolveCustomComponent(def, {});
      expect(result).toHaveLength(50);
    });

    it("allows exactly 50 children without truncation", () => {
      const layout = Array.from({ length: 50 }, (_, i) => ({
        component: "card",
        props: { idx: i },
      }));
      const def: ComponentDefinition = { name: "my_widget", layout };
      const result = resolveCustomComponent(def, {});
      expect(result).toHaveLength(50);
    });
  });

  // ── Size limit (MAX_RESOLVED_PROPS_SIZE = 256KB) ──────────────────────────

  describe("resolved props size limit", () => {
    it("returns empty array when resolved props exceed 256KB", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { data: "{{data}}" } }],
      };
      const bigData = "x".repeat(300 * 1024); // 300KB
      const result = resolveCustomComponent(def, { data: bigData });
      expect(result).toEqual([]);
    });

    it("allows resolved props under 256KB", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { data: "{{data}}" } }],
      };
      const okData = "x".repeat(100 * 1024); // 100KB
      const result = resolveCustomComponent(def, { data: okData });
      expect(result).toHaveLength(1);
    });

    it("returns empty array for circular references (non-serializable)", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [{ component: "card", props: { data: "{{data}}" } }],
      };
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const result = resolveCustomComponent(def, { data: circular });
      // JSON.stringify will throw, so it should return []
      expect(result).toEqual([]);
    });
  });

  // ── Component name preserved ──────────────────────────────────────────────

  describe("component name in output", () => {
    it("preserves the component name from layout", () => {
      const def: ComponentDefinition = {
        name: "my_widget",
        layout: [
          { component: "chart", props: { type: "bar" } },
          { component: "data_table", props: { columns: [] } },
        ],
      };
      const result = resolveCustomComponent(def, {});
      expect(result[0].component).toBe("chart");
      expect(result[1].component).toBe("data_table");
    });
  });
});
