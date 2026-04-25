/**
 * Unit tests for `lib/component-catalog.ts`.
 *
 * The two exported helpers are the client-side resolver for custom
 * components — user-defined component templates compose built-in
 * primitives with `{{variable}}` placeholders, and the resolver
 * substitutes the bot's MCP-provided props into those placeholders
 * at render time.
 *
 * Three contracts worth pinning:
 *
 *   1. **Single-placeholder strings preserve type** — `"{{items}}"`
 *      where `items` is an array of objects must return the array
 *      AS-IS, not the JSON-stringified form. This is the entire
 *      point of the resolver — a chart's `data` prop only works if
 *      it stays an array, not a string.
 *
 *   2. **Mixed-text placeholders interpolate as strings** — but
 *      non-string values get JSON-stringified into the output, so
 *      `"label: {{count}}"` with `count: 42` renders `"label: 42"`
 *      (not `"label: undefined"` or a runtime crash).
 *
 *   3. **Missing variables stay as their literal `{{key}}`** —
 *      this is by design: the user can preview a template with
 *      partial inputs without the resolver crashing or silently
 *      stripping the variable.
 *
 * `extractTemplateVars` is the partner: it finds all unique
 * `{{varName}}` references in a layout so the registration code can
 * generate a Zod schema. A regression there would either reject
 * valid templates or accept templates with undeclared vars.
 */

import { describe, it, expect } from "vitest";
import {
  resolveCustomComponent,
  extractTemplateVars,
  type ComponentDefinition,
} from "../component-catalog";

// ── resolveCustomComponent ──────────────────────────────────────────────────

describe("resolveCustomComponent", () => {
  it("returns one resolved block per layout child", () => {
    const def: ComponentDefinition = {
      name: "MyTemplate",
      layout: [
        { component: "text", props: { content: "hi" } },
        { component: "button", props: { label: "ok" } },
      ],
    };
    const out = resolveCustomComponent(def, {});
    expect(out).toHaveLength(2);
    expect(out[0].component).toBe("text");
    expect(out[1].component).toBe("button");
  });

  it("substitutes a {{var}} into a string prop", () => {
    const def: ComponentDefinition = {
      name: "Hello",
      layout: [{ component: "text", props: { content: "Hello {{name}}!" } }],
    };
    const out = resolveCustomComponent(def, { name: "Alice" });
    expect(out[0].props.content).toBe("Hello Alice!");
  });

  it("preserves the raw value when the prop IS exactly a single {{var}} (arrays survive)", () => {
    // The chart-data critical path: if `data` becomes a string here,
    // every chart in the platform breaks.
    const items = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const def: ComponentDefinition = {
      name: "Chart",
      layout: [{ component: "line_chart", props: { data: "{{items}}" } }],
    };
    const out = resolveCustomComponent(def, { items });
    expect(Array.isArray(out[0].props.data)).toBe(true);
    expect(out[0].props.data).toEqual(items);
    // Same reference — no clone.
    expect(out[0].props.data).toBe(items);
  });

  it("preserves number / boolean / null types when the prop is a single {{var}}", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "x",
          props: {
            count: "{{n}}",
            enabled: "{{b}}",
            empty: "{{nullable}}",
          },
        },
      ],
    };
    const out = resolveCustomComponent(def, { n: 42, b: true, nullable: null });
    expect(out[0].props.count).toBe(42);
    expect(out[0].props.enabled).toBe(true);
    expect(out[0].props.empty).toBeNull();
  });

  it("trims whitespace before single-placeholder match (so '  {{x}}  ' still preserves type)", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [{ component: "x", props: { v: "  {{items}}  " } }],
    };
    const items = [1, 2, 3];
    const out = resolveCustomComponent(def, { items });
    expect(out[0].props.v).toEqual(items);
  });

  it("interpolates non-string values via JSON.stringify in mixed-text props", () => {
    // "Count: {{count}}" with count=42 renders "Count: 42".
    // "Tags: {{tags}}" with tags=["a", "b"] renders 'Tags: ["a","b"]'.
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "text",
          props: {
            label: "Count: {{count}}",
            tags: "Tags: {{tags}}",
            both: "{{a}} and {{b}}",
          },
        },
      ],
    };
    const out = resolveCustomComponent(def, {
      count: 42,
      tags: ["a", "b"],
      a: 1,
      b: { nested: true },
    });
    expect(out[0].props.label).toBe("Count: 42");
    expect(out[0].props.tags).toBe('Tags: ["a","b"]');
    expect(out[0].props.both).toBe('1 and {"nested":true}');
  });

  it("leaves unknown {{vars}} as literal placeholders (no crash, no silent strip)", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "text",
          props: {
            single: "{{undefinedVar}}",
            mixed: "Hello {{undefinedVar}}!",
          },
        },
      ],
    };
    const out = resolveCustomComponent(def, { name: "alice" });
    expect(out[0].props.single).toBe("{{undefinedVar}}");
    expect(out[0].props.mixed).toBe("Hello {{undefinedVar}}!");
  });

  it("recurses into nested objects (one level)", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "card",
          props: {
            header: { title: "{{title}}" },
            body: "Hello {{name}}",
          },
        },
      ],
    };
    const out = resolveCustomComponent(def, { title: "Top", name: "Alice" });
    expect(out[0].props.header).toEqual({ title: "Top" });
    expect(out[0].props.body).toBe("Hello Alice");
  });

  it("recurses into nested arrays", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "list",
          props: { items: ["a {{x}}", "b {{x}}"] },
        },
      ],
    };
    const out = resolveCustomComponent(def, { x: "1" });
    expect(out[0].props.items).toEqual(["a 1", "b 1"]);
  });

  it("respects MAX_DEPTH = 3 — values past the depth limit are returned as-is", () => {
    // Build a 5-deep object: the {{x}} at depth 4 is at MAX_DEPTH+1
    // and should NOT be substituted.
    //
    // Layout child = depth 0
    //   props (level 0 in substitute)
    //     a (level 1)
    //       b (level 2)
    //         c (level 3) — MAX_DEPTH boundary
    //           d (level 4) — past limit, returned untouched
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "x",
          props: {
            a: { b: { c: { d: "{{x}}" } } },
          },
        },
      ],
    };
    const out = resolveCustomComponent(def, { x: "VAL" });
    // Depth 1, 2, 3 are within MAX_DEPTH and should still recurse.
    // Depth 4 (the d-level string) is past the limit and stays literal.
    const a = (out[0].props.a as any);
    expect(a.b.c.d).toBe("{{x}}");
  });

  it("returns an empty array when layout is empty", () => {
    const def: ComponentDefinition = { name: "Empty", layout: [] };
    expect(resolveCustomComponent(def, {})).toEqual([]);
  });
});

// ── extractTemplateVars ─────────────────────────────────────────────────────

describe("extractTemplateVars", () => {
  it("returns an empty array for a layout with no placeholders", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [{ component: "text", props: { content: "static" } }],
    };
    expect(extractTemplateVars(def)).toEqual([]);
  });

  it("collects every {{var}} reference across all layout children", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        { component: "text", props: { content: "Hello {{name}}" } },
        { component: "card", props: { title: "{{title}}", subtitle: "{{subtitle}}" } },
      ],
    };
    const vars = extractTemplateVars(def).sort();
    expect(vars).toEqual(["name", "subtitle", "title"]);
  });

  it("dedupes a variable that appears multiple times", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        { component: "text", props: { content: "{{name}} and {{name}} again" } },
        { component: "text", props: { content: "More {{name}}" } },
      ],
    };
    expect(extractTemplateVars(def)).toEqual(["name"]);
  });

  it("recurses into nested objects and arrays", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "card",
          props: {
            header: { title: "{{title}}", icon: { src: "{{iconUrl}}" } },
            items: ["{{item1}}", { label: "{{item2}}" }],
          },
        },
      ],
    };
    const vars = extractTemplateVars(def).sort();
    expect(vars).toEqual(["icon", "iconUrl", "item1", "item2", "title"]
      .filter((v) => v !== "icon")); // 'icon' is a key, not a value
  });

  it("respects MAX_DEPTH = 3 — placeholders past the depth limit are NOT collected", () => {
    // Same nested-object as the resolveCustomComponent test — the
    // d-level {{x}} sits past MAX_DEPTH and must NOT be reported.
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        {
          component: "x",
          props: {
            a: { b: { c: { d: "{{x}}" } } },
            shallow: "{{y}}",
          },
        },
      ],
    };
    const vars = extractTemplateVars(def);
    expect(vars).toContain("y");
    expect(vars).not.toContain("x");
  });

  it("multiple placeholders in the same string each get extracted once", () => {
    const def: ComponentDefinition = {
      name: "T",
      layout: [
        { component: "x", props: { v: "{{a}} between {{b}} and {{c}}" } },
      ],
    };
    expect(extractTemplateVars(def).sort()).toEqual(["a", "b", "c"]);
  });
});
