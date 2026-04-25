/**
 * Unit tests for `jsonSchemaPropertyToZod` + `buildInputSchema`
 * in src/mcp/mcpServer.ts.
 *
 * These two helpers translate a tool's JSON-Schema `parameters`
 * into a Zod schema the MCP SDK uses to advertise parameter
 * names and types to clients. A regression silently breaks every
 * MCP client's ability to discover what arguments to pass — and
 * since the LLM also reads these schemas to compose tool calls,
 * a wrong schema means the LLM hallucinates the wrong shape and
 * the tool never runs.
 *
 * Three contracts pinned:
 *
 *   1. **Type fidelity** — every JSON Schema primitive maps to
 *      the right Zod type (string, number, integer→number,
 *      boolean, object, array, enum). Unknown types fall through
 *      to z.unknown() rather than throw.
 *
 *   2. **Required vs optional** — fields not in the `required`
 *      array become `.optional()`. The MCP SDK uses Zod's
 *      `.optional()` flag to render UI affordances correctly.
 *
 *   3. **Description preservation** — when JSON Schema has a
 *      `description`, the Zod schema's `.describe()` mirrors it.
 *      LLMs rely on these for tool selection.
 */

import { describe, it, expect, vi } from "vitest";

// mcpServer.ts imports db/index.js (DATABASE_URL gate) and the
// MCP SDK. Mock both so the test can import the pure helpers.
vi.mock("../../db/index.js", () => ({
  db: { query: {} },
  tables: {},
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor() {}
    registerTool() {}
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../mcp/tools/index.js", () => ({
  mcpRegistry: { getAll: () => [] },
}));

import { jsonSchemaPropertyToZod, buildInputSchema } from "../../mcp/mcpServer.js";

// ── jsonSchemaPropertyToZod — primitive types ───────────────────────────────

describe("jsonSchemaPropertyToZod — primitives", () => {
  it("maps `string` to z.string() that accepts strings and rejects numbers", () => {
    const schema = jsonSchemaPropertyToZod({ type: "string" });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(false);
  });

  it("maps `number` to z.number()", () => {
    const schema = jsonSchemaPropertyToZod({ type: "number" });
    expect(schema.safeParse(42.5).success).toBe(true);
    expect(schema.safeParse("42").success).toBe(false);
  });

  it("maps `integer` to z.number() (NOT a separate integer type — JSON Schema's only diff)", () => {
    // The implementation collapses integer into number — JSON Schema
    // distinguishes them but Zod doesn't have a built-in integer
    // primitive that's wire-compatible with the MCP SDK.
    const schema = jsonSchemaPropertyToZod({ type: "integer" });
    expect(schema.safeParse(42).success).toBe(true);
    // Floats also pass — pinning the current behavior; future
    // tightening to .int() would require updating this test.
    expect(schema.safeParse(42.5).success).toBe(true);
  });

  it("maps `boolean` to z.boolean()", () => {
    const schema = jsonSchemaPropertyToZod({ type: "boolean" });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse("true").success).toBe(false);
    expect(schema.safeParse(0).success).toBe(false);
  });

  it("maps `array` to z.array(z.unknown()) (item-level validation is intentionally loose)", () => {
    const schema = jsonSchemaPropertyToZod({ type: "array" });
    expect(schema.safeParse([]).success).toBe(true);
    expect(schema.safeParse([1, "two", { three: 3 }]).success).toBe(true);
    expect(schema.safeParse("not an array").success).toBe(false);
  });

  it("falls back to z.unknown() for unknown types (does NOT throw)", () => {
    // A future JSON Schema type the parser doesn't recognize
    // should NOT crash the schema build — it just drops to
    // z.unknown() and accepts anything.
    const schema = jsonSchemaPropertyToZod({ type: "weird-future-type" });
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse({ anything: true }).success).toBe(true);
  });
});

// ── jsonSchemaPropertyToZod — enum ──────────────────────────────────────────

describe("jsonSchemaPropertyToZod — enum", () => {
  it("maps `enum` to z.enum([...]) with strict membership check", () => {
    const schema = jsonSchemaPropertyToZod({ enum: ["red", "blue", "green"] });
    expect(schema.safeParse("red").success).toBe(true);
    expect(schema.safeParse("blue").success).toBe(true);
    expect(schema.safeParse("yellow").success).toBe(false);
  });

  it("enum takes precedence over `type` when both are present", () => {
    // The implementation checks enum FIRST. A regression that
    // checked type first would treat the schema as an unbounded
    // string when the spec says it's a fixed set.
    const schema = jsonSchemaPropertyToZod({ type: "string", enum: ["a", "b"] });
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("c").success).toBe(false);
  });
});

// ── jsonSchemaPropertyToZod — object ────────────────────────────────────────

describe("jsonSchemaPropertyToZod — object", () => {
  it("nested object with explicit `properties` becomes z.object() with those keys", () => {
    const schema = jsonSchemaPropertyToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
    expect(schema.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
    // Missing required field → fail.
    expect(schema.safeParse({ age: 30 }).success).toBe(false);
    // Missing optional field → succeed.
    expect(schema.safeParse({ name: "Alice" }).success).toBe(true);
  });

  it("object WITHOUT explicit `properties` becomes z.object({}).passthrough() (accepts arbitrary keys)", () => {
    // Tambo rejects z.record so passthrough is the chosen
    // workaround for "any object". The schema must accept
    // arbitrary keys without failing.
    const schema = jsonSchemaPropertyToZod({ type: "object" });
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ random: "key", count: 42, nested: { a: 1 } }).success).toBe(true);
  });

  it("nested object recurses on properties (multi-level)", () => {
    const schema = jsonSchemaPropertyToZod({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            settings: {
              type: "object",
              properties: { theme: { type: "string" } },
              required: ["theme"],
            },
          },
          required: ["id", "settings"],
        },
      },
      required: ["user"],
    });
    expect(schema.safeParse({ user: { id: "u1", settings: { theme: "dark" } } }).success).toBe(true);
    // Missing nested-required → fail.
    expect(schema.safeParse({ user: { id: "u1", settings: {} } }).success).toBe(false);
  });
});

// ── description preservation ───────────────────────────────────────────────

describe("jsonSchemaPropertyToZod — description preservation", () => {
  it("attaches description via z.string().describe()", () => {
    const schema = jsonSchemaPropertyToZod({ type: "string", description: "Hello world" });
    // Zod keeps the description on `_def.description`.
    expect((schema as any)._def.description).toBe("Hello world");
  });

  it("attaches description on number, boolean, array, object", () => {
    expect((jsonSchemaPropertyToZod({ type: "number", description: "n" }) as any)._def.description).toBe("n");
    expect((jsonSchemaPropertyToZod({ type: "boolean", description: "b" }) as any)._def.description).toBe("b");
    expect((jsonSchemaPropertyToZod({ type: "array", description: "a" }) as any)._def.description).toBe("a");
    expect((jsonSchemaPropertyToZod({ type: "object", description: "o" }) as any)._def.description).toBe("o");
  });

  it("undefined description does NOT crash (no .describe() call)", () => {
    const schema = jsonSchemaPropertyToZod({ type: "string" });
    expect(schema.safeParse("x").success).toBe(true);
  });
});

// ── buildInputSchema ────────────────────────────────────────────────────────

describe("buildInputSchema", () => {
  it("returns an empty z.object({}) when tool.parameters is missing or has no properties", () => {
    const empty = buildInputSchema({ name: "x", description: "x", parameters: {}, execute: () => Promise.resolve({ success: true, message: "" }) } as any);
    expect(empty.safeParse({}).success).toBe(true);
    // No properties → strict object rejects extra keys by default.
    // (Zod's z.object({}) is strict — passthrough would be opt-in.)
    expect(Object.keys((empty as any).shape).length).toBe(0);
  });

  it("builds a shape from parameters.properties with required vs optional fields", () => {
    const tool = {
      name: "send",
      description: "send a message",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          body: { type: "string" },
          urgent: { type: "boolean" },
        },
        required: ["to", "body"],
      },
      execute: () => Promise.resolve({ success: true, message: "" }),
    } as any;

    const schema = buildInputSchema(tool);
    expect(schema.safeParse({ to: "alice", body: "hello" }).success).toBe(true);
    expect(schema.safeParse({ to: "alice", body: "hello", urgent: true }).success).toBe(true);
    // Missing required field.
    expect(schema.safeParse({ to: "alice" }).success).toBe(false);
  });

  it("treats absent `required` array as 'all optional'", () => {
    const tool = {
      name: "x",
      description: "x",
      parameters: {
        type: "object",
        properties: { a: { type: "string" } },
        // no `required` field
      },
      execute: () => Promise.resolve({ success: true, message: "" }),
    } as any;
    const schema = buildInputSchema(tool);
    // Both with-and-without `a` should pass.
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ a: "value" }).success).toBe(true);
  });

  it("non-array `required` field is treated as no required fields (defensive)", () => {
    const tool = {
      name: "x",
      description: "x",
      parameters: {
        type: "object",
        properties: { a: { type: "string" } },
        required: "not-an-array" as any,
      },
      execute: () => Promise.resolve({ success: true, message: "" }),
    } as any;
    const schema = buildInputSchema(tool);
    expect(schema.safeParse({}).success).toBe(true);
  });
});
