/**
 * Integration tests - validate real component props against generated JSON schemas.
 *
 * Uses the same JSON Schema validator from jarble-ui-server.js and the
 * generated component-data.json schemas.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createContext, Script } from "vm";

// ── Load validator + schemas ────────────────────────────────────────────

let validateJsonSchema: (value: unknown, schema: unknown, path: string) => { valid: boolean; errors: string[] };
let schemas: Record<string, unknown>;

beforeAll(() => {
  // Extract validator from jarble-ui-server.js
  const serverPath = resolve(__dirname, "../jarble-ui-server.js");
  const source = readFileSync(serverPath, "utf-8");
  const startMarker = "// ── JSON Schema Validator (zero dependencies)";
  const endMarker = "// ── Component resolver";
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);
  const validatorCode = source.slice(startIdx, endIdx);

  const sandbox = { validateJsonSchema: null as unknown, MAX_VALIDATION_ERRORS: 10 };
  const ctx = createContext(sandbox);
  const script = new Script(validatorCode + "\n; validateJsonSchema;");
  sandbox.validateJsonSchema = script.runInContext(ctx);
  validateJsonSchema = sandbox.validateJsonSchema as typeof validateJsonSchema;

  // Load generated schemas
  const dataPath = resolve(__dirname, "../../../../shared/component-manifest/generated/component-data.json");
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  schemas = data.schemas;
});

// ── Valid props ─────────────────────────────────────────────────────────

describe("valid component props pass validation", () => {
  it("chart - bar chart with valid props", () => {
    const props = {
      type: "bar",
      data: [{ name: "Jan", sales: 100 }, { name: "Feb", sales: 200 }],
      dataKeys: ["sales"],
      xAxisKey: "name",
      title: "Monthly Sales",
    };
    const result = validateJsonSchema(props, schemas.chart, "props");
    expect(result.valid).toBe(true);
  });

  it("card - simple card", () => {
    const props = { title: "Hello", body: "World" };
    const result = validateJsonSchema(props, schemas.card, "props");
    expect(result.valid).toBe(true);
  });

  it("card - empty card (all fields optional)", () => {
    const result = validateJsonSchema({}, schemas.card, "props");
    expect(result.valid).toBe(true);
  });

  it("data_table - table with rows", () => {
    const props = {
      columns: ["Name", "Age"],
      rows: [["Alice", 30], ["Bob", 25]],
    };
    const result = validateJsonSchema(props, schemas.data_table, "props");
    expect(result.valid).toBe(true);
  });

  it("progress - value in range", () => {
    const props = { value: 75, label: "Loading..." };
    const result = validateJsonSchema(props, schemas.progress, "props");
    expect(result.valid).toBe(true);
  });

  it("alert - valid variant", () => {
    const props = { message: "Success!", variant: "success" };
    const result = validateJsonSchema(props, schemas.alert, "props");
    expect(result.valid).toBe(true);
  });

  it("map - with tuple center", () => {
    const props = {
      center: [40.7128, -74.006],
      zoom: 12,
      markers: [{ lat: 40.7128, lng: -74.006, label: "NYC" }],
    };
    const result = validateJsonSchema(props, schemas.map, "props");
    expect(result.valid).toBe(true);
  });

  it("sandbox - with html", () => {
    const props = {
      html: "<div>Hello</div>",
      css: "div { color: red; }",
      js: "console.log('hi')",
    };
    const result = validateJsonSchema(props, schemas.sandbox, "props");
    expect(result.valid).toBe(true);
  });

  it("stat_grid - with stats array", () => {
    const props = {
      stats: [
        { label: "Users", value: "1,234" },
        { label: "Revenue", value: 5000, change: "+12%" },
      ],
    };
    const result = validateJsonSchema(props, schemas.stat_grid, "props");
    expect(result.valid).toBe(true);
  });

  it("form - with fields", () => {
    const props = {
      title: "Contact",
      fields: [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "message", label: "Message", type: "textarea" },
      ],
    };
    const result = validateJsonSchema(props, schemas.form, "props");
    expect(result.valid).toBe(true);
  });
});

// ── Invalid props ──────────────────────────────────────────────────────

describe("invalid component props fail validation", () => {
  it("chart - missing required fields", () => {
    const result = validateJsonSchema({}, schemas.chart, "props");
    expect(result.valid).toBe(false);
    // Should report missing type, data, dataKeys
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some(e => e.includes("props.type"))).toBe(true);
    expect(result.errors.some(e => e.includes("props.data"))).toBe(true);
    expect(result.errors.some(e => e.includes("props.dataKeys"))).toBe(true);
  });

  it("chart - invalid type enum", () => {
    const props = {
      type: "donut",
      data: [{ x: 1 }],
      dataKeys: ["x"],
    };
    const result = validateJsonSchema(props, schemas.chart, "props");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be one of");
  });

  it("data_table - missing columns", () => {
    const props = { rows: [["a", "b"]] };
    const result = validateJsonSchema(props, schemas.data_table, "props");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("props.columns"))).toBe(true);
  });

  it("progress - value out of range", () => {
    const props = { value: 150 };
    const result = validateJsonSchema(props, schemas.progress, "props");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("<= 100");
  });

  it("alert - invalid variant", () => {
    const props = { message: "Oops", variant: "critical" };
    const result = validateJsonSchema(props, schemas.alert, "props");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be one of");
  });

  it("sandbox - missing html", () => {
    const props = { css: "body {}" };
    const result = validateJsonSchema(props, schemas.sandbox, "props");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("props.html"))).toBe(true);
  });
});

// ── Error message format ───────────────────────────────────────────────

describe("error message quality", () => {
  it("includes dot-path notation for nested errors", () => {
    const props = {
      stats: [{ label: "Users", value: true }], // value should be string|number
    };
    const result = validateJsonSchema(props, schemas.stat_grid, "props");
    expect(result.valid).toBe(false);
    // Should reference the nested path
    expect(result.errors[0]).toMatch(/props\.stats\[0\]/);
  });

  it("includes enum values in error for chart type", () => {
    const props = { type: "scatter", data: [], dataKeys: [] };
    const result = validateJsonSchema(props, schemas.chart, "props");
    expect(result.valid).toBe(false);
    const typeError = result.errors.find(e => e.includes("props.type"));
    expect(typeError).toContain("bar");
    expect(typeError).toContain("line");
    expect(typeError).toContain("pie");
    expect(typeError).toContain("area");
  });
});

// ── Graceful degradation ───────────────────────────────────────────────

describe("graceful degradation", () => {
  it("passes when schema is missing from schemas object", () => {
    // Simulates a component with no generated schema
    const result = validateJsonSchema({ foo: "bar" }, undefined, "props");
    expect(result.valid).toBe(true);
  });

  it("extra props are silently ignored", () => {
    const props = {
      title: "Card",
      body: "Text",
      unknownField: "should be fine",
      anotherExtra: [1, 2, 3],
    };
    const result = validateJsonSchema(props, schemas.card, "props");
    expect(result.valid).toBe(true);
  });
});

// ── Schema coverage ────────────────────────────────────────────────────

describe("schema coverage", () => {
  it("every component in componentNames has a schema", () => {
    const dataPath = resolve(__dirname, "../../../../shared/component-manifest/generated/component-data.json");
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));

    for (const name of data.componentNames) {
      expect(data.schemas[name], `Missing schema for "${name}"`).toBeDefined();
    }
  });
});
