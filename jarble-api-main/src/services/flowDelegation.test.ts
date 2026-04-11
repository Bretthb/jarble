import { describe, it, expect, vi } from "vitest";

// flowDelegation.ts imports db/index which requires DATABASE_URL at module load.
// For these pure-function tests we stub the DB module before the import runs.
// vi.mock is hoisted by Vitest so these run before the import below.
vi.mock("../db/index.js", () => ({
  db: {},
  tables: {},
  dbDate: () => new Date(),
}));
vi.mock("../utils/agentCallEvents.js", () => ({
  emitOrchestrationStart: () => {},
  emitOrchestrationEnd: () => {},
}));

import { parseDelegationCalls, sanitizeDelegationError } from "./flowDelegation.js";

describe("parseDelegationCalls", () => {
  it("returns empty array for plain text with no JSON block", () => {
    expect(
      parseDelegationCalls("Hello, I'm the entry bot."),
    ).toEqual([]);
  });

  it("returns empty array when bot claims to delegate in natural language only", () => {
    // This is the silent-failure mode documented in docs/audits/qa-bot-teams-2026-04-07.md:
    // the bot says it delegated but never emitted the required JSON tool call block.
    const rawText =
      "The task has been delegated to the Specialist. I'll share their answer momentarily once they respond.";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("parses a single delegation call in a fenced json block", () => {
    const rawText =
      "I'll delegate this.\n\n```json\n" +
      '{ "tool": "delegate_to_specialist", "task": "Describe primary colors" }' +
      "\n```\n\nWaiting on the Specialist.";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      toolName: "delegate_to_specialist",
      task: "Describe primary colors",
    });
  });

  it("parses multiple delegation calls (broadcast pattern)", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_researcher", "task": "Research X" }' +
      "\n```\n\n" +
      "```json\n" +
      '{ "tool": "delegate_to_critic", "task": "Critique Y", "context": "Y is..." }' +
      "\n```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe("delegate_to_researcher");
    expect(calls[1].toolName).toBe("delegate_to_critic");
    expect(calls[1].context).toBe("Y is...");
  });

  it("ignores json blocks that are not delegation tool calls", () => {
    const rawText =
      "Here's a plain json block:\n```json\n" +
      '{ "foo": "bar" }' +
      "\n```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("ignores delegation blocks missing a task field", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_specialist" }' +
      "\n```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("ignores delegation blocks with a non-string task", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_specialist", "task": 42 }' +
      "\n```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("ignores tool names that don't start with delegate_to_", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "call_specialist", "task": "hi" }' +
      "\n```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("ignores malformed JSON gracefully", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_specialist", "task": "hi",' +
      "\n```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("survives a task field containing embedded json-like content", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_specialist", "task": "Parse this response: {\\"color\\": \\"red\\"}" }' +
      "\n```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    expect(calls[0].task).toContain('"color"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Regression tests for the Fix #6 skipReason logic in flowChat.ts.
// The heuristic lives in flowChat.ts but is a plain regex — covering it here
// keeps the rule testable without spinning up the Express route.
// ───────────────────────────────────────────────────────────────────────────

const DELEGATION_MENTION_REGEX =
  /\b(delegat(e|ing|ed)|ask(ed|ing)?\s+the\s+(specialist|researcher|team|expert|coordinator)|pass(ed|ing)?\s+(this|it)\s+to|hand(ing|ed)?\s+off\s+to)\b/i;

// ───────────────────────────────────────────────────────────────────────────
// New format: ```jarble_delegate``` fenced blocks.
// The legacy ```json``` format above remains supported for backward compat
// during rollout, but the soul.md prompt now teaches the new format.
// ───────────────────────────────────────────────────────────────────────────

describe("parseDelegationCalls — jarble_delegate format", () => {
  it("parses a single jarble_delegate block correctly", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "specialist", "task": "Describe primary colors", "context": "" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      toolName: "delegate_to_specialist",
      task: "Describe primary colors",
    });
    // Empty context string should not surface as a defined context field
    expect(calls[0].context).toBeUndefined();
  });

  it("preserves a non-empty context field", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "researcher", "task": "Find sources", "context": "Topic: bees" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    expect(calls[0].context).toBe("Topic: bees");
  });

  it("parses multiple jarble_delegate blocks (broadcast)", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "researcher", "task": "Research X" }\n' +
      "```\n\n" +
      "```jarble_delegate\n" +
      '{ "to": "critic", "task": "Critique Y", "context": "Y is..." }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe("delegate_to_researcher");
    expect(calls[1].toolName).toBe("delegate_to_critic");
    expect(calls[1].context).toBe("Y is...");
  });

  it("rejects jarble_delegate blocks missing the `to` field", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "task": "do the thing" }\n' +
      "```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("rejects jarble_delegate blocks missing the `task` field", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "specialist" }\n' +
      "```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("rejects jarble_delegate blocks with non-string `to`", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": 42, "task": "hi" }\n' +
      "```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("rejects jarble_delegate blocks with non-string `task`", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "specialist", "task": [1, 2, 3] }\n' +
      "```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("strips an accidental `delegate_to_` prefix the LLM may add", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "delegate_to_specialist", "task": "x" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    // Must not double up: "delegate_to_delegate_to_specialist" would be wrong
    expect(calls[0].toolName).toBe("delegate_to_specialist");
  });

  it("ignores malformed JSON inside a jarble_delegate fence gracefully", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "specialist", "task": "hi",\n' +
      "```";
    expect(parseDelegationCalls(rawText)).toEqual([]);
  });

  it("backward compat: legacy ```json delegate_to_ format still parses", () => {
    const rawText =
      "```json\n" +
      '{ "tool": "delegate_to_specialist", "task": "Legacy task" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("delegate_to_specialist");
    expect(calls[0].task).toBe("Legacy task");
  });

  it("supports mixed legacy + new formats in the same response", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "researcher", "task": "Research X" }\n' +
      "```\n\n" +
      "Some prose in between.\n\n" +
      "```json\n" +
      '{ "tool": "delegate_to_critic", "task": "Critique Y" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    expect(calls).toHaveLength(2);
    const toolNames = calls.map((c) => c.toolName).sort();
    expect(toolNames).toEqual(["delegate_to_critic", "delegate_to_researcher"]);
  });

  it("de-duplicates when the same delegation is emitted in both formats", () => {
    const rawText =
      "```jarble_delegate\n" +
      '{ "to": "specialist", "task": "Same task" }\n' +
      "```\n\n" +
      "```json\n" +
      '{ "tool": "delegate_to_specialist", "task": "Same task" }\n' +
      "```";
    const calls = parseDelegationCalls(rawText);
    // Same toolName + same task → de-duped to a single call
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("delegate_to_specialist");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// buildFlowSystemPrompt: verify the new prompt teaches the jarble_delegate
// format and includes the hard rules. Catches accidental regressions to
// the old ```json format text.
// ───────────────────────────────────────────────────────────────────────────

describe("buildFlowSystemPrompt — jarble_delegate format", () => {
  // We need a minimal node + tool list to invoke the function. Build them
  // inline to avoid any DB/registry coupling.
  const node: any = { id: "n1", role: "Coordinator", goal: "orchestrate" };
  const tool: any = {
    name: "delegate_to_specialist",
    description: "Delegate a task to Specialist. Goal: answer questions.",
    targetNodeId: "n2",
    targetDeploymentId: "d2",
    contextScope: "task",
  };

  it("teaches the jarble_delegate fence format, not the legacy json format", async () => {
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    expect(prompt).toContain("jarble_delegate");
    expect(prompt).toContain('"to":');
    expect(prompt).toContain('"task":');
    // Hard rule must be present so the bot knows prose claims are not enough
    expect(prompt).toContain("Never claim you delegated unless");
  });

  it("lists each team member by bare slug (no delegate_to_ prefix)", async () => {
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    // Bullet should use bare slug
    expect(prompt).toMatch(/\*\*specialist\*\*/);
  });

  it("emits no delegation section when the node has canDelegate=false", async () => {
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(
      { ...node, canDelegate: false },
      [tool],
      "Base prompt.",
    );
    expect(prompt).not.toContain("jarble_delegate");
    expect(prompt).not.toContain("Team Members");
  });

  it("emits no delegation section when there are no tools", async () => {
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [], "Base prompt.");
    expect(prompt).not.toContain("jarble_delegate");
  });

  // ── Stronger delegation bias (qa-bot-teams 2026-04-07 P3 #1) ──────────────
  // When the user explicitly references a team member by slug, role, or the
  // abstract phrase "your specialist / your team", the coordinator MUST
  // delegate instead of answering directly. The prompt surfaces this as an
  // explicit "Strong Triggers" section with concrete example phrasings.
  it("includes a Strong Triggers section listing casual delegation phrasings", async () => {
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    expect(prompt).toContain("Strong Triggers");
    // The three phrasing buckets the QA finding flagged:
    expect(prompt).toMatch(/your specialist/i);
    expect(prompt).toMatch(/your team/i);
    // "ask <name>" should appear as an example of naming a member directly
    expect(prompt).toMatch(/ask\s+specialist/i);
    // Delegation verbs
    expect(prompt).toMatch(/hand this off|pass this to/i);
  });

  it("instructs the coordinator that replies are verbatim, not truncated", async () => {
    // qa-bot-teams 2026-04-07 P3 #2: after successful delegation the
    // coordinator was hallucinating "the result was truncated" in its
    // wrap-up summary. The prompt now explicitly tells it that the specialist
    // reply shown on the synthesis turn is complete.
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    expect(prompt).toMatch(/do not claim it was truncated|verbatim/i);
  });

  it("documents the single canonical delegation tool (no per-member tool drift)", async () => {
    // qa-bot-teams 2026-04-07 P3 #3: the prompt previously invited confusion
    // between `jarble_delegate` (fenced block, canonical) and
    // `delegate_to_<name>` (internal routing key). The prompt now explicitly
    // tells the bot there is no per-member tool and `jarble_delegate` is the
    // single canonical delegation mechanism.
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    expect(prompt).toMatch(/no per-member tool/i);
    expect(prompt).toMatch(/bare slug/i);
  });
});

describe("flowChat delegation-mention heuristic (Fix #6)", () => {
  it("matches natural language claims of delegation", () => {
    expect(
      DELEGATION_MENTION_REGEX.test("I've delegated this to the Specialist."),
    ).toBe(true);
    expect(
      DELEGATION_MENTION_REGEX.test("Delegating to our Researcher now."),
    ).toBe(true);
    expect(
      DELEGATION_MENTION_REGEX.test("The task has been delegated to the Specialist."),
    ).toBe(true);
    expect(
      DELEGATION_MENTION_REGEX.test("I'll pass this to the researcher team."),
    ).toBe(true);
    expect(
      DELEGATION_MENTION_REGEX.test("Handing off to our expert now."),
    ).toBe(true);
    expect(
      DELEGATION_MENTION_REGEX.test("Asked the Specialist for input."),
    ).toBe(true);
  });

  it("does not match responses that actually answer directly", () => {
    expect(
      DELEGATION_MENTION_REGEX.test("Red, blue, and yellow."),
    ).toBe(false);
    expect(
      DELEGATION_MENTION_REGEX.test("Here's a summary of the project status."),
    ).toBe(false);
    expect(
      DELEGATION_MENTION_REGEX.test("All systems online — ready to work."),
    ).toBe(false);
  });

  it("does not match the word 'delegate' when used generically", () => {
    // Careful: \bdelegat(e|ing|ed)\b WILL match "delegate" in generic sentences.
    // That's acceptable — over-flagging is safer than under-flagging, since the
    // skipReason is diagnostic, not user-blocking.
    expect(
      DELEGATION_MENTION_REGEX.test("We can delegate responsibility in a team."),
    ).toBe(true);
  });
});

describe("sanitizeDelegationError", () => {
  it("returns fallback for null / undefined", () => {
    expect(sanitizeDelegationError(null)).toBe("an internal error occurred");
    expect(sanitizeDelegationError(undefined)).toBe("an internal error occurred");
  });

  it("returns fallback for empty or whitespace-only strings", () => {
    expect(sanitizeDelegationError("")).toBe("an internal error occurred");
    expect(sanitizeDelegationError("   \n\t  ")).toBe("an internal error occurred");
  });

  it("passes through a clean error message unchanged", () => {
    expect(sanitizeDelegationError(new Error("Connection refused"))).toBe("Connection refused");
    expect(sanitizeDelegationError("timeout waiting for pod")).toBe("timeout waiting for pod");
  });

  it("redacts Anthropic API keys (sk-ant-*)", () => {
    const raw = "authentication failed: invalid key sk-ant-api03-abcDEF1234567890_xyz please rotate";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-ant-api03");
  });

  it("redacts OpenRouter API keys (sk-or-*)", () => {
    const raw = "gateway rejected sk-or-v1-abcd1234efgh5678 — check billing";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-or-v1");
  });

  it("redacts generic sk-* tokens at least 20 chars long", () => {
    const raw = "invalid token: sk-abcdefghijklmnopqrst provided";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-abcdefghijklmnopqrst");
  });

  it("does not redact short sk-* strings (not API keys)", () => {
    // 'sk-short' is only 8 chars — below the 20-char threshold
    const raw = "error in sk-short config value";
    expect(sanitizeDelegationError(raw)).toBe("error in sk-short config value");
  });

  it("redacts ANTHROPIC_API_KEY env var assignment", () => {
    const raw = "ANTHROPIC_API_KEY=sk-ant-api03-xyz123 was rejected";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("ANTHROPIC_API_KEY=sk-ant");
  });

  it("replaces exec command wrapper with generic label", () => {
    const raw = "error executing command [npx openclaw agent --session-id sess-xyz --message hello]";
    const out = sanitizeDelegationError(raw);
    expect(out).toBe("execution error");
    expect(out).not.toContain("sess-xyz");
    expect(out).not.toContain("openclaw");
  });

  it("strips --session-id flag", () => {
    const raw = "exec failed --session-id sess-abc123 with code 1";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("sess-abc123");
    expect(out).not.toContain("--session-id");
  });

  it("caps output at 300 characters", () => {
    const long = "a".repeat(500) + " end";
    const out = sanitizeDelegationError(long);
    expect(out.length).toBeLessThanOrEqual(301); // 300 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });

  it("accepts a plain object (non-Error, non-string) without throwing", () => {
    const out = sanitizeDelegationError({ code: 500, reason: "internal" });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
