/**
 * Unit tests for the zero-dep JSON Schema validator in jarble-ui-server.js.
 *
 * Since the validator lives in a plain JS file (CommonJS), we extract and
 * test the logic by requiring the functions dynamically.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createContext, Script } from "vm";

// ── Extract validator from jarble-ui-server.js ──────────────────────────
// We create a minimal sandbox that executes just enough of the server code
// to expose validateJsonSchema. This avoids loading the full MCP server
// (which needs stdin/stdout and PVC access).

let validateJsonSchema: (value: unknown, schema: unknown, path: string) => { valid: boolean; errors: string[] };

beforeAll(() => {
  const serverPath = resolve(__dirname, "../jarble-ui-server.js");
  const source = readFileSync(serverPath, "utf-8");

  // Extract the validator functions (between the markers)
  const startMarker = "// ── JSON Schema Validator (zero dependencies)";
  const endMarker = "// ── Component resolver";
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find validator section markers in jarble-ui-server.js");
  }

  const validatorCode = source.slice(startIdx, endIdx);

  // Run in a VM sandbox and extract the function
  const sandbox = { validateJsonSchema: null as unknown, MAX_VALIDATION_ERRORS: 10 };
  const ctx = createContext(sandbox);
  const script = new Script(validatorCode + "\n; validateJsonSchema;");
  sandbox.validateJsonSchema = script.runInContext(ctx);
  validateJsonSchema = sandbox.validateJsonSchema as typeof validateJsonSchema;
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("validateJsonSchema", () => {
  describe("type checks", () => {
    it("passes string type", () => {
      const result = validateJsonSchema("hello", { type: "string" }, "val");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails number when string expected", () => {
      const result = validateJsonSchema(42, { type: "string" }, "val");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("expected string");
      expect(result.errors[0]).toContain("got number");
    });

    it("passes with type array (union)", () => {
      const schema = { type: ["string", "number"] };
      expect(validateJsonSchema("hi", schema, "v").valid).toBe(true);
      expect(validateJsonSchema(42, schema, "v").valid).toBe(true);
      expect(validateJsonSchema(true, schema, "v").valid).toBe(false);
    });

    it("handles null type", () => {
      expect(validateJsonSchema(null, { type: "null" }, "v").valid).toBe(true);
      expect(validateJsonSchema("x", { type: "null" }, "v").valid).toBe(false);
    });

    it("handles boolean type", () => {
      expect(validateJsonSchema(true, { type: "boolean" }, "v").valid).toBe(true);
      expect(validateJsonSchema("true", { type: "boolean" }, "v").valid).toBe(false);
    });

    it("handles array type", () => {
      expect(validateJsonSchema([1, 2], { type: "array" }, "v").valid).toBe(true);
      expect(validateJsonSchema("not array", { type: "array" }, "v").valid).toBe(false);
    });
  });

  describe("enum validation", () => {
    it("passes valid enum value", () => {
      const schema = { type: "string", enum: ["bar", "line", "pie", "area"] };
      expect(validateJsonSchema("bar", schema, "v").valid).toBe(true);
    });

    it("fails invalid enum value", () => {
      const schema = { type: "string", enum: ["bar", "line", "pie", "area"] };
      const result = validateJsonSchema("donut", schema, "v");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be one of");
      expect(result.errors[0]).toContain('"bar"');
    });
  });

  describe("required fields", () => {
    it("passes when all required fields present", () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"],
        additionalProperties: true,
      };
      expect(validateJsonSchema({ name: "Alice" }, schema, "props").valid).toBe(true);
    });

    it("fails when required field missing", () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
        additionalProperties: true,
      };
      const result = validateJsonSchema({ name: "Alice" }, schema, "props");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("props.age");
      expect(result.errors[0]).toContain("required field missing");
    });

    it("includes type hint for missing required field with enum", () => {
      const schema = {
        type: "object",
        properties: { type: { type: "string", enum: ["bar", "line"] } },
        required: ["type"],
        additionalProperties: true,
      };
      const result = validateJsonSchema({}, schema, "props");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("one of: bar, line");
    });
  });

  describe("nested objects", () => {
    it("validates nested object properties", () => {
      const schema = {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: { enabled: { type: "boolean" } },
            required: ["enabled"],
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      };
      const result = validateJsonSchema({ config: { enabled: "yes" } }, schema, "props");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("props.config.enabled");
    });
  });

  describe("array validation", () => {
    it("validates array items", () => {
      const schema = {
        type: "array",
        items: { type: "string" },
      };
      expect(validateJsonSchema(["a", "b"], schema, "arr").valid).toBe(true);

      const result = validateJsonSchema(["a", 42], schema, "arr");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("arr[1]");
    });

    it("validates nested arrays (table rows)", () => {
      const schema = {
        type: "array",
        items: {
          type: "array",
          items: { type: ["string", "number"] },
        },
      };
      expect(validateJsonSchema([["a", 1], ["b", 2]], schema, "rows").valid).toBe(true);
      const result = validateJsonSchema([["a", true]], schema, "rows");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("rows[0][1]");
    });
  });

  describe("tuple validation", () => {
    it("validates fixed-length tuples (map center)", () => {
      const schema = {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: [{ type: "number" }, { type: "number" }],
      };
      expect(validateJsonSchema([40.7, -74.0], schema, "center").valid).toBe(true);

      const tooShort = validateJsonSchema([40.7], schema, "center");
      expect(tooShort.valid).toBe(false);
      expect(tooShort.errors[0]).toContain("at least 2");

      const wrongType = validateJsonSchema(["40.7", -74.0], schema, "center");
      expect(wrongType.valid).toBe(false);
      expect(wrongType.errors[0]).toContain("center[0]");
    });
  });

  describe("number ranges", () => {
    it("validates minimum/maximum (progress value)", () => {
      const schema = { type: "number", minimum: 0, maximum: 100 };
      expect(validateJsonSchema(50, schema, "v").valid).toBe(true);
      expect(validateJsonSchema(0, schema, "v").valid).toBe(true);
      expect(validateJsonSchema(100, schema, "v").valid).toBe(true);

      const tooLow = validateJsonSchema(-1, schema, "v");
      expect(tooLow.valid).toBe(false);
      expect(tooLow.errors[0]).toContain(">= 0");

      const tooHigh = validateJsonSchema(101, schema, "v");
      expect(tooHigh.valid).toBe(false);
      expect(tooHigh.errors[0]).toContain("<= 100");
    });
  });

  describe("anyOf (unions)", () => {
    it("passes when one branch matches", () => {
      const schema = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      expect(validateJsonSchema("hello", schema, "v").valid).toBe(true);
      expect(validateJsonSchema(42, schema, "v").valid).toBe(true);
    });

    it("fails when no branch matches", () => {
      const schema = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      const result = validateJsonSchema(true, schema, "v");
      expect(result.valid).toBe(false);
    });
  });

  describe("unknown properties", () => {
    it("silently ignores extra properties", () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: true,
      };
      const result = validateJsonSchema(
        { name: "Alice", extraField: "ignored", anotherExtra: 42 },
        schema,
        "props"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("error cap", () => {
    it("caps errors at 10", () => {
      const schema = {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`field${i}`, { type: "string" }])
        ),
        required: Array.from({ length: 20 }, (_, i) => `field${i}`),
        additionalProperties: true,
      };
      const result = validateJsonSchema({}, schema, "props");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeLessThanOrEqual(10);
    });
  });

  describe("graceful degradation", () => {
    it("returns valid for null/undefined schema", () => {
      expect(validateJsonSchema("anything", null, "v").valid).toBe(true);
      expect(validateJsonSchema("anything", undefined, "v").valid).toBe(true);
    });

    it("returns valid for empty schema object", () => {
      expect(validateJsonSchema("anything", {}, "v").valid).toBe(true);
    });
  });
});
