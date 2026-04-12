/**
 * Memory scope helper tests.
 *
 * Covers normalizeMemoryScope, renderMemoryPromptSection, and
 * renderMemoryStateLine. These helpers are the authoritative source of
 * wording for the soul.md memory section and the per-turn [CANVAS_STATE]
 * line, so changes here will leak into live deployments — lock the wording
 * down with snapshot-style assertions so regressions are caught early.
 *
 * See docs/audits/memory-scoping-decision.md.
 */
import { describe, it, expect } from "vitest";
import {
  MEMORY_SCOPES,
  injectMemoryStateLine,
  normalizeMemoryScope,
  renderMemoryPromptSection,
  renderMemoryStateLine,
  type MemoryScope,
} from "../memoryScope.js";

describe("MEMORY_SCOPES", () => {
  it("contains exactly the three supported values", () => {
    expect([...MEMORY_SCOPES]).toEqual(["global", "session", "off"]);
  });
});

describe("normalizeMemoryScope", () => {
  it("passes through valid scopes unchanged", () => {
    const scopes: MemoryScope[] = ["global", "session", "off"];
    for (const s of scopes) {
      expect(normalizeMemoryScope(s)).toBe(s);
    }
  });

  it("falls back to 'global' for undefined / null", () => {
    expect(normalizeMemoryScope(undefined)).toBe("global");
    expect(normalizeMemoryScope(null)).toBe("global");
  });

  it("falls back to 'global' for unknown strings", () => {
    expect(normalizeMemoryScope("everything")).toBe("global");
    expect(normalizeMemoryScope("")).toBe("global");
    expect(normalizeMemoryScope("GLOBAL")).toBe("global"); // case sensitive
  });

  it("falls back to 'global' for non-string inputs", () => {
    expect(normalizeMemoryScope(0)).toBe("global");
    expect(normalizeMemoryScope(true)).toBe("global");
    expect(normalizeMemoryScope({})).toBe("global");
    expect(normalizeMemoryScope([])).toBe("global");
  });
});

describe("renderMemoryPromptSection", () => {
  it("global mode advertises cross-platform memory", () => {
    const out = renderMemoryPromptSection("global");
    expect(out).toContain("## Memory: GLOBAL");
    expect(out).toContain("shared across every chat session");
    expect(out).toContain("Telegram");
    expect(out).toContain("Discord");
    expect(out).toContain("WhatsApp");
    expect(out).toContain("Slack");
    // Must not contain session-scoping rules that would confuse the bot
    expect(out).not.toContain("DISABLED");
    expect(out).not.toContain("session-scoped");
  });

  it("session mode instructs the bot to scope by session id", () => {
    const out = renderMemoryPromptSection("session");
    expect(out).toContain("## Memory: SESSION-SCOPED");
    expect(out).toContain("[CANVAS_STATE]");
    expect(out).toContain("Session: <id>");
    // Must tell the bot to pass scope_id explicitly
    expect(out).toContain("scope_id");
    expect(out).toContain("store_memory");
    expect(out).toContain("recall_memory");
    // Must forbid cross-session recall
    expect(out).toContain("Never claim to remember something from another session");
  });

  it("off mode tells the bot memory tools are no-ops", () => {
    const out = renderMemoryPromptSection("off");
    expect(out).toContain("## Memory: DISABLED");
    expect(out).toContain("Do NOT call");
    expect(out).toContain("store_memory");
    expect(out).toContain("recall_memory");
    expect(out).toContain("list_memories");
    expect(out).toContain("forget_memory");
    // Must tell the bot to explain to the user when asked to remember
    expect(out).toContain("memory is disabled");
  });

  it("produces distinct output for each mode", () => {
    const g = renderMemoryPromptSection("global");
    const s = renderMemoryPromptSection("session");
    const o = renderMemoryPromptSection("off");
    expect(g).not.toBe(s);
    expect(s).not.toBe(o);
    expect(g).not.toBe(o);
  });
});

describe("renderMemoryStateLine", () => {
  it("global mode emits a one-line global notice regardless of session id", () => {
    expect(renderMemoryStateLine("global", "abc")).toBe(
      "Memory: global (persists across all sessions and platforms)",
    );
    expect(renderMemoryStateLine("global", "")).toBe(
      "Memory: global (persists across all sessions and platforms)",
    );
    expect(renderMemoryStateLine("global", null)).toBe(
      "Memory: global (persists across all sessions and platforms)",
    );
  });

  it("off mode always renders a single 'off' line", () => {
    expect(renderMemoryStateLine("off", "abc")).toBe("Memory: off");
    expect(renderMemoryStateLine("off", null)).toBe("Memory: off");
  });

  it("session mode includes the session id", () => {
    const line = renderMemoryStateLine("session", "conv-xyz-123");
    expect(line).toContain("Memory: session-scoped");
    expect(line).toContain("Session: conv-xyz-123");
  });

  it("session mode falls back to 'unknown' if session id missing", () => {
    expect(renderMemoryStateLine("session", null)).toContain("Session: unknown");
    expect(renderMemoryStateLine("session", undefined)).toContain("Session: unknown");
    expect(renderMemoryStateLine("session", "")).toContain("Session: unknown");
  });

  it("session mode is multiline (mode + session id on separate lines)", () => {
    const line = renderMemoryStateLine("session", "abc");
    expect(line.split("\n")).toHaveLength(2);
  });
});

describe("injectMemoryStateLine", () => {
  const memoryLine = "Memory: global (persists across all sessions and platforms)";

  it("merges into an existing [CANVAS_STATE] block without stranding tags", () => {
    const input = "[CANVAS_STATE]\nfoo: bar\nbaz: qux\n[/CANVAS_STATE]\nhello";
    const out = injectMemoryStateLine(input, memoryLine);
    expect(out).toContain(`[CANVAS_STATE]\n${memoryLine}`);
    expect(out).toContain("foo: bar");
    expect(out).toContain("baz: qux");
    // Exactly one opening and one closing tag should remain
    expect(out.match(/\[CANVAS_STATE\]/g)).toHaveLength(1);
    expect(out.match(/\[\/CANVAS_STATE\]/g)).toHaveLength(1);
    expect(out.endsWith("hello")).toBe(true);
  });

  it("prepends a fresh block when no [CANVAS_STATE] is present", () => {
    const out = injectMemoryStateLine("just a user message", memoryLine);
    expect(out.startsWith(`[CANVAS_STATE]\n${memoryLine}\n[/CANVAS_STATE]\n`)).toBe(true);
    expect(out).toContain("just a user message");
  });

  it("handles multiline session memory lines", () => {
    const multilineMemory = "Memory: session-scoped\nSession: conv-abc";
    const out = injectMemoryStateLine("[CANVAS_STATE]\nexisting\n[/CANVAS_STATE]", multilineMemory);
    expect(out).toContain("Memory: session-scoped");
    expect(out).toContain("Session: conv-abc");
    expect(out).toContain("existing");
    expect(out.match(/\[\/CANVAS_STATE\]/g)).toHaveLength(1);
  });

  it("is idempotent enough to run twice without corrupting the block", () => {
    const once = injectMemoryStateLine("plain message", memoryLine);
    const twice = injectMemoryStateLine(once, memoryLine);
    // Both memory lines are present but only one pair of tags
    expect(twice.match(/\[CANVAS_STATE\]/g)).toHaveLength(1);
    expect(twice.match(/\[\/CANVAS_STATE\]/g)).toHaveLength(1);
    // The message body is preserved
    expect(twice).toContain("plain message");
  });

  it("ignores literal [CANVAS_STATE] substrings that are not paired with a close tag", () => {
    // Unpaired opening tag in user text — regex should NOT match, so we fall
    // through to the "prepend fresh block" branch and leave the user text alone.
    const userText = "I typed [CANVAS_STATE] as a joke";
    const out = injectMemoryStateLine(userText, memoryLine);
    expect(out.startsWith(`[CANVAS_STATE]\n${memoryLine}\n[/CANVAS_STATE]\n`)).toBe(true);
    expect(out).toContain("I typed [CANVAS_STATE] as a joke");
  });
});

// ---------------------------------------------------------------------------
// Route integration contract tests
// ---------------------------------------------------------------------------
// tamboAgent.ts and flowChat.ts both perform the same 3-step transformation:
//   1. normalizeMemoryScope(deployment.memoryScope)
//   2. renderMemoryStateLine(scope, sessionKey)
//   3. injectMemoryStateLine(message, memLine)
//
// These tests replicate that exact chain end-to-end so any change to the
// helper signatures or output format that would break the routes is caught
// here without needing to stand up Express or mock HTTP.
// ---------------------------------------------------------------------------
describe("route integration contract", () => {
  /**
   * Replicate the transformation chain used by tamboAgent.ts (line ~1178-1182)
   * and flowChat.ts (line ~478-481).
   */
  function applyRouteTransformChain(
    message: string,
    deploymentMemoryScope: unknown,
    sessionKey: string | null,
  ): string {
    const memScope = normalizeMemoryScope(deploymentMemoryScope);
    const memLine = renderMemoryStateLine(memScope, sessionKey);
    return injectMemoryStateLine(message, memLine);
  }

  // -- global mode ----------------------------------------------------------

  it("global mode: message gets [CANVAS_STATE] block with global memory line", () => {
    const result = applyRouteTransformChain("Hello agent", "global", "jarble-web-user123-conv-abc");

    expect(result).toContain("[CANVAS_STATE]");
    expect(result).toContain("[/CANVAS_STATE]");
    expect(result).toContain("Memory: global (persists across all sessions and platforms)");
    expect(result).toContain("Hello agent");

    // Global mode must NOT leak the session key into the memory line
    expect(result).not.toContain("Session:");
  });

  // -- session mode ---------------------------------------------------------

  it("session mode: message gets [CANVAS_STATE] block with session-scoped memory and session ID", () => {
    const sessionKey = "jarble-web-user123-conv-abc";
    const result = applyRouteTransformChain("What do you remember?", "session", sessionKey);

    expect(result).toContain("[CANVAS_STATE]");
    expect(result).toContain("[/CANVAS_STATE]");
    expect(result).toContain("Memory: session-scoped");
    expect(result).toContain(`Session: ${sessionKey}`);
    expect(result).toContain("What do you remember?");
  });

  // -- off mode -------------------------------------------------------------

  it("off mode: message gets [CANVAS_STATE] block with memory-off line", () => {
    const result = applyRouteTransformChain("Store this fact", "off", "jarble-web-user123-conv-abc");

    expect(result).toContain("[CANVAS_STATE]");
    expect(result).toContain("[/CANVAS_STATE]");
    expect(result).toContain("Memory: off");
    expect(result).toContain("Store this fact");

    // Off mode must not include any session or global qualifier
    expect(result).not.toContain("Session:");
    expect(result).not.toContain("persists across");
  });

  // -- missing / null memoryScope -------------------------------------------

  it("missing memoryScope defaults to global", () => {
    const result = applyRouteTransformChain("Hi", undefined, "jarble-web-user123-conv-abc");
    expect(result).toContain("Memory: global (persists across all sessions and platforms)");
  });

  it("null memoryScope defaults to global", () => {
    const result = applyRouteTransformChain("Hi", null, "jarble-web-user123-conv-abc");
    expect(result).toContain("Memory: global (persists across all sessions and platforms)");
  });

  // -- merging with existing [CANVAS_STATE] block ---------------------------

  it("merges memory line into existing [CANVAS_STATE] block from team context or canvas state", () => {
    // tamboAgent.ts builds messageWithVision with canvas context BEFORE memory
    // injection — the memory step must merge into the existing block, not create a second one.
    const messageWithExistingBlock =
      "[CANVAS_STATE]\nActive cards: chart-1, table-2\nSelected: chart-1\n[/CANVAS_STATE]\nUpdate the chart title";

    const result = applyRouteTransformChain(messageWithExistingBlock, "session", "jarble-web-u1-conv-x");

    // Memory line merged into the existing block
    expect(result).toContain("Memory: session-scoped");
    expect(result).toContain("Session: jarble-web-u1-conv-x");

    // Original canvas state preserved
    expect(result).toContain("Active cards: chart-1, table-2");
    expect(result).toContain("Selected: chart-1");

    // User message preserved
    expect(result).toContain("Update the chart title");

    // Exactly one [CANVAS_STATE] block — no duplicates
    expect(result.match(/\[CANVAS_STATE\]/g)).toHaveLength(1);
    expect(result.match(/\[\/CANVAS_STATE\]/g)).toHaveLength(1);
  });

  // -- sessionKey format verification ---------------------------------------

  it("session mode output contains the tamboAgent sessionKey format", () => {
    // tamboAgent.ts builds: `jarble-web-${userId}${convId ? `-${convId}` : ""}`
    const tamboSessionKey = "jarble-web-user123-conv-abc";
    const result = applyRouteTransformChain("test", "session", tamboSessionKey);
    expect(result).toContain(`Session: jarble-web-user123-conv-abc`);
  });

  it("session mode output contains the flowChat sessionKey format", () => {
    // flowChat.ts builds: `flow-${flowId}-${user.id}${conversationId ? `-${conversationId}` : ""}`
    const flowSessionKey = "flow-flow_abc123-auth0|user456-conv-789";
    const result = applyRouteTransformChain("test", "session", flowSessionKey);
    expect(result).toContain(`Session: flow-flow_abc123-auth0|user456-conv-789`);
  });

  // -- structural invariants ------------------------------------------------

  it("memory block always appears before the user message text", () => {
    const userText = "Please summarise our last conversation";
    const result = applyRouteTransformChain(userText, "global", "jarble-web-u1-c1");

    const canvasEnd = result.indexOf("[/CANVAS_STATE]");
    const messageStart = result.indexOf(userText);

    expect(canvasEnd).toBeGreaterThan(-1);
    expect(messageStart).toBeGreaterThan(-1);
    expect(canvasEnd).toBeLessThan(messageStart);
  });

  it("result always contains exactly one [CANVAS_STATE] open/close pair", () => {
    for (const scope of ["global", "session", "off", undefined, null, "bogus"]) {
      const result = applyRouteTransformChain("msg", scope, "jarble-web-u1-c1");
      expect(result.match(/\[CANVAS_STATE\]/g)).toHaveLength(1);
      expect(result.match(/\[\/CANVAS_STATE\]/g)).toHaveLength(1);
    }
  });
});
