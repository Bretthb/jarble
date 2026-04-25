/**
 * Unit tests for memoryScope.ts.
 *
 * The four exported helpers each carry a separate but related contract:
 *
 *   - normalizeMemoryScope     — coerces stale/missing DB rows back to
 *                                "global" so a deployment row written
 *                                before the migration shipped behaves
 *                                identically to existing deployments.
 *   - renderMemoryPromptSection — the wording the LLM sees in soul.md.
 *                                The OFF case in particular is a hard
 *                                signal that memory tools are no-ops;
 *                                a regression here would let the bot
 *                                still call store_memory in OFF mode.
 *   - renderMemoryStateLine    — short [CANVAS_STATE] line on every
 *                                turn. SESSION mode must include the
 *                                session id so the bot can use it as
 *                                scope_id in tool calls.
 *   - injectMemoryStateLine    — merges the line into an existing
 *                                [CANVAS_STATE] block or creates one.
 *                                Must be idempotent w.r.t. the regex.
 *
 * Coverage focuses on the boundary between modes (most regressions
 * here will be cross-mode bleed, e.g. SESSION accidentally falling
 * through to GLOBAL wording).
 */

import { describe, it, expect } from "vitest";
import {
  MEMORY_SCOPES,
  normalizeMemoryScope,
  renderMemoryPromptSection,
  renderMemoryStateLine,
  injectMemoryStateLine,
} from "../../utils/memoryScope.js";

// ── normalizeMemoryScope ────────────────────────────────────────────────────

describe("normalizeMemoryScope", () => {
  it("passes through every valid scope", () => {
    expect(normalizeMemoryScope("global")).toBe("global");
    expect(normalizeMemoryScope("session")).toBe("session");
    expect(normalizeMemoryScope("off")).toBe("off");
  });

  it("falls back to 'global' for unknown strings", () => {
    expect(normalizeMemoryScope("private")).toBe("global");
    expect(normalizeMemoryScope("")).toBe("global");
    expect(normalizeMemoryScope("Global")).toBe("global"); // case-sensitive
  });

  it("falls back to 'global' for non-string inputs", () => {
    expect(normalizeMemoryScope(undefined)).toBe("global");
    expect(normalizeMemoryScope(null)).toBe("global");
    expect(normalizeMemoryScope(0)).toBe("global");
    expect(normalizeMemoryScope({ scope: "off" })).toBe("global");
    expect(normalizeMemoryScope([])).toBe("global");
  });

  it("MEMORY_SCOPES tuple matches the type union exactly", () => {
    expect(MEMORY_SCOPES).toEqual(["global", "session", "off"]);
  });
});

// ── renderMemoryPromptSection ───────────────────────────────────────────────

describe("renderMemoryPromptSection", () => {
  it("OFF mode says memory is disabled and the tools are no-ops", () => {
    const out = renderMemoryPromptSection("off");
    expect(out).toMatch(/Memory: DISABLED/);
    expect(out).toMatch(/store_memory/);
    expect(out).toMatch(/recall_memory/);
    expect(out).toMatch(/list_memories/);
    expect(out).toMatch(/forget_memory/);
    // It must NOT tell the bot to greet returning users (that's GLOBAL wording).
    expect(out).not.toMatch(/recall_memory.*returning users/i);
  });

  it("SESSION mode requires scope_id and forbids cross-session claims", () => {
    const out = renderMemoryPromptSection("session");
    expect(out).toMatch(/Memory: SESSION-SCOPED/);
    expect(out).toMatch(/scope_id/);
    expect(out).toMatch(/Never claim to remember something from another session/);
    // Should not advertise cross-platform persistence (GLOBAL wording).
    expect(out).not.toMatch(/shared across every chat session/);
  });

  it("GLOBAL mode advertises cross-platform persistent memory", () => {
    const out = renderMemoryPromptSection("global");
    expect(out).toMatch(/Memory: GLOBAL/);
    expect(out).toMatch(/shared across every chat session/);
    expect(out).toMatch(/Telegram, Discord, WhatsApp, and Slack/);
    // OFF/SESSION wording must not leak in.
    expect(out).not.toMatch(/Memory: DISABLED/);
    expect(out).not.toMatch(/Memory: SESSION-SCOPED/);
  });
});

// ── renderMemoryStateLine ───────────────────────────────────────────────────

describe("renderMemoryStateLine", () => {
  it("OFF mode emits a single 'Memory: off' line regardless of session id", () => {
    expect(renderMemoryStateLine("off", null)).toBe("Memory: off");
    expect(renderMemoryStateLine("off", undefined)).toBe("Memory: off");
    expect(renderMemoryStateLine("off", "any-session")).toBe("Memory: off");
  });

  it("SESSION mode includes the session id when present", () => {
    expect(renderMemoryStateLine("session", "abc-123")).toBe(
      "Memory: session-scoped\nSession: abc-123",
    );
  });

  it("SESSION mode falls back to 'unknown' when session id is missing", () => {
    expect(renderMemoryStateLine("session", null)).toBe(
      "Memory: session-scoped\nSession: unknown",
    );
    expect(renderMemoryStateLine("session", undefined)).toBe(
      "Memory: session-scoped\nSession: unknown",
    );
    expect(renderMemoryStateLine("session", "")).toBe(
      "Memory: session-scoped\nSession: unknown",
    );
  });

  it("GLOBAL mode emits the cross-session indicator", () => {
    expect(renderMemoryStateLine("global", null)).toBe(
      "Memory: global (persists across all sessions and platforms)",
    );
    // Session id is irrelevant for GLOBAL.
    expect(renderMemoryStateLine("global", "abc-123")).toBe(
      "Memory: global (persists across all sessions and platforms)",
    );
  });
});

// ── injectMemoryStateLine ───────────────────────────────────────────────────

describe("injectMemoryStateLine", () => {
  const memLine = "Memory: off";

  it("creates a [CANVAS_STATE] block when none exists", () => {
    const out = injectMemoryStateLine("hello", memLine);
    expect(out).toContain("[CANVAS_STATE]");
    expect(out).toContain("[/CANVAS_STATE]");
    expect(out).toContain(memLine);
    expect(out).toContain("hello");
    // The original message body must be preserved AFTER the canvas block.
    expect(out.indexOf(memLine)).toBeLessThan(out.indexOf("hello"));
  });

  it("merges the memory line into an existing [CANVAS_STATE] block", () => {
    const existing = "[CANVAS_STATE]\nFoo: bar\n[/CANVAS_STATE]\nuser message";
    const out = injectMemoryStateLine(existing, memLine);
    expect(out).toContain(memLine);
    expect(out).toContain("Foo: bar");
    // Memory line must come BEFORE the pre-existing canvas content.
    expect(out.indexOf(memLine)).toBeLessThan(out.indexOf("Foo: bar"));
    // Only one [CANVAS_STATE] block should exist after merge.
    expect((out.match(/\[CANVAS_STATE\]/g) || []).length).toBe(1);
    expect((out.match(/\[\/CANVAS_STATE\]/g) || []).length).toBe(1);
  });

  it("preserves the message body that follows the existing [CANVAS_STATE] block", () => {
    const existing = "[CANVAS_STATE]\nFoo: bar\n[/CANVAS_STATE]\nUser asks a question.";
    const out = injectMemoryStateLine(existing, memLine);
    expect(out).toContain("User asks a question.");
  });

  it("works with an empty inner [CANVAS_STATE] block", () => {
    const existing = "[CANVAS_STATE][/CANVAS_STATE]\nbody";
    const out = injectMemoryStateLine(existing, memLine);
    expect(out).toContain(memLine);
    expect(out).toContain("body");
  });

  it("handles an empty input message", () => {
    const out = injectMemoryStateLine("", memLine);
    expect(out).toContain("[CANVAS_STATE]");
    expect(out).toContain(memLine);
  });
});
