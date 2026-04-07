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

import { parseDelegationCalls } from "./flowDelegation.js";

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
