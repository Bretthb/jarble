/**
 * Unit tests for agentRegistry.ts.
 *
 * agentRegistry is the source of truth for the static set of platform
 * "specialist" agents the bot can delegate to (component, data,
 * workflow). Three concrete contracts the rest of the platform relies
 * on:
 *
 *   1. The registry's `toolName` strings are what the bot sees as MCP
 *      tool names — `getAgentToolDefinitions()` is what the runtime
 *      handler embeds in the bot's tool list. A typo here means the
 *      bot's `delegate_to_data_agent` call never resolves.
 *
 *   2. `seedPlatformAgents` matches the registry by `name`, so the
 *      `name` field is a join key with `platformAgents.ts`. If a
 *      future PR renames an entry to "data-analysis" without updating
 *      `seedPlatformAgents`, every new deployment would silently
 *      ship without that agent's defaultModel.
 *
 *   3. The `toolInputSchema` shape must be valid JSON-schema-ish so
 *      OpenAI/OpenRouter accept it on the wire.
 *
 * These are static-data tests — they fail loudly if anyone reshapes
 * the registry without updating the matching seed/router code.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_REGISTRY,
  getAgent,
  getAgentByToolName,
  getAgentToolDefinitions,
} from "../../services/agentRegistry.js";

// ── Registry shape ──────────────────────────────────────────────────────────

describe("AGENT_REGISTRY", () => {
  it("contains the three platform specialists", () => {
    const names = AGENT_REGISTRY.map((a) => a.name).sort();
    expect(names).toEqual(["component", "data", "workflow"]);
  });

  it.each(["component", "data", "workflow"])(
    "%s entry has every required field populated",
    (name) => {
      const a = AGENT_REGISTRY.find((x) => x.name === name)!;
      expect(a).toBeDefined();
      expect(typeof a.name).toBe("string");
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.description).toBe("string");
      expect(a.description.length).toBeGreaterThan(0);
      expect(typeof a.systemPromptModule).toBe("string");
      expect(typeof a.defaultModel).toBe("string");
      expect(typeof a.toolName).toBe("string");
      expect(typeof a.toolDescription).toBe("string");
      expect(typeof a.toolInputSchema).toBe("object");
    },
  );

  it("uses unique tool names — no MCP-tool collisions", () => {
    const toolNames = AGENT_REGISTRY.map((a) => a.toolName);
    const unique = new Set(toolNames);
    expect(unique.size).toBe(toolNames.length);
  });

  it("uses unique agent names — no platformAgents seed collision", () => {
    const names = AGENT_REGISTRY.map((a) => a.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("ships JSON-schema-shaped toolInputSchema entries", () => {
    for (const a of AGENT_REGISTRY) {
      const s = a.toolInputSchema as any;
      expect(s.type).toBe("object");
      expect(s.properties).toBeDefined();
      expect(typeof s.properties).toBe("object");
      // Every entry should declare what's required, even if it's a single field.
      expect(Array.isArray(s.required)).toBe(true);
      expect(s.required.length).toBeGreaterThan(0);
      // Required fields must exist in properties.
      for (const r of s.required as string[]) {
        expect(s.properties[r]).toBeDefined();
      }
    }
  });
});

// ── getAgent ────────────────────────────────────────────────────────────────

describe("getAgent", () => {
  it("returns an entry by exact name", () => {
    const a = getAgent("component");
    expect(a).toBeDefined();
    expect(a?.name).toBe("component");
    expect(a?.toolName).toBe("create_component");
  });

  it("returns undefined for unknown name", () => {
    expect(getAgent("nonexistent")).toBeUndefined();
    expect(getAgent("")).toBeUndefined();
  });

  it("is case-sensitive (matches the registry as authored)", () => {
    expect(getAgent("Component")).toBeUndefined();
    expect(getAgent("DATA")).toBeUndefined();
  });
});

// ── getAgentByToolName ──────────────────────────────────────────────────────

describe("getAgentByToolName", () => {
  it("resolves the bot-facing tool name to its agent config", () => {
    expect(getAgentByToolName("create_component")?.name).toBe("component");
    expect(getAgentByToolName("delegate_to_data_agent")?.name).toBe("data");
    expect(getAgentByToolName("delegate_to_workflow_agent")?.name).toBe("workflow");
  });

  it("returns undefined for unknown tool names", () => {
    expect(getAgentByToolName("delegate_to_imaginary_agent")).toBeUndefined();
    expect(getAgentByToolName("")).toBeUndefined();
  });

  it("does NOT resolve agent name as tool name (the two namespaces are distinct)", () => {
    // `component` is the agent name, `create_component` is the tool name.
    // A regression that flattened them would let the bot call `component`
    // as a tool, which would fail downstream.
    expect(getAgentByToolName("component")).toBeUndefined();
    expect(getAgentByToolName("data")).toBeUndefined();
    expect(getAgentByToolName("workflow")).toBeUndefined();
  });
});

// ── getAgentToolDefinitions ─────────────────────────────────────────────────

describe("getAgentToolDefinitions", () => {
  it("returns one definition per registry entry", () => {
    const defs = getAgentToolDefinitions();
    expect(defs).toHaveLength(AGENT_REGISTRY.length);
  });

  it("each definition's name matches the source agent's toolName (not the agent name)", () => {
    const defs = getAgentToolDefinitions();
    for (const def of defs) {
      const source = AGENT_REGISTRY.find((a) => a.toolName === def.name);
      expect(source).toBeDefined();
      // The definition exposes toolDescription/toolInputSchema, not the
      // internal agent description / model.
      expect(def.description).toBe(source!.toolDescription);
      expect(def.inputSchema).toBe(source!.toolInputSchema);
    }
  });

  it("does NOT leak internal fields like systemPromptModule or defaultModel into the bot-facing definition", () => {
    // The bot must not see implementation choices — only the wire-level
    // tool contract. A regression that passed through defaultModel
    // would let an attacker prompt-inject the bot to bypass the choice.
    const defs = getAgentToolDefinitions();
    for (const def of defs as any[]) {
      expect(def.systemPromptModule).toBeUndefined();
      expect(def.defaultModel).toBeUndefined();
      expect(def.name).toBeDefined();
      expect(def.description).toBeDefined();
      expect(def.inputSchema).toBeDefined();
    }
  });
});
