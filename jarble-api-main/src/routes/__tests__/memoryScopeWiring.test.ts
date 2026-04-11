/**
 * Memory scope wiring smoke tests for the chat routes.
 *
 * Why a "structural" test instead of an integration test?
 *
 * The original Phase 1 of the memory-scoping initiative shipped a full
 * helper module (`utils/memoryScope.ts`) plus a complete unit-test suite
 * for the wording it produces — but a Phase-2 audit discovered the helper
 * was **only imported by its own test file**. Both `tamboAgent.ts` and
 * `flowChat.ts` ignored it. The behavioral tests on the helper passed
 * happily while production traffic carried no memory signal at all.
 *
 * This test exists to make that exact failure mode loud. It reads the
 * route source files and asserts:
 *   1. They import the helper from `utils/memoryScope.js`.
 *   2. They actually call `injectMemoryStateLine` on the user-facing
 *      message variable that gets forwarded to the pod.
 *   3. They use `normalizeMemoryScope` so a stale DB row doesn't crash.
 *
 * The helper's *behavior* is locked down by
 * `utils/__tests__/memoryScope.test.ts`. This file just guards the
 * "is the helper actually wired?" question that bit us once.
 *
 * See docs/audits/memory-scoping-decision.md (Phase 2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readRoute(filename: string): string {
  // ../<file>.ts from src/routes/__tests__/  →  src/routes/<file>.ts
  // __dirname works under Vitest's transform; existing tests in the
  // codebase (e.g. mcp/__tests__/renderUiValidation.test.ts) use the
  // same pattern.
  return readFileSync(resolve(__dirname, "..", filename), "utf-8");
}

describe("tamboAgent.ts memory scope wiring", () => {
  const source = readRoute("tamboAgent.ts");

  it("imports the helpers from utils/memoryScope.js", () => {
    expect(source).toMatch(/from\s+["']\.\.\/utils\/memoryScope\.js["']/);
    expect(source).toContain("normalizeMemoryScope");
    expect(source).toContain("renderMemoryStateLine");
    expect(source).toContain("injectMemoryStateLine");
  });

  it("calls injectMemoryStateLine on the message that goes to the pod", () => {
    // The line is injected into messageWithVision (the variable that
    // chatViaExec / chatViaHTTP / chatViaGateway all consume). If this
    // ever gets renamed without updating the injection, this test
    // catches it before the leak ships.
    expect(source).toMatch(
      /messageWithVision\s*=\s*injectMemoryStateLine\(\s*messageWithVision\s*,/,
    );
  });

  it("normalises memoryScope before rendering the per-turn line", () => {
    // Stale rows from before the migration must not crash the route.
    expect(source).toMatch(/normalizeMemoryScope\(/);
  });

  it("passes the sessionKey into renderMemoryStateLine", () => {
    // The session id is what the bot needs to call store_memory with
    // scope_id in session mode. If the wrong variable is passed in,
    // session-mode bots will see "Session: unknown" on every turn.
    expect(source).toMatch(/renderMemoryStateLine\([^)]*sessionKey/);
  });
});

describe("flowChat.ts memory scope wiring", () => {
  const source = readRoute("flowChat.ts");

  it("imports the helpers from utils/memoryScope.js", () => {
    expect(source).toMatch(/from\s+["']\.\.\/utils\/memoryScope\.js["']/);
    expect(source).toContain("normalizeMemoryScope");
    expect(source).toContain("renderMemoryStateLine");
    expect(source).toContain("injectMemoryStateLine");
  });

  it("injects the per-turn memory line into the final entry message", () => {
    // Team chat is the surface where the QA leak (Scenario 10 in
    // docs/audits/deep-bot-teams-qa.md) reproduced — Phase 2 wires the
    // helper here so the entry bot sees the scope on every turn.
    //
    // Pinned to the EXACT variables: `entryMessage` is what gets passed
    // to the flow engine as the entry bot's user-facing input, and it
    // must be the result of injecting the memory line into
    // `baseEntryMessage`. Pinning these names guards against a refactor
    // that injects into the wrong (pre-augmented) variable and silently
    // drops the per-turn memory signal — the same failure mode that
    // Phase 2 was created to fix.
    expect(source).toMatch(
      /entryMessage\s*=\s*injectMemoryStateLine\(\s*baseEntryMessage\s*,/,
    );
  });

  it("normalises memoryScope before rendering the per-turn line", () => {
    expect(source).toMatch(/normalizeMemoryScope\(/);
  });

  it("passes the team sessionKey into renderMemoryStateLine", () => {
    // The flow chat session key looks like flow-<flowId>-<userId>-<convId>;
    // the helper takes that as the second arg so the bot sees a stable
    // id on every turn.
    expect(source).toMatch(/renderMemoryStateLine\([^)]*sessionKey/);
  });
});
