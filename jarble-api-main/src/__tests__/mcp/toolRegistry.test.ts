/**
 * Unit tests for `ToolRegistry` in src/mcp/toolRegistry.ts.
 *
 * The registry is the in-process tool system the chat agent uses
 * during the multi-turn LLM tool-calling loop in `tamboAgent.ts`.
 * Tools are registered at startup and the LLM proxy reads
 * `toLlmToolDefinitions()` to populate the OpenRouter / Anthropic
 * `tools` field on each chat-completion call.
 *
 * Three contracts pinned:
 *
 *   1. **Registration is keyed by tool name** — the same name
 *      registered twice MUST overwrite the prior tool. The chat
 *      agent looks tools up by name from the LLM's tool_call
 *      response, so a stale collision would route the LLM call
 *      to the wrong implementation.
 *
 *   2. **`toLlmToolDefinitions()` strips internal fields** — the
 *      LLM only needs name + description + parameters. Leaking
 *      `execute` (a function) or `rendersComponent` (a UI hint)
 *      into the wire payload would cause OpenRouter to reject
 *      the request as a malformed tool definition.
 *
 *   3. **`getAll()` preserves insertion order** — the LLM may
 *      bias toward the first tool in the list when several look
 *      similar. Pinning the order means a future change that
 *      reshuffles the registry won't silently shift the bias.
 */

import { describe, it, expect } from "vitest";
import { ToolRegistry, type McpTool } from "../../mcp/toolRegistry.js";

/** Build a minimal McpTool fixture. */
function fakeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: overrides.name ?? "test_tool",
    description: overrides.description ?? "A test tool",
    parameters: overrides.parameters ?? { type: "object", properties: {} },
    rendersComponent: overrides.rendersComponent,
    execute: overrides.execute ?? (async () => ({ success: true, message: "ok" })),
  };
}

// ── register / get ──────────────────────────────────────────────────────────

describe("ToolRegistry — register / get", () => {
  it("returns undefined for an unknown tool name", () => {
    const reg = new ToolRegistry();
    expect(reg.get("never_registered")).toBeUndefined();
  });

  it("returns the registered tool by name", () => {
    const reg = new ToolRegistry();
    const tool = fakeTool({ name: "alpha", description: "first" });
    reg.register(tool);
    expect(reg.get("alpha")).toBe(tool);
    expect(reg.get("alpha")?.description).toBe("first");
  });

  it("overwrites a same-name tool on re-register (latest-write-wins)", () => {
    // Critical: the chat agent looks tools up by name from the
    // LLM's tool_call response. A stale collision would route the
    // call to the wrong implementation.
    const reg = new ToolRegistry();
    const v1 = fakeTool({ name: "send_message", description: "v1" });
    const v2 = fakeTool({ name: "send_message", description: "v2" });
    reg.register(v1);
    reg.register(v2);
    expect(reg.get("send_message")).toBe(v2);
    expect(reg.get("send_message")?.description).toBe("v2");
  });

  it("isolates instances — two registries don't share tools", () => {
    const a = new ToolRegistry();
    const b = new ToolRegistry();
    a.register(fakeTool({ name: "x" }));
    expect(a.get("x")).toBeDefined();
    expect(b.get("x")).toBeUndefined();
  });
});

// ── getAll ──────────────────────────────────────────────────────────────────

describe("ToolRegistry — getAll", () => {
  it("returns an empty array on a fresh registry", () => {
    expect(new ToolRegistry().getAll()).toEqual([]);
  });

  it("returns every registered tool", () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool({ name: "a" }));
    reg.register(fakeTool({ name: "b" }));
    reg.register(fakeTool({ name: "c" }));
    const names = reg.getAll().map((t) => t.name);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("preserves insertion order (Map-iteration semantics)", () => {
    // The LLM may bias toward earlier tools when several look
    // similar. Pinning insertion order means a registry shuffle
    // doesn't silently shift the bias.
    const reg = new ToolRegistry();
    reg.register(fakeTool({ name: "third" }));
    reg.register(fakeTool({ name: "first" }));
    reg.register(fakeTool({ name: "second" }));
    expect(reg.getAll().map((t) => t.name)).toEqual(["third", "first", "second"]);
  });

  it("a re-register does NOT change the original insertion position", () => {
    // Map.set on an existing key updates the value but keeps the
    // original position. So "a" stays at the top even after the
    // overwrite.
    const reg = new ToolRegistry();
    reg.register(fakeTool({ name: "a", description: "v1" }));
    reg.register(fakeTool({ name: "b" }));
    reg.register(fakeTool({ name: "a", description: "v2" }));
    const all = reg.getAll();
    expect(all.map((t) => t.name)).toEqual(["a", "b"]);
    expect(all[0].description).toBe("v2");
  });
});

// ── toLlmToolDefinitions ────────────────────────────────────────────────────

describe("ToolRegistry — toLlmToolDefinitions", () => {
  it("returns one definition per registered tool", () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool({ name: "a" }));
    reg.register(fakeTool({ name: "b" }));
    expect(reg.toLlmToolDefinitions()).toHaveLength(2);
  });

  it("preserves name / description / parameters on each definition", () => {
    const reg = new ToolRegistry();
    const params = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    reg.register(fakeTool({
      name: "search_docs",
      description: "Search docs by query",
      parameters: params,
    }));
    const [def] = reg.toLlmToolDefinitions();
    expect(def.name).toBe("search_docs");
    expect(def.description).toBe("Search docs by query");
    expect(def.parameters).toBe(params);
  });

  it("strips internal `execute` and `rendersComponent` fields from the LLM-bound payload", () => {
    // The LLM only needs name + description + parameters. Leaking
    // a function into the wire payload would cause OpenRouter to
    // reject the request as a malformed tool definition.
    const reg = new ToolRegistry();
    reg.register(fakeTool({
      name: "show_platforms",
      rendersComponent: "PlatformPicker",
    }));
    const [def] = reg.toLlmToolDefinitions();
    expect((def as any).execute).toBeUndefined();
    expect((def as any).rendersComponent).toBeUndefined();
  });

  it("returns an empty array on an empty registry", () => {
    expect(new ToolRegistry().toLlmToolDefinitions()).toEqual([]);
  });

  it("definitions are independent objects (not aliased to the McpTool)", () => {
    // Modifying the returned definition must NOT mutate the
    // registry's internal McpTool. Otherwise a malicious caller
    // could overwrite a tool's parameters mid-request.
    const reg = new ToolRegistry();
    const tool = fakeTool({ name: "x", description: "original" });
    reg.register(tool);
    const [def] = reg.toLlmToolDefinitions();
    (def as any).description = "tampered";
    expect(reg.get("x")?.description).toBe("original");
  });
});
