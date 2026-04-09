import { describe, it, expect } from "vitest";
import {
  isValidMemoryScope,
  renderMemoryPromptSection,
  MEMORY_SCOPES,
  type MemoryScope,
} from "../memoryScope.js";

// ── isValidMemoryScope ──────────────────────────────────────────────────────

describe("isValidMemoryScope", () => {
  it("returns true for 'global'", () => {
    expect(isValidMemoryScope("global")).toBe(true);
  });

  it("returns true for 'session'", () => {
    expect(isValidMemoryScope("session")).toBe(true);
  });

  it("returns true for 'off'", () => {
    expect(isValidMemoryScope("off")).toBe(true);
  });

  it("returns false for an unknown string", () => {
    expect(isValidMemoryScope("per-user")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidMemoryScope("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidMemoryScope(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidMemoryScope(undefined)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isValidMemoryScope(42)).toBe(false);
  });

  it("returns false for a boolean", () => {
    expect(isValidMemoryScope(true)).toBe(false);
  });

  it("returns false for an object", () => {
    expect(isValidMemoryScope({ scope: "global" })).toBe(false);
  });

  it("is case-sensitive (rejects 'Global')", () => {
    expect(isValidMemoryScope("Global")).toBe(false);
  });

  it("is case-sensitive (rejects 'OFF')", () => {
    expect(isValidMemoryScope("OFF")).toBe(false);
  });
});

// ── MEMORY_SCOPES constant ──────────────────────────────────────────────────

describe("MEMORY_SCOPES", () => {
  it("contains exactly three values", () => {
    expect(MEMORY_SCOPES).toHaveLength(3);
  });

  it("contains global, session, and off", () => {
    expect(MEMORY_SCOPES).toContain("global");
    expect(MEMORY_SCOPES).toContain("session");
    expect(MEMORY_SCOPES).toContain("off");
  });
});

// ── renderMemoryPromptSection ───────────────────────────────────────────────

describe("renderMemoryPromptSection", () => {
  it("returns a global scope section for 'global'", () => {
    const result = renderMemoryPromptSection("global");
    expect(result).toContain("Memory Scope: Global");
    expect(result).toContain("shared across all");
  });

  it("returns a per-conversation section for 'session'", () => {
    const result = renderMemoryPromptSection("session");
    expect(result).toContain("Memory Scope: Per-Conversation");
    expect(result).toContain("session_id");
  });

  it("instructs session mode that session_id is managed automatically", () => {
    const result = renderMemoryPromptSection("session");
    expect(result).toContain("managed automatically");
  });

  it("returns a disabled section for 'off'", () => {
    const result = renderMemoryPromptSection("off");
    expect(result).toContain("Memory: DISABLED");
    expect(result).toContain("Do NOT call");
  });

  it("mentions all memory tools in the 'off' section", () => {
    const result = renderMemoryPromptSection("off");
    expect(result).toContain("store_memory");
    expect(result).toContain("recall_memory");
    expect(result).toContain("list_memories");
    expect(result).toContain("forget_memory");
  });

  it("suggests enabling memory in settings when off", () => {
    const result = renderMemoryPromptSection("off");
    expect(result).toContain("deployment settings");
  });

  it("mentions cross-platform sharing in global mode", () => {
    const result = renderMemoryPromptSection("global");
    expect(result).toMatch(/Telegram|Discord|WhatsApp/);
  });

  it("returns non-empty strings for all scope values", () => {
    for (const scope of MEMORY_SCOPES) {
      const result = renderMemoryPromptSection(scope);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("returns different text for each scope", () => {
    const results = MEMORY_SCOPES.map((s) => renderMemoryPromptSection(s));
    const unique = new Set(results);
    expect(unique.size).toBe(MEMORY_SCOPES.length);
  });
});
