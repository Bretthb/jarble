import { describe, it, expect } from "vitest";
import { validateJsonSchema } from "./jsonSchemaValidation.js";

describe("validateJsonSchema", () => {
  // ── Basic type checking ──────────────────────────────────────────────────

  describe("root object validation", () => {
    const schema = { type: "object" as const, properties: {} };

    it("accepts a plain object", () => {
      const result = validateJsonSchema({}, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects null", () => {
      const result = validateJsonSchema(null, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("$: expected an object");
    });

    it("rejects an array", () => {
      const result = validateJsonSchema([1, 2], schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("$: expected an object");
    });

    it("rejects a string", () => {
      const result = validateJsonSchema("hello", schema);
      expect(result.valid).toBe(false);
    });

    it("rejects a number", () => {
      const result = validateJsonSchema(42, schema);
      expect(result.valid).toBe(false);
    });
  });

  // ── Required fields ──────────────────────────────────────────────────────

  describe("required fields", () => {
    const schema = {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    };

    it("accepts when all required fields are present", () => {
      const result = validateJsonSchema({ name: "Alice", age: 30 }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects when a required field is missing", () => {
      const result = validateJsonSchema({ name: "Alice" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('$: missing required field "age"');
    });

    it("rejects when all required fields are missing", () => {
      const result = validateJsonSchema({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it("accepts when extra fields are present alongside required", () => {
      const result = validateJsonSchema({ name: "Alice", age: 30, extra: true }, schema);
      expect(result.valid).toBe(true);
    });
  });

  // ── Type checking on properties ──────────────────────────────────────────

  describe("property type checking", () => {
    const schema = {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        count: { type: "number" },
        enabled: { type: "boolean" },
        tags: { type: "array" },
        config: { type: "object" },
      },
    };

    it("accepts correct types", () => {
      const result = validateJsonSchema(
        { name: "Alice", count: 5, enabled: true, tags: ["a"], config: {} },
        schema,
      );
      expect(result.valid).toBe(true);
    });

    it("rejects string where number expected", () => {
      const result = validateJsonSchema({ count: "five" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.count");
      expect(result.errors[0]).toContain("expected type number");
    });

    it("rejects number where string expected", () => {
      const result = validateJsonSchema({ name: 42 }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.name");
    });

    it("rejects string where boolean expected", () => {
      const result = validateJsonSchema({ enabled: "true" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.enabled");
    });

    it("rejects object where array expected", () => {
      const result = validateJsonSchema({ tags: {} }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.tags");
    });

    it("rejects array where object expected", () => {
      const result = validateJsonSchema({ config: [] }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.config");
    });

    it("does not validate fields not present in data", () => {
      // Only present fields are validated — missing optional fields are fine
      const result = validateJsonSchema({}, schema);
      expect(result.valid).toBe(true);
    });
  });

  // ── Integer type ─────────────────────────────────────────────────────────

  describe("integer type", () => {
    const schema = {
      type: "object" as const,
      properties: { count: { type: "integer" } },
    };

    it("accepts an integer", () => {
      const result = validateJsonSchema({ count: 42 }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects a float", () => {
      const result = validateJsonSchema({ count: 3.14 }, schema);
      expect(result.valid).toBe(false);
    });

    it("rejects NaN", () => {
      const result = validateJsonSchema({ count: NaN }, schema);
      expect(result.valid).toBe(false);
    });
  });

  // ── Null type ────────────────────────────────────────────────────────────

  describe("null type", () => {
    const schema = {
      type: "object" as const,
      properties: { value: { type: "null" } },
    };

    it("accepts null", () => {
      const result = validateJsonSchema({ value: null }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects undefined-like values", () => {
      const result = validateJsonSchema({ value: 0 }, schema);
      expect(result.valid).toBe(false);
    });
  });

  // ── Union types (type as array) ──────────────────────────────────────────

  describe("union types", () => {
    const schema = {
      type: "object" as const,
      properties: {
        value: { type: ["string", "number"] },
      },
    };

    it("accepts first type in union", () => {
      const result = validateJsonSchema({ value: "hello" }, schema);
      expect(result.valid).toBe(true);
    });

    it("accepts second type in union", () => {
      const result = validateJsonSchema({ value: 42 }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects type not in union", () => {
      const result = validateJsonSchema({ value: true }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("string | number");
    });
  });

  // ── Nested objects ───────────────────────────────────────────────────────

  describe("nested objects", () => {
    const schema = {
      type: "object" as const,
      properties: {
        address: {
          type: "object",
          properties: {
            city: { type: "string" },
            zip: { type: "string" },
          },
          required: ["city"],
        },
      },
    };

    it("accepts valid nested object", () => {
      const result = validateJsonSchema(
        { address: { city: "Portland", zip: "97201" } },
        schema,
      );
      expect(result.valid).toBe(true);
    });

    it("rejects nested object missing required field", () => {
      const result = validateJsonSchema(
        { address: { zip: "97201" } },
        schema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('$.address: missing required field "city"');
    });

    it("rejects nested property with wrong type", () => {
      const result = validateJsonSchema(
        { address: { city: 12345, zip: "97201" } },
        schema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.address.city");
    });
  });

  // ── Array items validation ───────────────────────────────────────────────

  describe("array items", () => {
    const schema = {
      type: "object" as const,
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    };

    it("accepts array with correct item types", () => {
      const result = validateJsonSchema({ tags: ["a", "b", "c"] }, schema);
      expect(result.valid).toBe(true);
    });

    it("accepts empty array", () => {
      const result = validateJsonSchema({ tags: [] }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects array item with wrong type", () => {
      const result = validateJsonSchema({ tags: ["a", 2, "c"] }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("$.tags[1]");
    });
  });

  // ── Enum validation ──────────────────────────────────────────────────────

  describe("enum values", () => {
    const schema = {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["active", "inactive", "pending"] },
      },
    };

    it("accepts value in enum", () => {
      const result = validateJsonSchema({ status: "active" }, schema);
      expect(result.valid).toBe(true);
    });

    it("rejects value not in enum", () => {
      const result = validateJsonSchema({ status: "deleted" }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be one of");
    });
  });

  // ── Multiple errors ──────────────────────────────────────────────────────

  describe("multiple errors", () => {
    it("collects all errors in a single pass", () => {
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age", "email"],
      };

      const result = validateJsonSchema({ name: 42, age: "thirty" }, schema);
      expect(result.valid).toBe(false);
      // 1 missing required (email) + 2 type mismatches (name, age)
      expect(result.errors.length).toBe(3);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles schema with no properties key", () => {
      const schema = { type: "object" as const } as any;
      const result = validateJsonSchema({ anything: true }, schema);
      expect(result.valid).toBe(true);
    });

    it("handles unknown type gracefully (lenient)", () => {
      const schema = {
        type: "object" as const,
        properties: { x: { type: "custom_type" } },
      };
      // Unknown types are accepted (lenient behavior)
      const result = validateJsonSchema({ x: "anything" }, schema);
      expect(result.valid).toBe(true);
    });

    it("handles deeply nested objects", () => {
      const schema = {
        type: "object" as const,
        properties: {
          level1: {
            type: "object",
            properties: {
              level2: {
                type: "object",
                properties: {
                  value: { type: "number" },
                },
                required: ["value"],
              },
            },
          },
        },
      };

      const valid = validateJsonSchema({ level1: { level2: { value: 42 } } }, schema);
      expect(valid.valid).toBe(true);

      const invalid = validateJsonSchema({ level1: { level2: { value: "not a number" } } }, schema);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors[0]).toContain("$.level1.level2.value");
    });

    it("handles array of objects", () => {
      const schema = {
        type: "object" as const,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" },
              },
              required: ["id"],
            },
          },
        },
      };

      const valid = validateJsonSchema({ items: [{ id: 1 }, { id: 2 }] }, schema);
      expect(valid.valid).toBe(true);

      const invalid = validateJsonSchema({ items: [{ id: 1 }, { name: "no id" }] }, schema);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors[0]).toContain("$.items[1]");
    });
  });

  // ── Real-world PackageCard skill input schemas ───────────────────────────

  describe("real-world skill input schemas", () => {
    it("validates a weather skill input", () => {
      const schema = {
        type: "object" as const,
        properties: {
          city: { type: "string" },
          units: { type: "string", enum: ["metric", "imperial"] },
        },
        required: ["city"],
      };

      expect(validateJsonSchema({ city: "Portland", units: "metric" }, schema).valid).toBe(true);
      expect(validateJsonSchema({ city: "Portland" }, schema).valid).toBe(true);
      expect(validateJsonSchema({ units: "metric" }, schema).valid).toBe(false);
      expect(validateJsonSchema({ city: "Portland", units: "kelvin" }, schema).valid).toBe(false);
    });

    it("validates a search skill input", () => {
      const schema = {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
          filters: {
            type: "object",
            properties: {
              category: { type: "string" },
              minPrice: { type: "number" },
            },
          },
        },
        required: ["query"],
      };

      expect(validateJsonSchema({ query: "laptop", limit: 10 }, schema).valid).toBe(true);
      expect(validateJsonSchema({ query: "laptop", limit: 10.5 }, schema).valid).toBe(false);
      expect(validateJsonSchema({}, schema).valid).toBe(false);
    });
  });
});
