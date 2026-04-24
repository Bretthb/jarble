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

import {
  buildDelegationTools,
  parseDelegationCalls,
  DelegationCycleError,
  DelegationDepthExceededError,
  getMaxDelegationDepth,
  wouldExceedDepth,
  enforceDelegationDepth,
  wouldCreateCycle,
  enforceNoCycle,
  sanitizeDelegationError,
} from "./flowDelegation.js";

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
    // Phase 3: the prompt now tells the bot to prefer the a2a_delegate MCP
    // tool over hand-writing fenced blocks. The tool is the canonical
    // delegation mechanism; the fenced block is the fallback. Both are
    // documented in the prompt so the bot knows both paths.
    const { buildFlowSystemPrompt } = await import("./flowDelegation.js");
    const prompt = buildFlowSystemPrompt(node, [tool], "Base prompt.");
    expect(prompt).toMatch(/a2a_delegate/i);
    expect(prompt).toMatch(/bare slug/i);
    // Fenced block is still documented as fallback
    expect(prompt).toMatch(/jarble_delegate/i);
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

// ───────────────────────────────────────────────────────────────────────────
// Cycle 4: Collaborative (bidirectional) edge semantics.
// Regression guards for the `collaborates` edge type — a single edge between
// A and B must build delegation tools for BOTH A→B AND B→A. Also covers the
// two wire formats the UI uses (edge.type vs edge.label), the canDelegate=false
// interaction, and the cycle-detection constructor invariants.
// ───────────────────────────────────────────────────────────────────────────

describe("buildDelegationTools — collaborates edge (Cycle 4)", () => {
  const A: any = {
    id: "A",
    type: "deployment",
    deploymentId: "dep-A",
    label: "Peer A",
    role: "Researcher",
    goal: "Gather facts",
    position: { x: 0, y: 0 },
  };
  const B: any = {
    id: "B",
    type: "deployment",
    deploymentId: "dep-B",
    label: "Peer B",
    role: "Critic",
    goal: "Find flaws",
    position: { x: 100, y: 0 },
  };

  it("builds a B-targeted tool for A from a single collaborates edge", () => {
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", type: "collaborates" },
    ];
    const tools = buildDelegationTools(A, [A, B], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("B");
    expect(tools[0].targetDeploymentId).toBe("dep-B");
    expect(tools[0].name).toBe("delegate_to_critic");
  });

  it("builds an A-targeted tool for B from the SAME collaborates edge", () => {
    // This is the key bidirectional invariant — a single edge must be walked
    // twice, once from each end, producing distinct tools pointing the
    // opposite direction.
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", type: "collaborates" },
    ];
    const tools = buildDelegationTools(B, [A, B], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("A");
    expect(tools[0].targetDeploymentId).toBe("dep-A");
    expect(tools[0].name).toBe("delegate_to_researcher");
  });

  it("honors the UI wire format (edge.label instead of edge.type)", () => {
    // The canvas saves edgeType into both `type` and `label`, but the
    // getEdgeType fallback reads `type || label`. Test that a label-only
    // edge still triggers bidirectional tool building.
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", label: "collaborates" },
    ];
    expect(buildDelegationTools(A, [A, B], edges)[0]?.targetNodeId).toBe("B");
    expect(buildDelegationTools(B, [A, B], edges)[0]?.targetNodeId).toBe("A");
  });

  it("respects canDelegate=false on the source even for collaborates", () => {
    // canDelegate=false is a "can I delegate" gate, not a "can I be targeted"
    // gate. So if A is locked (canDelegate=false) but B can still delegate,
    // A's tool list is empty, but B's tool list still contains A.
    const lockedA = { ...A, canDelegate: false };
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", type: "collaborates" },
    ];
    expect(buildDelegationTools(lockedA, [lockedA, B], edges)).toEqual([]);
    // B is still free to delegate to A
    const bTools = buildDelegationTools(B, [lockedA, B], edges);
    expect(bTools).toHaveLength(1);
    expect(bTools[0].targetNodeId).toBe("A");
  });

  it("skips a self-loop collaborates edge", () => {
    const selfEdge: any[] = [
      { id: "e1", source: "A", target: "A", type: "collaborates" },
    ];
    expect(buildDelegationTools(A, [A], selfEdge)).toEqual([]);
  });

  it("de-dupes when a delegates edge AND a collaborates edge both point to B", () => {
    // If the user wired a delegates edge AND a collaborates edge between A
    // and B, A should NOT build two tools for B. The `tools.some(...)` guard
    // at line 172 enforces this.
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", type: "delegates" },
      { id: "e2", source: "A", target: "B", type: "collaborates" },
    ];
    const tools = buildDelegationTools(A, [A, B], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("B");
  });

  it("builds a three-way peer mesh (A↔B, B↔C, A↔C) with 2 tools per node", () => {
    const C: any = {
      id: "C",
      type: "deployment",
      deploymentId: "dep-C",
      label: "Peer C",
      role: "Synthesizer",
      position: { x: 200, y: 0 },
    };
    const edges: any[] = [
      { id: "e1", source: "A", target: "B", type: "collaborates" },
      { id: "e2", source: "B", target: "C", type: "collaborates" },
      { id: "e3", source: "A", target: "C", type: "collaborates" },
    ];
    const aTools = buildDelegationTools(A, [A, B, C], edges);
    const bTools = buildDelegationTools(B, [A, B, C], edges);
    const cTools = buildDelegationTools(C, [A, B, C], edges);

    expect(aTools.map((t) => t.targetNodeId).sort()).toEqual(["B", "C"]);
    expect(bTools.map((t) => t.targetNodeId).sort()).toEqual(["A", "C"]);
    expect(cTools.map((t) => t.targetNodeId).sort()).toEqual(["A", "B"]);
  });

  it("skips nodes whose deploymentId is missing (orphan targets)", () => {
    // A collaborates edge pointing at a node that has no deploymentId must
    // not produce a tool — there's nothing callable on the other end.
    const orphan: any = { id: "orphan", type: "deployment", label: "Orphan", position: { x: 0, y: 0 } };
    const edges: any[] = [
      { id: "e1", source: "A", target: "orphan", type: "collaborates" },
    ];
    expect(buildDelegationTools(A, [A, orphan], edges)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cycle 5: Reports (org-chart) edge semantics.
// A `reports` edge from A to B means "A reports to B" — A is the reporter,
// B is the manager. In delegation terms the code intentionally makes this
// bidirectional: the reporter can hand info up (A delegates to B) AND the
// manager can delegate tasks down (B delegates to A). This is the exact
// behavior collaborates has, so these tests also pin the "reports ≡
// collaborates behaviorally" invariant so any future divergence is caught.
// ───────────────────────────────────────────────────────────────────────────

describe("buildDelegationTools — reports edge (Cycle 5)", () => {
  const REPORTER: any = {
    id: "junior",
    type: "deployment",
    deploymentId: "dep-junior",
    label: "Junior",
    role: "Junior Engineer",
    goal: "Write code",
    position: { x: 0, y: 100 },
  };
  const MANAGER: any = {
    id: "senior",
    type: "deployment",
    deploymentId: "dep-senior",
    label: "Senior",
    role: "Senior Engineer",
    goal: "Review and assign work",
    position: { x: 0, y: 0 },
  };

  it("reporter (source) builds a tool to manager (target) — upward path", () => {
    // junior --reports--> senior
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
    ];
    const tools = buildDelegationTools(REPORTER, [REPORTER, MANAGER], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("senior");
    expect(tools[0].targetDeploymentId).toBe("dep-senior");
    expect(tools[0].name).toBe("delegate_to_senior_engineer");
  });

  it("manager (target) builds a tool to reporter (source) — downward path", () => {
    // Same edge junior --reports--> senior, but now we build from senior's
    // perspective. The filter flips the target so the manager delegates down.
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
    ];
    const tools = buildDelegationTools(MANAGER, [REPORTER, MANAGER], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("junior");
    expect(tools[0].targetDeploymentId).toBe("dep-junior");
    expect(tools[0].name).toBe("delegate_to_junior_engineer");
  });

  it("reports ≡ collaborates in tool-building invariant (behavioral parity)", () => {
    // If a user labels an edge "reports" vs "collaborates", the tool-building
    // output must be identical (both ends, both names, both descriptions).
    // This test guards against a future well-intentioned change that
    // accidentally makes reports one-way without also updating the filter.
    const reportsEdges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
    ];
    const collabEdges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "collaborates" },
    ];

    const juniorReports = buildDelegationTools(REPORTER, [REPORTER, MANAGER], reportsEdges);
    const juniorCollab = buildDelegationTools(REPORTER, [REPORTER, MANAGER], collabEdges);
    const seniorReports = buildDelegationTools(MANAGER, [REPORTER, MANAGER], reportsEdges);
    const seniorCollab = buildDelegationTools(MANAGER, [REPORTER, MANAGER], collabEdges);

    expect(juniorReports.length).toBe(juniorCollab.length);
    expect(seniorReports.length).toBe(seniorCollab.length);
    expect(juniorReports[0]?.targetNodeId).toBe(juniorCollab[0]?.targetNodeId);
    expect(seniorReports[0]?.targetNodeId).toBe(seniorCollab[0]?.targetNodeId);
  });

  it("canDelegate=false on reporter blocks upward, manager still delegates down", () => {
    const lockedJunior = { ...REPORTER, canDelegate: false };
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
    ];
    // Junior can't delegate anywhere
    expect(buildDelegationTools(lockedJunior, [lockedJunior, MANAGER], edges)).toEqual([]);
    // Senior can still delegate down to junior
    const seniorTools = buildDelegationTools(MANAGER, [lockedJunior, MANAGER], edges);
    expect(seniorTools).toHaveLength(1);
    expect(seniorTools[0].targetNodeId).toBe("junior");
  });

  it("canDelegate=false on manager blocks downward, reporter still reports up", () => {
    const lockedSenior = { ...MANAGER, canDelegate: false };
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
    ];
    // Senior can't delegate anywhere
    expect(buildDelegationTools(lockedSenior, [REPORTER, lockedSenior], edges)).toEqual([]);
    // Junior can still report up to senior
    const juniorTools = buildDelegationTools(REPORTER, [REPORTER, lockedSenior], edges);
    expect(juniorTools).toHaveLength(1);
    expect(juniorTools[0].targetNodeId).toBe("senior");
  });

  it("honors the UI wire format (edge.label instead of edge.type)", () => {
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", label: "reports" },
    ];
    expect(
      buildDelegationTools(REPORTER, [REPORTER, MANAGER], edges)[0]?.targetNodeId,
    ).toBe("senior");
    expect(
      buildDelegationTools(MANAGER, [REPORTER, MANAGER], edges)[0]?.targetNodeId,
    ).toBe("junior");
  });

  it("skips a self-loop reports edge", () => {
    const edges: any[] = [
      { id: "e1", source: "junior", target: "junior", type: "reports" },
    ];
    expect(buildDelegationTools(REPORTER, [REPORTER], edges)).toEqual([]);
  });

  it("builds a 3-level org chart: intern → junior → senior", () => {
    const INTERN: any = {
      id: "intern",
      type: "deployment",
      deploymentId: "dep-intern",
      label: "Intern",
      role: "Intern",
      position: { x: 0, y: 200 },
    };
    const edges: any[] = [
      { id: "e1", source: "intern", target: "junior", type: "reports" },
      { id: "e2", source: "junior", target: "senior", type: "reports" },
    ];
    // Intern reports only to junior (its direct manager)
    const internTools = buildDelegationTools(INTERN, [INTERN, REPORTER, MANAGER], edges);
    expect(internTools.map((t) => t.targetNodeId).sort()).toEqual(["junior"]);

    // Junior sits in the middle — reports up to senior AND can delegate
    // down to intern. Both edges match, so junior gets 2 tools.
    const juniorTools = buildDelegationTools(REPORTER, [INTERN, REPORTER, MANAGER], edges);
    expect(juniorTools.map((t) => t.targetNodeId).sort()).toEqual(["intern", "senior"]);

    // Senior can delegate down to junior (but not to intern directly —
    // there's no senior↔intern edge, delegation isn't transitive through
    // the graph at tool-build time)
    const seniorTools = buildDelegationTools(MANAGER, [INTERN, REPORTER, MANAGER], edges);
    expect(seniorTools.map((t) => t.targetNodeId).sort()).toEqual(["junior"]);
  });

  it("de-dupes when a reports edge AND a delegates edge both point junior→senior", () => {
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
      { id: "e2", source: "junior", target: "senior", type: "delegates" },
    ];
    // First match wins (reports, in iteration order). Second is de-duped.
    const tools = buildDelegationTools(REPORTER, [REPORTER, MANAGER], edges);
    expect(tools).toHaveLength(1);
    expect(tools[0].targetNodeId).toBe("senior");
  });

  it("counter-direction edges: junior→senior reports + senior→junior delegates", () => {
    // The legacy pattern where someone wires a reports edge for the visual
    // cue AND a separate delegates edge for the manager→reporter direction.
    // With the new bidirectional reports semantics this is redundant, but
    // it must not break (no errors, no extra tools, correct de-dup).
    const edges: any[] = [
      { id: "e1", source: "junior", target: "senior", type: "reports" },
      { id: "e2", source: "senior", target: "junior", type: "delegates" },
    ];
    // Junior: the reports edge gives tool to senior. The senior→junior
    // delegates edge doesn't match (junior is not source). 1 tool.
    const juniorTools = buildDelegationTools(REPORTER, [REPORTER, MANAGER], edges);
    expect(juniorTools.map((t) => t.targetNodeId)).toEqual(["senior"]);
    // Senior: the reports edge flip gives tool to junior. The delegates
    // edge also gives tool to junior (senior is source). De-duped to 1.
    const seniorTools = buildDelegationTools(MANAGER, [REPORTER, MANAGER], edges);
    expect(seniorTools.map((t) => t.targetNodeId)).toEqual(["junior"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DelegationCycleError & DelegationDepthExceededError — surface is stable
// and the error messages are sanitized (no raw exec output, no stack traces
// leaked). These errors bubble up to the user as-is in some code paths, so
// the message shape is part of the contract.
// ───────────────────────────────────────────────────────────────────────────

describe("DelegationCycleError / DelegationDepthExceededError contract (Cycle 4)", () => {
  it("DelegationCycleError exposes chain + target and has a useful message", () => {
    const err = new DelegationCycleError(["dep-A", "dep-B"], "dep-A");
    expect(err.name).toBe("DelegationCycleError");
    expect(err.chain).toEqual(["dep-A", "dep-B"]);
    expect(err.target).toBe("dep-A");
    expect(err.message).toContain("Delegation cycle detected");
    expect(err.message).toContain("dep-A");
    expect(err.message).toContain("dep-B");
    // Must not leak internal stack frames or shell fragments
    expect(err.message).not.toMatch(/npx openclaw|kubectl|exec command/i);
  });

  it("DelegationDepthExceededError exposes depth + maxDepth and respects env override", () => {
    const err = new DelegationDepthExceededError(9);
    expect(err.name).toBe("DelegationDepthExceededError");
    expect(err.depth).toBe(9);
    expect(err.maxDepth).toBe(getMaxDelegationDepth());
    expect(err.message).toContain("Delegation depth limit reached");
    expect(err.message).toContain("depth=9");
  });

  it("cycle chain with 4 hops renders the full chain in the message", () => {
    const chain = ["dep-A", "dep-B", "dep-C", "dep-D"];
    const err = new DelegationCycleError(chain, "dep-A");
    // A → B → C → D → A must appear in the rendered message
    for (const id of chain) {
      expect(err.message).toContain(id);
    }
    // Arrow between hops exists
    expect(err.message).toContain("→");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cycle 6: Delegation depth limit enforcement.
// Tests the pure boundary check helpers `wouldExceedDepth` and
// `enforceDelegationDepth`. These wrap the single `depth > MAX` arithmetic
// used by both call sites in executeDelegation (top-level throw path and
// sub-delegation graceful-refusal path). Keeping the check in a pure
// helper lets us pin the boundary behavior without mocking db + exec +
// agent_calls + budget checks.
// ───────────────────────────────────────────────────────────────────────────

describe("delegation depth limit (Cycle 6)", () => {
  // Default MAX_DELEGATION_DEPTH is 4 unless JARBLE_MAX_DELEGATION_DEPTH
  // is set to a different positive integer in the test env. We cache it
  // here so the tests stay correct if someone bumps the default later.
  const MAX = getMaxDelegationDepth();

  it("has a sane default max depth (4 unless env override)", () => {
    // This is a smoke test — if the default is bumped intentionally,
    // update the expected value below in the same PR.
    expect(MAX).toBeGreaterThanOrEqual(1);
    expect(MAX).toBeLessThan(20);
  });

  it("wouldExceedDepth passes for depth = 0 (entry before any hop)", () => {
    expect(wouldExceedDepth(0)).toBe(false);
  });

  it("wouldExceedDepth passes for depth = 1 (first delegation hop)", () => {
    expect(wouldExceedDepth(1)).toBe(false);
  });

  it("wouldExceedDepth passes at the boundary (depth === MAX)", () => {
    // With MAX=4 the chain can go four hops deep. The fourth hop is
    // allowed; the fifth is rejected. Strict > semantics.
    expect(wouldExceedDepth(MAX)).toBe(false);
  });

  it("wouldExceedDepth fails one past the boundary (depth === MAX + 1)", () => {
    expect(wouldExceedDepth(MAX + 1)).toBe(true);
  });

  it("wouldExceedDepth fails for arbitrarily deep chains", () => {
    expect(wouldExceedDepth(MAX + 10)).toBe(true);
    expect(wouldExceedDepth(100)).toBe(true);
  });

  it("enforceDelegationDepth allows depth 0..MAX without throwing", () => {
    for (let d = 0; d <= MAX; d++) {
      expect(() => enforceDelegationDepth(d)).not.toThrow();
    }
  });

  it("enforceDelegationDepth throws DelegationDepthExceededError at MAX + 1", () => {
    expect(() => enforceDelegationDepth(MAX + 1)).toThrow(
      DelegationDepthExceededError,
    );
  });

  it("enforceDelegationDepth preserves the attempted depth on the thrown error", () => {
    try {
      enforceDelegationDepth(MAX + 3);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DelegationDepthExceededError);
      expect((err as DelegationDepthExceededError).depth).toBe(MAX + 3);
      expect((err as DelegationDepthExceededError).maxDepth).toBe(MAX);
    }
  });

  it("thrown error message mentions the attempted depth and max — no raw exec leak", () => {
    try {
      enforceDelegationDepth(MAX + 1);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("Delegation depth limit reached");
      expect(msg).toContain(String(MAX + 1));
      expect(msg).toContain(String(MAX));
      expect(msg).toContain("JARBLE_MAX_DELEGATION_DEPTH");
      // Must never leak shell/exec fragments through the error path
      expect(msg).not.toMatch(/npx openclaw|kubectl|exec command/i);
    }
  });

  it("sub-delegation boundary: wouldExceedDepth(depth + 1) at MAX - 1 allows next hop", () => {
    // Mirrors the sub-delegation pre-check at flowDelegation.ts:1058:
    //   if (wouldExceedDepth(depth + 1)) { refuse gracefully }
    // When current depth is MAX - 1, the next hop (MAX) is still allowed.
    const currentDepth = MAX - 1;
    expect(wouldExceedDepth(currentDepth + 1)).toBe(false);
  });

  it("sub-delegation boundary: wouldExceedDepth(depth + 1) at MAX refuses next hop", () => {
    // When current depth is MAX, the next hop (MAX + 1) is refused.
    const currentDepth = MAX;
    expect(wouldExceedDepth(currentDepth + 1)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cycle 7: Delegation cycle detection.
// Tests the pure cycle-check helpers `wouldCreateCycle` and `enforceNoCycle`.
// Extraction parallel to the Cycle 6 depth helpers — the check is literally
// `ancestors.includes(targetDeploymentId)` but pinning the semantics lets
// us document the deploymentId-based (not nodeId-based) matching and the
// case-sensitive comparison so any future refactor can't silently break
// either invariant.
// ───────────────────────────────────────────────────────────────────────────

describe("delegation cycle detection (Cycle 7)", () => {
  it("wouldCreateCycle returns false for an empty ancestors list", () => {
    // Vacuous — the first hop in any chain is always allowed. This is
    // what `flowChat.ts` passes in as `ancestorDeploymentIds: [entry]`
    // on the very first executeDelegation call.
    expect(wouldCreateCycle([], "dep-A")).toBe(false);
  });

  it("wouldCreateCycle returns false when target is not in ancestors", () => {
    expect(wouldCreateCycle(["dep-A", "dep-B", "dep-C"], "dep-D")).toBe(false);
  });

  it("wouldCreateCycle returns true for direct self-delegation (single ancestor === target)", () => {
    // A bot trying to call itself from the entry position: the entry
    // bot's own deploymentId is in ancestors and the target IS that
    // deploymentId → cycle.
    expect(wouldCreateCycle(["dep-A"], "dep-A")).toBe(true);
  });

  it("wouldCreateCycle returns true when target is the most recent ancestor", () => {
    // The A→B→A pattern — bot B tries to bounce back to its immediate
    // parent A. Classic two-hop cycle.
    expect(wouldCreateCycle(["dep-A", "dep-B"], "dep-A")).toBe(true);
  });

  it("wouldCreateCycle returns true when target is in the middle of a long chain", () => {
    // A→B→C→D wants to call B → goes back two steps. Still a cycle.
    expect(
      wouldCreateCycle(["dep-A", "dep-B", "dep-C", "dep-D"], "dep-B"),
    ).toBe(true);
  });

  it("wouldCreateCycle tolerates a malformed duplicated ancestors list", () => {
    // Paranoia: if something upstream accidentally passes [A, A] as
    // ancestors, the check still works.
    expect(wouldCreateCycle(["dep-A", "dep-A"], "dep-A")).toBe(true);
    expect(wouldCreateCycle(["dep-A", "dep-A"], "dep-B")).toBe(false);
  });

  it("wouldCreateCycle is case-sensitive (documented)", () => {
    // deploymentIds are lowercase slugs in practice but the check is
    // case-sensitive. Pinning the behavior so anyone who accidentally
    // normalizes one side breaks the test and has to think about it.
    expect(wouldCreateCycle(["dep-a"], "dep-A")).toBe(false);
    expect(wouldCreateCycle(["dep-A"], "dep-a")).toBe(false);
  });

  it("wouldCreateCycle handles an empty-string target against an empty-string ancestor", () => {
    // Edge case: `[""].includes("")` is true, `[].includes("")` is false.
    // Not a real production scenario but documents the Array.includes
    // semantics in case someone passes garbage.
    expect(wouldCreateCycle([""], "")).toBe(true);
    expect(wouldCreateCycle([], "")).toBe(false);
  });

  it("enforceNoCycle does not throw for non-cyclic calls", () => {
    expect(() => enforceNoCycle([], "dep-A")).not.toThrow();
    expect(() => enforceNoCycle(["dep-B"], "dep-A")).not.toThrow();
    expect(() =>
      enforceNoCycle(["dep-A", "dep-B", "dep-C"], "dep-D"),
    ).not.toThrow();
  });

  it("enforceNoCycle throws DelegationCycleError when the target is in ancestors", () => {
    expect(() => enforceNoCycle(["dep-A"], "dep-A")).toThrow(
      DelegationCycleError,
    );
  });

  it("enforceNoCycle preserves the chain and target on the thrown error", () => {
    const chain = ["dep-A", "dep-B", "dep-C"];
    try {
      enforceNoCycle(chain, "dep-B");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DelegationCycleError);
      expect((err as DelegationCycleError).chain).toEqual(chain);
      expect((err as DelegationCycleError).target).toBe("dep-B");
    }
  });

  it("enforceNoCycle snapshots the ancestors list (mutating it later is safe)", () => {
    // The helper uses `[...ancestors]` when constructing the error so
    // downstream mutation of the caller's ancestors array doesn't
    // corrupt the error payload. This guards against a subtle bug
    // where the recursive loop mutates `nextAncestors` and the thrown
    // error's chain would change shape.
    const ancestors = ["dep-A", "dep-B"];
    try {
      enforceNoCycle(ancestors, "dep-A");
    } catch (err) {
      const chain = (err as DelegationCycleError).chain;
      ancestors.push("dep-C"); // mutate after throw
      expect(chain).toEqual(["dep-A", "dep-B"]); // error payload unchanged
    }
  });

  it("thrown error message renders chain with → separators and includes target", () => {
    try {
      enforceNoCycle(["dep-A", "dep-B", "dep-C"], "dep-A");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("dep-A");
      expect(msg).toContain("dep-B");
      expect(msg).toContain("dep-C");
      expect(msg).toContain("→");
      expect(msg).toContain("Delegation cycle detected");
      // Sanitization invariant: never leak shell/exec fragments
      expect(msg).not.toMatch(/npx openclaw|kubectl|exec command/i);
    }
  });

  it("sub-delegation pre-check boundary: wouldCreateCycle(nextAncestors, target) with nextAncestors = [...ancestors, current]", () => {
    // Mirrors the exact arithmetic at flowDelegation.ts:1049. Given
    // ancestors=[A] and current-hop=B, nextAncestors=[A, B]. If the
    // LLM emits a delegate call back to A, the pre-check flags it.
    const ancestors = ["dep-A"];
    const currentHop = "dep-B";
    const nextAncestors = [...ancestors, currentHop];

    // New target D is allowed
    expect(wouldCreateCycle(nextAncestors, "dep-D")).toBe(false);
    // Back to root A is a cycle
    expect(wouldCreateCycle(nextAncestors, "dep-A")).toBe(true);
    // Back to immediate parent (current hop) B is also a cycle — "self"
    // delegation from the child's perspective is blocked.
    expect(wouldCreateCycle(nextAncestors, "dep-B")).toBe(true);
  });

  it("same deployment in two nodes of a flow is treated as a cycle (intentional constraint)", () => {
    // If the user wires the SAME deployment into two nodes with
    // different roles (e.g. nodeA=Generator running t1, nodeC=Reviewer
    // also running t1), the second hop looks like a cycle because the
    // check is on deploymentId, not nodeId. Documenting this as an
    // intentional constraint — one pod is one LLM conversation, so
    // calling it twice in the same chain is blocked regardless of
    // role attribution.
    const ancestors = ["dep-t1"];  // nodeA (Generator) ran t1 first
    const target = "dep-t1";       // nodeC (Reviewer) wants to run t1 again
    expect(wouldCreateCycle(ancestors, target)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cycle 8: Error sanitization through delegation.
// Replaces an inline regex chain at flowChat.ts:666-673 (which was dead
// code — sanitizedError was computed and then never used) with a pure,
// tested helper. Also plugs three real leak sites found during the audit:
//
//   1. flowChat.ts:525 — raw errMsg appended to user-visible text when
//      the entry bot chatViaExec throws
//   2. flowChat.ts:639 — raw delegationError emitted in the
//      jarble.flow.delegation.end CUSTOM event value.error
//   3. flowChat.ts:646 — raw delegationError stored in delegationTrace,
//      which then ships via jarble.flow.chat.trace at line 890
//
// Each regression test below is a realistic failure-mode payload
// drawn from what chatViaExec / executeInPod can throw today.
// ───────────────────────────────────────────────────────────────────────────

describe("sanitizeDelegationError (Cycle 8)", () => {
  it("returns the fallback for null / undefined input", () => {
    expect(sanitizeDelegationError(null)).toBe("an internal error occurred");
    expect(sanitizeDelegationError(undefined)).toBe("an internal error occurred");
  });

  it("returns the fallback for genuinely empty input", () => {
    // An all-whitespace or empty string has nothing to sanitize.
    expect(sanitizeDelegationError("")).toBe("an internal error occurred");
    expect(sanitizeDelegationError("   \n\t  ")).toBe("an internal error occurred");
  });

  it("reduces a pure-exec-garbage error to the `execution error` label", () => {
    // When the only content is the exec wrapper, the `[...]` strip
    // replaces the whole bracketed command with "execution error" —
    // that's a safe, informative fallback (users see "execution error"
    // instead of a broken fragment). The generic "an internal error
    // occurred" fallback only fires when there's literally nothing left.
    const raw = "error executing command [npx openclaw agent --session-id sess-x --timeout 300 --message \"hi\"]";
    expect(sanitizeDelegationError(raw)).toBe("execution error");
  });

  it("passes through a clean error message unchanged", () => {
    const clean = "Connection refused";
    expect(sanitizeDelegationError(clean)).toBe("Connection refused");
  });

  it("replaces the `error executing command [...]` wrapper with `execution error`", () => {
    const raw =
      "error executing command [kubectl exec -n jarble bot-xyz -- node script.js]: exec failed: exit code 1";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("execution error");
    expect(out).toContain("exec failed: exit code 1");
    // The bracketed command should be gone
    expect(out).not.toContain("kubectl exec");
    expect(out).not.toContain("bot-xyz");
  });

  it("strips TRACEPARENT env var (W3C trace propagation)", () => {
    const raw = "execution failed TRACEPARENT=00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01 and other context";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("TRACEPARENT=");
    expect(out).not.toContain("0af7651916cd43dd8448eb211c80319c");
  });

  it("strips JARBLE_CURRENT_SESSION_ID env var", () => {
    const raw = "timeout after 300s JARBLE_CURRENT_SESSION_ID=sess-abc123xyz";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("JARBLE_CURRENT_SESSION_ID");
    expect(out).not.toContain("sess-abc123xyz");
  });

  it("strips --session-id CLI flag (space-separated)", () => {
    const raw = "openclaw died while running --session-id sess-alice-42 and the pod restarted";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("sess-alice-42");
    expect(out).toContain("pod restarted");
  });

  it("strips --session-id CLI flag (equals-separated)", () => {
    const raw = "failed: --session-id=sess-bob-99 rejected by gateway";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("sess-bob-99");
  });

  it("strips --user-id CLI flag (both space and equals forms)", () => {
    // Auth0 user ids commonly leak via exec command args — the old
    // sanitizer missed this entirely. Cycle 8 hole plugged.
    const raw1 = "error: --user-id auth0|abc123 could not be verified";
    const raw2 = "error: --user-id=auth0|xyz789 rejected";
    const out1 = sanitizeDelegationError(raw1);
    const out2 = sanitizeDelegationError(raw2);
    expect(out1).not.toContain("auth0|abc123");
    expect(out2).not.toContain("auth0|xyz789");
  });

  it("strips --timeout CLI flag", () => {
    const raw = "process killed --timeout 150 exceeded";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("--timeout 150");
    expect(out).toContain("process killed");
    expect(out).toContain("exceeded");
  });

  it("strips --thinking CLI flag", () => {
    const raw = "invalid --thinking medium flag for this model";
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("--thinking medium");
  });

  it("strips the full `npx openclaw agent --message ...` shell invocation", () => {
    const raw =
      'child exit 1 from npx openclaw agent --message "what is 2+2 really?" with trailing junk';
    const out = sanitizeDelegationError(raw);
    expect(out).not.toContain("npx openclaw agent");
    expect(out).not.toContain("what is 2+2 really");
    expect(out).toContain("child exit 1");
  });

  it("redacts Anthropic API keys (sk-ant-*)", () => {
    // A REAL leak class — if an OpenClaw pod logs the key on auth
    // failure, it can propagate up through chatViaExec's error.
    const raw =
      "authentication failed: invalid key sk-ant-api03-abcDEF1234567890_xyz and please rotate";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("abcDEF1234567890");
  });

  it("redacts OpenRouter API keys (sk-or-*)", () => {
    const raw = "gateway rejected sk-or-v1-abcd1234efgh5678 — please check billing";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-or-v1-abcd1234efgh5678");
  });

  it("redacts generic sk-* tokens of length ≥ 20", () => {
    const raw = "OpenAI call failed with key sk-proj-abc123DEF456ghi789JKL and 401 unauthorized";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted api key]");
    expect(out).not.toContain("sk-proj-abc123DEF456ghi789JKL");
  });

  it("does NOT redact short 'sk-' prefixes that look like words", () => {
    // Conservative regex — must not false-positive on things like
    // "sk-test" or "sk-error" which are not keys.
    const raw = "sk-test failed";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("sk-test");
    expect(out).not.toContain("[redacted api key]");
  });

  it("redacts ANTHROPIC_API_KEY=, OPENROUTER_API_KEY=, OPENAI_API_KEY= env var assignments", () => {
    const raw =
      "env dump: ANTHROPIC_API_KEY=sk-ant-abc OPENROUTER_API_KEY=sk-or-xyz OPENAI_API_KEY=sk-def123 PATH=/usr/bin";
    const out = sanitizeDelegationError(raw);
    expect(out).toContain("[redacted env var]");
    // All three keys redacted
    expect(out).not.toContain("ANTHROPIC_API_KEY=sk-ant-abc");
    expect(out).not.toContain("OPENROUTER_API_KEY=sk-or-xyz");
    expect(out).not.toContain("OPENAI_API_KEY=sk-def123");
    // PATH (not sensitive) remains
    expect(out).toContain("PATH");
  });

  it("caps the final length at 300 chars with ellipsis", () => {
    const long = "X".repeat(500);
    const out = sanitizeDelegationError(long);
    expect(out.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("does NOT cap short clean errors", () => {
    const short = "Connection reset by peer";
    expect(sanitizeDelegationError(short)).toBe(short);
  });

  it("collapses whitespace left by the strips", () => {
    const raw = "timeout  --session-id sess-x   and   some    detail";
    const out = sanitizeDelegationError(raw);
    // After stripping "--session-id sess-x" and collapsing runs of spaces
    expect(out).not.toMatch(/ {2,}/);
    expect(out).toContain("timeout");
    expect(out).toContain("some detail");
  });

  it("is idempotent (sanitizing a sanitized string is a no-op)", () => {
    const raw = "error executing command [npx openclaw --timeout 100] failed sk-ant-abc TRACEPARENT=00-xyz";
    const once = sanitizeDelegationError(raw);
    const twice = sanitizeDelegationError(once);
    expect(twice).toBe(once);
  });

  it("accepts Error objects, not just strings", () => {
    const err = new Error("connection timeout --session-id sess-zzz");
    const out = sanitizeDelegationError(err);
    expect(out).toContain("connection timeout");
    expect(out).not.toContain("sess-zzz");
  });

  it("accepts arbitrary non-string, non-Error values via String coercion", () => {
    expect(sanitizeDelegationError(42)).toBe("42");
    expect(sanitizeDelegationError(false)).toBe("false");
    expect(sanitizeDelegationError({ foo: "bar" })).toBe("[object Object]");
  });

  it("handles a realistic multi-leak compound error without cross-contamination", () => {
    // This is the worst-case scenario I can construct: exec wrapper +
    // session id + timeout + trace parent + API key + stack trace style
    // suffix. After sanitization nothing sensitive should remain and the
    // user-visible sentence should still have a readable causal clause.
    const raw = [
      "error executing command [npx openclaw agent --session-id sess-u-42 --timeout 300 --user-id auth0|u42 --message \"what's next?\"]:",
      "exec failed: ANTHROPIC_API_KEY=sk-ant-api03-SUPERSECRET401",
      "TRACEPARENT=00-abc-def-01 at handleRequest (/app/src/services/openclawGateway.js:123:45)",
    ].join(" ");
    const out = sanitizeDelegationError(raw);

    // Sensitive material gone
    expect(out).not.toContain("sess-u-42");
    expect(out).not.toContain("auth0|u42");
    expect(out).not.toContain("what's next");
    expect(out).not.toContain("sk-ant-api03-SUPERSECRET401");
    expect(out).not.toContain("TRACEPARENT=");
    expect(out).not.toContain("SUPERSECRET");

    // Causal clause preserved
    expect(out).toContain("execution error");
    expect(out).toContain("exec failed");
    // Since env var stripping runs before bare API key stripping, the whole
    // ANTHROPIC_API_KEY=sk-ant-... chunk collapses to [redacted env var].
    // A bare sk-ant- without env var wrapper would become [redacted api key].
    expect(out).toContain("[redacted env var]");
  });
});

// ─── JAR-102: edge-semantics contract across all three types ────────────────
//
// This suite is the integration-level pin for the ticket's "each edge type is
// actually honored through FlowEngine.executeStep" AC. FlowEngine.executeStep
// resolves a deployment node's delegation targets by calling buildDelegationTools
// (see flowEngine.ts executeDeploymentViaDelegation → buildDelegationTools). The
// three types differ in which direction(s) produce delegation tools:
//
//   delegates    — source-only: source can delegate to target; target cannot
//                  delegate back.
//   reports      — bidirectional delegation despite the one-way label arrow.
//                  Both source (reporter) and target (manager) can delegate.
//   collaborates — bidirectional, peer-to-peer.
//
// Test strategy: construct the minimal 2-node flow, run buildDelegationTools
// from BOTH nodes' perspective, and assert the tool count for each direction.
// If any edge type becomes a no-op in the engine, this test fails.
describe("JAR-102: edge-semantics executeStep contract — all three types", () => {
  const A: any = {
    id: "A", type: "deployment", deploymentId: "dep-A",
    label: "Agent A", role: "Manager", position: { x: 0, y: 0 },
  };
  const B: any = {
    id: "B", type: "deployment", deploymentId: "dep-B",
    label: "Agent B", role: "Reporter", position: { x: 100, y: 0 },
  };

  it("'delegates' edge: A gets a tool for B, B gets no tool for A", () => {
    const edges: any[] = [{ id: "e1", source: "A", target: "B", type: "delegates" }];
    expect(buildDelegationTools(A, [A, B], edges)).toHaveLength(1);
    expect(buildDelegationTools(B, [A, B], edges)).toHaveLength(0);
  });

  it("'reports' edge: both A and B get a tool for the other (bidirectional)", () => {
    const edges: any[] = [{ id: "e1", source: "B", target: "A", type: "reports" }];
    // Reporter (B) can delegate up to manager (A) — the natural arrow direction.
    expect(buildDelegationTools(B, [A, B], edges)).toHaveLength(1);
    expect(buildDelegationTools(B, [A, B], edges)[0].targetNodeId).toBe("A");
    // Manager (A) can ALSO delegate down to reporter (B) despite the arrow.
    // This is the "reports is bidirectional" invariant the ticket asks to pin.
    expect(buildDelegationTools(A, [A, B], edges)).toHaveLength(1);
    expect(buildDelegationTools(A, [A, B], edges)[0].targetNodeId).toBe("B");
  });

  it("'collaborates' edge: both A and B get a tool for the other (peer-to-peer)", () => {
    const edges: any[] = [{ id: "e1", source: "A", target: "B", type: "collaborates" }];
    expect(buildDelegationTools(A, [A, B], edges)).toHaveLength(1);
    expect(buildDelegationTools(A, [A, B], edges)[0].targetNodeId).toBe("B");
    expect(buildDelegationTools(B, [A, B], edges)).toHaveLength(1);
    expect(buildDelegationTools(B, [A, B], edges)[0].targetNodeId).toBe("A");
  });

  it("regression guard: no edge type is silently a no-op", () => {
    // Parameterized spot-check: for each edge type, at least ONE end gets a
    // tool. If a type is accidentally dropped from the filter in
    // buildDelegationTools, this test is the canary.
    for (const type of ["delegates", "reports", "collaborates"] as const) {
      const edges: any[] = [{ id: "e1", source: "A", target: "B", type }];
      const toolsA = buildDelegationTools(A, [A, B], edges);
      const toolsB = buildDelegationTools(B, [A, B], edges);
      expect(
        toolsA.length + toolsB.length,
        `edge type "${type}" produced zero delegation tools on either end`,
      ).toBeGreaterThan(0);
    }
  });
});
