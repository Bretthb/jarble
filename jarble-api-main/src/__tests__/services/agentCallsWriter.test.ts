/**
 * Unit tests for the agentCallsWriter helper (JAR-50, Phase 1 of the
 * orchestration observability plan).
 *
 * Covers:
 *  1. Root span insert → update cycle (chat_turn)
 *  2. Delegation hop insert → update cycle (parent linkage + depth)
 *  3. Multi-level fractal tree (root → child → grandchild) stitching
 *  4. Long request/response body truncation (10 KB cap)
 *  5. Graceful degradation when the DB write fails (writer never throws)
 *  6. Trace id propagation through the tree (single traceId across all rows)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb } from "../helpers/testDb.js";
import { agentCalls } from "../helpers/testSchema.sqlite.js";
import { eq } from "drizzle-orm";

// IMPORTANT: the writer imports `../db/index.js`. vi.mock factories are
// hoisted ABOVE module-level const declarations, so we use vi.hoisted to
// build the mock context in the same hoisted phase. This way the mock can
// reference `mocks.db` without ReferenceError.
const mocks = vi.hoisted(() => {
  // We can't import here, but we can construct the test DB lazily — the
  // mock factory below awaits this hoisted setup.
  return { ctx: null as any };
});

vi.mock("../../db/index.js", () => {
  if (!mocks.ctx) {
    // Late initialization on first import — vitest evaluates the factory
    // when the writer's import resolves, by which point top-level
    // statements have run.
    mocks.ctx = createTestDb();
  }
  return {
    db: mocks.ctx.db,
    dbDate: () => new Date().toISOString(),
    tables: { agentCalls },
  };
});

import { startAgentCall, finishAgentCall } from "../../services/agentCallsWriter.js";

// Now that the writer module has been resolved, the mock context exists.
const testDb = mocks.ctx.db;
const raw = mocks.ctx.raw;

afterAll(() => {
  try {
    raw.close();
  } catch {
    // ignore
  }
});

async function countRows() {
  return (await testDb.select().from(agentCalls)).length;
}

async function getRow(id: string) {
  const rows = await testDb.select().from(agentCalls).where(eq(agentCalls.id, id));
  return rows[0];
}

beforeEach(async () => {
  // Fresh slate per test — the writer has no other way to clear its state.
  await testDb.delete(agentCalls);
});

describe("agentCallsWriter", () => {
  describe("startAgentCall", () => {
    it("inserts a pending row and returns a handle with fresh IDs", async () => {
      const handle = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
        requestBody: "hello world",
      });

      expect(handle.callId).toMatch(/^acl_/);
      expect(handle.traceId).toHaveLength(32);
      expect(handle.spanId).toHaveLength(16);
      expect(handle.depth).toBe(0);
      expect(handle.parentSpanId).toBeNull();

      const row = await getRow(handle.callId);
      expect(row).toBeDefined();
      expect(row.status).toBe("pending");
      expect(row.kind).toBe("chat_turn");
      expect(row.spanName).toBe("jarble.chat.turn");
      expect(row.depth).toBe(0);
      expect(row.traceId).toBe(handle.traceId);
      expect(row.spanId).toBe(handle.spanId);
      expect(row.requestBody).toBe("hello world");
    });

    it("accepts a passed-in traceId for child spans", async () => {
      const rootHandle = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
      });

      const childHandle = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_designer",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: rootHandle.callId,
        parentSpanId: rootHandle.spanId,
        traceId: rootHandle.traceId,
        depth: 1,
        userId: "user_1",
      });

      expect(childHandle.traceId).toBe(rootHandle.traceId);
      expect(childHandle.depth).toBe(1);
      expect(childHandle.parentSpanId).toBe(rootHandle.spanId);

      const childRow = await getRow(childHandle.callId);
      expect(childRow.traceId).toBe(rootHandle.traceId);
      expect(childRow.parentCallId).toBe(rootHandle.callId);
      expect(childRow.parentSpanId).toBe(rootHandle.spanId);
      expect(childRow.depth).toBe(1);
      expect(childRow.spanName).toBe("jarble.delegation.hop");
    });

    it("truncates oversized request bodies to 10 KB", async () => {
      const bigString = "x".repeat(20_000);
      const handle = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
        requestBody: bigString,
      });

      const row = await getRow(handle.callId);
      expect(row.requestBody).toHaveLength(10_000);
    });

    it("defaults span name based on kind", async () => {
      const kinds = [
        { kind: "chat_turn" as const, expected: "jarble.chat.turn" },
        { kind: "delegation" as const, expected: "jarble.delegation.hop" },
        { kind: "tool" as const, expected: "jarble.tool.call" },
        { kind: "flow_step" as const, expected: "jarble.flow.step" },
        { kind: "llm" as const, expected: "jarble.llm.call" },
      ];

      for (const { kind, expected } of kinds) {
        const handle = await startAgentCall({
          kind,
          skillName: "test",
          callerDeploymentId: null,
          calleeDeploymentId: null,
          parentCallId: null,
          parentSpanId: null,
          traceId: null,
          depth: 0,
          userId: null,
        });
        const row = await getRow(handle.callId);
        expect(row.spanName).toBe(expected);
      }
    });
  });

  describe("finishAgentCall", () => {
    it("updates a pending row to completed with duration and response", async () => {
      const handle = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_designer",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 1,
        userId: "user_1",
      });

      await new Promise((r) => setTimeout(r, 10)); // ensure nonzero duration

      await finishAgentCall({
        call: handle,
        status: "completed",
        responseBody: "the designed layout",
        creditsCharged: 1,
      });

      const row = await getRow(handle.callId);
      expect(row.status).toBe("completed");
      expect(row.statusCode).toBe("ok");
      expect(row.responseBody).toBe("the designed layout");
      expect(row.creditsCharged).toBe(1);
      expect(row.durationMs).toBeGreaterThanOrEqual(1);
      expect(row.latencyMs).toBe(row.durationMs);
      expect(row.endMs).not.toBeNull();
    });

    it("updates a pending row to failed with error message", async () => {
      const handle = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_designer",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 1,
        userId: "user_1",
      });

      await finishAgentCall({
        call: handle,
        status: "failed",
        errorMessage: "target pod not ready",
      });

      const row = await getRow(handle.callId);
      expect(row.status).toBe("failed");
      expect(row.statusCode).toBe("error");
      expect(row.errorMessage).toBe("target pod not ready");
    });
  });

  describe("fractal tree stitching", () => {
    it("preserves the same traceId across 3 levels of delegation", async () => {
      // Note: deployment IDs are passed as null because the writer's FK
      // would otherwise reject fake string IDs. The tree topology under
      // test only depends on parent_call_id / parent_span_id / trace_id,
      // not the deployment FK. Real flows always use real deployment ids.

      // Level 0: root chat turn
      const root = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
      });

      // Level 1: entry → designer
      const designer = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_designer",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: root.callId,
        parentSpanId: root.spanId,
        traceId: root.traceId,
        depth: 1,
        userId: "user_1",
      });

      // Level 2: designer → image-gen
      const imgGen = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_imgGen",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: designer.callId,
        parentSpanId: designer.spanId,
        traceId: root.traceId,
        depth: 2,
        userId: "user_1",
      });

      // All three rows should share one trace id
      const allRows = await testDb
        .select()
        .from(agentCalls)
        .where(eq(agentCalls.traceId, root.traceId));
      expect(allRows).toHaveLength(3);
      expect(new Set(allRows.map((r: any) => r.traceId)).size).toBe(1);

      // Depths should climb monotonically
      expect(allRows.find((r: any) => r.depth === 0)?.id).toBe(root.callId);
      expect(allRows.find((r: any) => r.depth === 1)?.id).toBe(designer.callId);
      expect(allRows.find((r: any) => r.depth === 2)?.id).toBe(imgGen.callId);

      // Root has no parent
      const rootRow = allRows.find((r: any) => r.parentCallId === null);
      expect(rootRow?.id).toBe(root.callId);

      // Parent linkage forms a chain
      expect(allRows.find((r: any) => r.parentCallId === root.callId)?.id).toBe(designer.callId);
      expect(allRows.find((r: any) => r.parentCallId === designer.callId)?.id).toBe(imgGen.callId);
    });
  });

  describe("graceful degradation", () => {
    it("never throws when the DB insert fails — returns a handle anyway", async () => {
      // Close the DB to force the insert to fail, then restore for later tests.
      raw.exec("PRAGMA query_only = ON");

      let handle: any;
      let caught: any = null;
      try {
        handle = await startAgentCall({
          kind: "delegation",
          skillName: "delegate_to_designer",
          callerDeploymentId: null,
          calleeDeploymentId: null,
          parentCallId: null,
          parentSpanId: null,
          traceId: null,
          depth: 1,
          userId: "user_1",
        });
      } catch (err) {
        caught = err;
      }

      raw.exec("PRAGMA query_only = OFF");

      expect(caught).toBeNull();
      expect(handle).toBeDefined();
      expect(handle.callId).toMatch(/^acl_/);
      expect(handle.traceId).toHaveLength(32);
      expect(handle.spanId).toHaveLength(16);
    });

    it("never throws when the DB update fails", async () => {
      const handle = await startAgentCall({
        kind: "delegation",
        skillName: "delegate_to_designer",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 1,
        userId: "user_1",
      });

      raw.exec("PRAGMA query_only = ON");

      let caught: any = null;
      try {
        await finishAgentCall({
          call: handle,
          status: "completed",
          responseBody: "result",
        });
      } catch (err) {
        caught = err;
      }

      raw.exec("PRAGMA query_only = OFF");
      expect(caught).toBeNull();
    });
  });

  describe("root span query shape", () => {
    it("roots of a trace are findable by parent_span_id IS NULL", async () => {
      const root = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
      });

      await startAgentCall({
        kind: "delegation",
        skillName: "delegate",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: root.callId,
        parentSpanId: root.spanId,
        traceId: root.traceId,
        depth: 1,
        userId: "user_1",
      });

      const rootsForTrace = await testDb
        .select()
        .from(agentCalls)
        .where(eq(agentCalls.traceId, root.traceId));
      expect(rootsForTrace).toHaveLength(2);

      const actualRoots = rootsForTrace.filter((r: any) => r.parentSpanId === null);
      expect(actualRoots).toHaveLength(1);
      expect(actualRoots[0].id).toBe(root.callId);
    });

    it("message_id attribute lookup via attributes JSON", async () => {
      const handle = await startAgentCall({
        kind: "chat_turn",
        skillName: "__chat_turn__",
        callerDeploymentId: null,
        calleeDeploymentId: null,
        parentCallId: null,
        parentSpanId: null,
        traceId: null,
        depth: 0,
        userId: "user_1",
        attributes: { message_id: "msg_abc123", hasCanvasImage: false },
      });

      const row = await getRow(handle.callId);
      // SQLite stores JSON as TEXT; writer passes the object directly, which
      // Drizzle's better-raw3 driver serialises for us.
      const attrs =
        typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes;
      expect(attrs.message_id).toBe("msg_abc123");
      expect(attrs.hasCanvasImage).toBe(false);
    });
  });
});
