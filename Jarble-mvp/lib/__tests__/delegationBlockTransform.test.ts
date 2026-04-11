import { describe, it, expect } from "vitest";
import {
  parseDelegationBody,
  transformDelegationBlocks,
  stripDelegationBlocks,
} from "../delegationBlockTransform";

// ─── parseDelegationBody ────────────────────────────────────────────────────

describe("parseDelegationBody", () => {
  it("parses the canonical { to, task } shape", () => {
    expect(parseDelegationBody('{ "to": "analyst", "task": "Summarize Q1" }')).toEqual({
      to: "analyst",
      task: "Summarize Q1",
      context: undefined,
    });
  });

  it("parses the reversed-order { task, to } shape (the old regex failed here)", () => {
    // This is the primary hole in the old regex at Deployments.tsx:4069,
    // MarkdownMessage.tsx:13, and ConversationHistoryPanel.tsx:37. LLMs
    // don't guarantee JSON field order and the regex required "to" before
    // "task". Parsing via JSON.parse makes this work regardless.
    expect(parseDelegationBody('{ "task": "Summarize Q1", "to": "analyst" }')).toEqual({
      to: "analyst",
      task: "Summarize Q1",
      context: undefined,
    });
  });

  it("parses a task containing curly braces (the old [^}]* regex failed here)", () => {
    const body = '{ "to": "analyst", "task": "render {foo: bar} as a card" }';
    expect(parseDelegationBody(body)).toEqual({
      to: "analyst",
      task: "render {foo: bar} as a card",
      context: undefined,
    });
  });

  it("parses a task containing escaped double quotes", () => {
    const body =
      '{ "to": "analyst", "task": "Say \\"hello\\" in French" }';
    expect(parseDelegationBody(body)).toEqual({
      to: "analyst",
      task: 'Say "hello" in French',
      context: undefined,
    });
  });

  it("parses optional context field", () => {
    const body =
      '{ "to": "analyst", "task": "Do X", "context": "prior results..." }';
    expect(parseDelegationBody(body)).toEqual({
      to: "analyst",
      task: "Do X",
      context: "prior results...",
    });
  });

  it("parses the legacy `delegate_to_X` tool format", () => {
    const body = '{ "tool": "delegate_to_specialist", "task": "Review this" }';
    expect(parseDelegationBody(body)).toEqual({
      to: "specialist",
      task: "Review this",
      context: undefined,
    });
  });

  it("returns null for malformed JSON", () => {
    expect(parseDelegationBody('{ "to": "analyst", "task":')).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseDelegationBody('{ "to": "analyst" }')).toBeNull();
    expect(parseDelegationBody('{ "task": "something" }')).toBeNull();
    expect(parseDelegationBody('{}')).toBeNull();
  });

  it("returns null when to/task have wrong types", () => {
    expect(parseDelegationBody('{ "to": 42, "task": "ok" }')).toBeNull();
    expect(parseDelegationBody('{ "to": "ok", "task": null }')).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseDelegationBody('"not an object"')).toBeNull();
    expect(parseDelegationBody("42")).toBeNull();
    expect(parseDelegationBody("[]")).toBeNull();
  });
});

// ─── transformDelegationBlocks ──────────────────────────────────────────────

describe("transformDelegationBlocks (inline format)", () => {
  it("transforms a canonical jarble_delegate block", () => {
    const input =
      'Let me check.\n\n```jarble_delegate\n{ "to": "analyst", "task": "Look at Q1 data" }\n```\n\nWaiting...';
    const out = transformDelegationBlocks(input);
    expect(out).toContain("Delegating to analyst: Look at Q1 data");
    expect(out).not.toContain("```jarble_delegate");
    expect(out).not.toContain('"to"');
  });

  it("transforms a reversed-field-order jarble_delegate block (Cycle 11 regression)", () => {
    const input =
      '```jarble_delegate\n{ "task": "Review this", "to": "critic" }\n```';
    const out = transformDelegationBlocks(input);
    expect(out).toContain("Delegating to critic: Review this");
    expect(out).not.toContain("```jarble_delegate");
    expect(out).not.toContain('"task"');
  });

  it("transforms a task containing curly braces", () => {
    const input =
      '```jarble_delegate\n{ "to": "renderer", "task": "render {\\"name\\": \\"x\\"} as json" }\n```';
    const out = transformDelegationBlocks(input);
    expect(out).toContain("Delegating to renderer:");
    expect(out).toContain('render');
    expect(out).not.toContain("```jarble_delegate");
  });

  it("truncates long tasks with an ellipsis at maxTaskChars", () => {
    const longTask = "x".repeat(200);
    const input = `\`\`\`jarble_delegate\n{ "to": "worker", "task": "${longTask}" }\n\`\`\``;
    const out = transformDelegationBlocks(input, { maxTaskChars: 50 });
    // Match at least 50 x's followed by ellipsis and NO more x's
    expect(out).toMatch(/Delegating to worker: x{50}…(?!x)/);
  });

  it("strips (rather than leaks) a malformed block", () => {
    const input =
      'plain text ```jarble_delegate\n{ "to": "broken", "task"}\n``` more text';
    const out = transformDelegationBlocks(input);
    expect(out).not.toContain("```jarble_delegate");
    expect(out).not.toContain('"to": "broken"');
    expect(out).toContain("plain text");
    expect(out).toContain("more text");
  });

  it("handles multiple delegation blocks in one message (broadcast pattern)", () => {
    const input =
      '```jarble_delegate\n{ "to": "a", "task": "do A" }\n```\n\n```jarble_delegate\n{ "to": "b", "task": "do B" }\n```';
    const out = transformDelegationBlocks(input);
    expect(out).toContain("Delegating to a: do A");
    expect(out).toContain("Delegating to b: do B");
  });

  it("leaves unrelated ```json blocks alone (delegate_to_X only)", () => {
    const input = '```json\n{ "foo": "bar" }\n```';
    const out = transformDelegationBlocks(input);
    // Non-delegation json blocks are left untouched
    expect(out).toContain("```json");
    expect(out).toContain('"foo"');
  });

  it("transforms legacy `delegate_to_X` json blocks", () => {
    const input =
      '```json\n{ "tool": "delegate_to_specialist", "task": "Hi" }\n```';
    const out = transformDelegationBlocks(input);
    expect(out).toContain("Delegating to specialist: Hi");
    expect(out).not.toContain("delegate_to_specialist");
  });
});

describe("transformDelegationBlocks (blockquote format)", () => {
  it("wraps the transformed block in Markdown > prefix", () => {
    const input =
      '```jarble_delegate\n{ "to": "analyst", "task": "Check data" }\n```';
    const out = transformDelegationBlocks(input, { format: "blockquote" });
    expect(out).toContain("> **Delegating to analyst:** Check data");
  });
});

// ─── stripDelegationBlocks ──────────────────────────────────────────────────

describe("stripDelegationBlocks", () => {
  it("strips a canonical jarble_delegate block entirely", () => {
    const input =
      'before\n\n```jarble_delegate\n{ "to": "x", "task": "y" }\n```\n\nafter';
    const out = stripDelegationBlocks(input);
    expect(out).not.toContain("jarble_delegate");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips legacy delegate_to_X json blocks", () => {
    const input =
      'prefix ```json\n{ "tool": "delegate_to_x", "task": "y" }\n``` suffix';
    const out = stripDelegationBlocks(input);
    expect(out).not.toContain("delegate_to_x");
    expect(out).toContain("prefix");
    expect(out).toContain("suffix");
  });

  it("preserves unrelated ```json code blocks", () => {
    const input = 'before ```json\n{ "data": [1,2,3] }\n``` after';
    const out = stripDelegationBlocks(input);
    expect(out).toContain("```json");
    expect(out).toContain('"data"');
  });

  it("handles a jarble_delegate block with reversed field order", () => {
    const input =
      '```jarble_delegate\n{ "task": "reversed", "to": "target" }\n```';
    const out = stripDelegationBlocks(input);
    expect(out).not.toContain("reversed");
    expect(out).not.toContain("target");
    expect(out).not.toContain("jarble_delegate");
  });

  it("handles a task containing curly braces", () => {
    const input =
      '```jarble_delegate\n{ "to": "r", "task": "render {foo: bar}" }\n```';
    const out = stripDelegationBlocks(input);
    expect(out).not.toContain("jarble_delegate");
    expect(out).not.toContain("{foo: bar}");
  });
});
