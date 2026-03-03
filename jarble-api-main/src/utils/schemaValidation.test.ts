import { describe, it, expect } from "vitest";
import { validatePropsSchema } from "./schemaValidation.js";

describe("validatePropsSchema", () => {
  it("accepts a valid JSON Schema with type object and properties", () => {
    const schema = JSON.stringify({
      type: "object",
      properties: {
        title: { type: "string" },
        value: { type: "number" },
      },
      required: ["title"],
    });
    expect(() => validatePropsSchema(schema)).not.toThrow();
  });

  it("accepts minimal valid schema (empty properties)", () => {
    const schema = JSON.stringify({
      type: "object",
      properties: {},
    });
    expect(() => validatePropsSchema(schema)).not.toThrow();
  });

  it("accepts schema with nested objects", () => {
    const schema = JSON.stringify({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: { key: { type: "string" } },
        },
      },
    });
    expect(() => validatePropsSchema(schema)).not.toThrow();
  });

  it("rejects invalid JSON syntax", () => {
    expect(() => validatePropsSchema("{not valid json}")).toThrow(
      "propsSchema must be valid JSON"
    );
  });

  it("rejects a JSON string (not an object)", () => {
    expect(() => validatePropsSchema('"hello"')).toThrow(
      "propsSchema must be a JSON object"
    );
  });

  it("rejects a JSON array", () => {
    expect(() => validatePropsSchema("[]")).toThrow(
      "propsSchema must be a JSON object"
    );
  });

  it("rejects null JSON", () => {
    expect(() => validatePropsSchema("null")).toThrow(
      "propsSchema must be a JSON object"
    );
  });

  it("rejects a number", () => {
    expect(() => validatePropsSchema("42")).toThrow(
      "propsSchema must be a JSON object"
    );
  });

  it('rejects schema with root type not "object"', () => {
    const schema = JSON.stringify({
      type: "string",
      properties: {},
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema root type must be "object"'
    );
  });

  it("rejects schema with type array", () => {
    const schema = JSON.stringify({
      type: "array",
      items: { type: "string" },
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema root type must be "object"'
    );
  });

  it("rejects schema missing type field entirely", () => {
    const schema = JSON.stringify({
      properties: { name: { type: "string" } },
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema root type must be "object"'
    );
  });

  it('rejects schema missing "properties" key', () => {
    const schema = JSON.stringify({
      type: "object",
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema must have a "properties" key'
    );
  });

  it('rejects schema where "properties" is not an object', () => {
    const schema = JSON.stringify({
      type: "object",
      properties: "not-an-object",
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema must have a "properties" key'
    );
  });

  it('rejects schema where "properties" is null', () => {
    const schema = JSON.stringify({
      type: "object",
      properties: null,
    });
    expect(() => validatePropsSchema(schema)).toThrow(
      'propsSchema must have a "properties" key'
    );
  });

  it("throws TRPCError with code BAD_REQUEST", () => {
    try {
      validatePropsSchema("not json");
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  it("accepts schema with additionalProperties and $schema", () => {
    const schema = JSON.stringify({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: { type: "string" },
      },
      additionalProperties: false,
    });
    expect(() => validatePropsSchema(schema)).not.toThrow();
  });
});
