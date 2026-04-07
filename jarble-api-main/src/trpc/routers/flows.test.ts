/**
 * Tests for the flows tRPC router — focused on the read-side persistence
 * procedures (`getChatSessions` / `getChatMessages`) added in JAR-flow-chat.
 *
 * The DB module is mocked rather than spinning up SQLite so we can
 * deterministically simulate:
 *   1. Multi-user ownership boundaries
 *   2. Drizzle "table doesn't exist" errors (migration 0007 not applied)
 *   3. Generic DB hiccups (graceful degradation, never crash chat panel)
 *   4. Limit + ordering parameter handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Logger mock — silence warn/error spam during tests ─────────────────
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Env mock — flows.ts imports env for the LLM-generation procedure ──
vi.mock("../../utils/env.js", () => ({
  env: {
    AGENT_LLM_PROVIDER: "openrouter",
    AGENT_LLM_API_KEY: "sk-test",
    AGENT_LLM_MODEL: "anthropic/claude-sonnet-4-20250514",
    OPENROUTER_API_KEY: "sk-or-test",
  },
}));

// ── Workflow agent prompt mock (large file, not needed) ────────────────
vi.mock("../../prompts/workflowAgent.js", () => ({
  WORKFLOW_AGENT_SYSTEM_PROMPT: "test-prompt",
}));

// ── llmProxy mock — never actually called by the procedures under test ─
vi.mock("../../services/llmProxy.js", () => ({
  collectLlmCompletion: vi.fn(),
}));

// ── configSync mock — flows.ts imports syncConfigsToPvc for fan-out
// from flows.create / update / delete / duplicate. The chat procedures
// never call it, but loading the real module pulls in the entire k8s
// runtime registry → schema.pg.ts and fails at module init time.
// Stub it to a no-op so we don't load the world.
vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn(async () => {}),
}));

// ── DB mock — the heart of these tests ─────────────────────────────────
//
// We track the most-recent query "shape" so each test can dictate what
// the chained .select(...).from(...).where(...).orderBy(...).limit()
// builder will return. Each chain method returns the same `chain` object
// which is also a thenable, so `await db.select()...limit()` resolves
// with the next queued result.
//
// IMPORTANT: vi.mock is hoisted to the top of the file, so we cannot
// reference any module-scope `const`s from inside the factory. We pull
// the actual table object out via `vi.hoisted` instead.
const { mockTablesRef, makeChainRef } = vi.hoisted(() => {
  const flowChatSessionsToken = {
    __table: "flowChatSessions",
    id: { name: "id" },
    flowId: { name: "flowId" },
    userId: { name: "userId" },
    title: { name: "title" },
    createdAt: { name: "createdAt" },
    updatedAt: { name: "updatedAt" },
  };
  const flowChatMessagesToken = {
    __table: "flowChatMessages",
    id: { name: "id" },
    sessionId: { name: "sessionId" },
    role: { name: "role" },
    content: { name: "content" },
    sourceNodeId: { name: "sourceNodeId" },
    sourceDeploymentId: { name: "sourceDeploymentId" },
    delegationToolName: { name: "delegationToolName" },
    createdAt: { name: "createdAt" },
  };
  const tableState: any = {
    orchestrationFlows: {
      __table: "orchestrationFlows",
      id: { name: "id" },
      userId: { name: "userId" },
    },
    flowChatSessions: flowChatSessionsToken,
    flowChatMessages: flowChatMessagesToken,
    _flowChatSessionsToken: flowChatSessionsToken,
    _flowChatMessagesToken: flowChatMessagesToken,
  };

  const queue: Array<any[] | Error> = [];
  const last: { current: any } = { current: null };

  const makeChain = (initial: Record<string, unknown> = {}): any => {
    const chain: any = { _tag: "chain", ...initial };
    chain.from = (table: any) => {
      chain._from = table;
      return chain;
    };
    chain.where = (cond: any) => {
      chain._where = cond;
      return chain;
    };
    chain.orderBy = (order: any) => {
      chain._orderBy = order;
      return chain;
    };
    chain.limit = (n: number) => {
      chain._limit = n;
      return chain;
    };
    chain.innerJoin = (table: any, cond: any) => {
      chain._innerJoin = { table, cond };
      return chain;
    };
    chain.then = (resolve: any, reject: any) => {
      last.current = chain;
      const next = queue.shift();
      if (next instanceof Error) return reject(next);
      return resolve(next ?? []);
    };
    return chain;
  };

  return {
    mockTablesRef: tableState,
    makeChainRef: { make: makeChain, queue, last },
  };
});

// Backwards-compat aliases used elsewhere in this file.
const mockTables = mockTablesRef;
const flowChatSessionsToken = mockTablesRef._flowChatSessionsToken;
const flowChatMessagesToken = mockTablesRef._flowChatMessagesToken;
const resultQueueShared = makeChainRef.queue;
const lastQueryShared = makeChainRef.last;
const lastQuery: { current: any } = lastQueryShared;

function queueResults(...items: Array<any[] | Error>) {
  resultQueueShared.push(...items);
}

vi.mock("../../db/index.js", () => ({
  db: {
    select: (cols?: any) => makeChainRef.make({ _columns: cols }),
    insert: () => makeChainRef.make(),
    update: () => makeChainRef.make(),
    delete: () => makeChainRef.make(),
    query: {},
  },
  get tables() {
    return mockTablesRef;
  },
  dbDate: () => new Date("2026-04-07T00:00:00Z"),
}));

// Drizzle helpers — we don't need their real behavior, just placeholders
// that the procedures can pass into `.where(...)` etc.
// `relations` is a no-op stub because `schema.pg.ts` calls it at module
// load time to decorate relation metadata — we don't test those, but we
// need the function to exist or schema.pg.ts will throw on import.
vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ op: "eq", a, b }),
  ne: (a: any, b: any) => ({ op: "ne", a, b }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  inArray: (a: any, b: any) => ({ op: "inArray", a, b }),
  desc: (col: any) => ({ op: "desc", col }),
  asc: (col: any) => ({ op: "asc", col }),
  lt: (a: any, b: any) => ({ op: "lt", a, b }),
  sql: () => ({ op: "sql" }),
  relations: () => ({}),
}));

// ── Import after mocks are wired ──────────────────────────────────────
import { flowsRouter } from "./flows.js";

// Build a fake context that satisfies the protectedProcedure shape.
// We only populate the fields the procedures actually read (user.id),
// then cast to the strict Context type so the createCaller signature
// is satisfied without us needing to fabricate every user column.
function makeCtx(userId = "auth0|alice"): any {
  return {
    user: { id: userId } as any,
    db: {} as any,
    requestId: "test-req",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: "127.0.0.1",
  };
}

beforeEach(() => {
  resultQueueShared.length = 0;
  lastQueryShared.current = null;
  // Reset the tables object to the "fully populated" world.
  mockTables.flowChatSessions = flowChatSessionsToken;
  mockTables.flowChatMessages = flowChatMessagesToken;
});

// ─── getChatSessions ──────────────────────────────────────────────────

describe("flows.getChatSessions", () => {
  it("returns empty array when the user owns the flow but has no sessions", async () => {
    queueResults(
      [{ id: "flw_1" }], // ownership check: flow exists, owned by alice
      [], // sessions query: empty
    );

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual([]);
  });

  it("returns only sessions belonging to the caller (filter happens in WHERE)", async () => {
    // The DB itself enforces the userId filter, so the mock should only
    // hand back rows the WHERE clause would have selected. We assert
    // that the procedure passes a WHERE that includes userId.
    const aliceSessions = [
      {
        id: "fcs_1",
        flowId: "flw_1",
        title: "Q1 planning",
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-05"),
      },
      {
        id: "fcs_2",
        flowId: "flw_1",
        title: null,
        createdAt: new Date("2026-04-02"),
        updatedAt: new Date("2026-04-06"),
      },
    ];

    queueResults([{ id: "flw_1" }], aliceSessions);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual(aliceSessions);
    // The recorded WHERE must reference userId — i.e. the procedure
    // didn't accidentally drop the ownership filter on the data query.
    const whereStr = JSON.stringify(lastQuery.current?._where);
    expect(whereStr).toContain("userId");
    expect(whereStr).toContain("auth0|alice");
  });

  it("returns [] (and logs a warning) when the flow isn't owned by the caller", async () => {
    queueResults(
      [], // ownership check: no rows -> not owned
      // (no second query should fire)
    );

    const caller = flowsRouter.createCaller(makeCtx("auth0|mallory"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual([]);
  });

  it("gracefully returns [] when the underlying table is missing (PG 42P01)", async () => {
    const pgErr: any = new Error(
      'relation "flow_chat_sessions" does not exist',
    );
    pgErr.code = "42P01";

    queueResults(
      [{ id: "flw_1" }], // ownership ok
      pgErr, // data query throws
    );

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual([]);
  });

  it("gracefully returns [] when generic DB error occurs (never crashes chat panel)", async () => {
    queueResults([{ id: "flw_1" }], new Error("connection refused"));

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual([]);
  });

  it("returns [] when flowChatSessions is not present in the schema bundle at all", async () => {
    // Simulate "older build that doesn't even know about the table".
    mockTables.flowChatSessions = undefined;

    queueResults(
      [{ id: "flw_1" }], // ownership check still works
    );

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatSessions({ flowId: "flw_1" });

    expect(result).toEqual([]);
  });
});

// ─── getChatMessages ──────────────────────────────────────────────────

describe("flows.getChatMessages", () => {
  it("returns messages when the parent session is owned by the caller", async () => {
    const messages = [
      {
        id: "fcm_1",
        sessionId: "fcs_1",
        role: "user",
        content: "Hello team",
        sourceNodeId: null,
        sourceDeploymentId: null,
        delegationToolName: null,
        createdAt: new Date("2026-04-01T10:00:00Z"),
      },
      {
        id: "fcm_2",
        sessionId: "fcs_1",
        role: "assistant",
        content: "Hi Alice — what would you like to plan?",
        sourceNodeId: "n1",
        sourceDeploymentId: "dep_abc",
        delegationToolName: null,
        createdAt: new Date("2026-04-01T10:00:05Z"),
      },
    ];

    queueResults(messages);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({ sessionId: "fcs_1" });

    expect(result).toEqual(messages);
    // The procedure must have JOINed against flowChatSessions filtered
    // by userId — verify both pieces are in the recorded query.
    const whereStr = JSON.stringify(lastQuery.current?._where);
    expect(whereStr).toContain("userId");
    expect(whereStr).toContain("auth0|alice");
    expect(lastQuery.current?._innerJoin).toBeTruthy();
  });

  it("returns [] when sessionId is fabricated / not owned by the caller", async () => {
    // The INNER JOIN with userId filter would yield zero rows.
    queueResults([]);

    const caller = flowsRouter.createCaller(makeCtx("auth0|mallory"));
    const result = await caller.getChatMessages({ sessionId: "fcs_owned_by_alice" });

    expect(result).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    queueResults([]);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    await caller.getChatMessages({ sessionId: "fcs_1", limit: 25 });

    expect(lastQuery.current?._limit).toBe(25);
  });

  it("defaults limit to 200 when not provided", async () => {
    queueResults([]);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    await caller.getChatMessages({ sessionId: "fcs_1" });

    expect(lastQuery.current?._limit).toBe(200);
  });

  it("orders messages by createdAt ASC (chronological for chat replay)", async () => {
    queueResults([]);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    await caller.getChatMessages({ sessionId: "fcs_1" });

    const orderStr = JSON.stringify(lastQuery.current?._orderBy);
    expect(orderStr).toContain("asc");
    expect(orderStr).toContain("createdAt");
  });

  it("gracefully returns [] when the underlying table is missing (PG 42P01)", async () => {
    const pgErr: any = new Error(
      'relation "flow_chat_messages" does not exist',
    );
    pgErr.code = "42P01";

    queueResults(pgErr);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({ sessionId: "fcs_1" });

    expect(result).toEqual([]);
  });

  it("gracefully returns [] on generic DB error (never crashes chat panel)", async () => {
    queueResults(new Error("connection lost"));

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({ sessionId: "fcs_1" });

    expect(result).toEqual([]);
  });

  it("returns [] when flowChatMessages is not present in the schema bundle", async () => {
    mockTables.flowChatMessages = undefined;

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({ sessionId: "fcs_1" });

    expect(result).toEqual([]);
  });

  it("rejects sessionId values that fail Zod validation (extra arg type check)", async () => {
    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));

    // limit must be 1..500 — ensure 0 / 501 are rejected before any DB call.
    await expect(
      caller.getChatMessages({ sessionId: "fcs_1", limit: 0 }),
    ).rejects.toThrow();

    await expect(
      caller.getChatMessages({ sessionId: "fcs_1", limit: 501 }),
    ).rejects.toThrow();
  });

  // ── beforeId cursor pagination ─────────────────────────────────────
  // The cursor branch fires two queries:
  //   1. cursor lookup (id → createdAt, JOIN-protected)
  //   2. data fetch with `createdAt < cursor` filter, DESC + reverse
  // We queue both in order and assert the recorded query state.

  it("returns [] when beforeId cursor isn't found / not owned (no leak)", async () => {
    queueResults([]); // cursor lookup: zero rows

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({
      sessionId: "fcs_1",
      beforeId: "fcm_forged",
    });

    expect(result).toEqual([]);
  });

  it("paginates with beforeId cursor: orders DESC, applies lt filter, then reverses", async () => {
    // Cursor lookup returns the cursor's createdAt.
    const cursorCreatedAt = new Date("2026-04-01T10:00:10Z");
    // Data fetch returns 2 messages in DESC order (newest of older window
    // first); the procedure must reverse them to ASC before returning.
    const desc2 = [
      {
        id: "fcm_2",
        sessionId: "fcs_1",
        role: "assistant",
        content: "second-oldest",
        sourceNodeId: null,
        sourceDeploymentId: null,
        delegationToolName: null,
        createdAt: new Date("2026-04-01T10:00:08Z"),
      },
      {
        id: "fcm_1",
        sessionId: "fcs_1",
        role: "user",
        content: "oldest",
        sourceNodeId: null,
        sourceDeploymentId: null,
        delegationToolName: null,
        createdAt: new Date("2026-04-01T10:00:05Z"),
      },
    ];

    queueResults([{ createdAt: cursorCreatedAt }], desc2);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    const result = await caller.getChatMessages({
      sessionId: "fcs_1",
      beforeId: "fcm_3",
      limit: 50,
    });

    // Reversed to ASC (oldest first) for the client.
    expect(result).toEqual([desc2[1], desc2[0]]);

    // Inspect the LAST recorded query — that's the data fetch.
    const dataQuery = lastQuery.current;
    expect(dataQuery?._limit).toBe(50);

    // The cursor branch must order DESC, not ASC.
    const orderStr = JSON.stringify(dataQuery?._orderBy);
    expect(orderStr).toContain("desc");
    expect(orderStr).toContain("createdAt");

    // The WHERE must include the lt(createdAt, cursor) condition AND the
    // session/user filters from the no-cursor case.
    const whereStr = JSON.stringify(dataQuery?._where);
    expect(whereStr).toContain("lt");
    expect(whereStr).toContain("userId");
    expect(whereStr).toContain("auth0|alice");
  });

  it("does not include the cursor message itself in the page (lt is exclusive)", async () => {
    // Two distinct DB calls; we only need to verify the data query uses
    // `lt` (exclusive) not `lte` (inclusive). The result content doesn't
    // matter — the assertion is on the recorded operator.
    queueResults(
      [{ createdAt: new Date("2026-04-01T10:00:10Z") }],
      [],
    );

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    await caller.getChatMessages({
      sessionId: "fcs_1",
      beforeId: "fcm_3",
    });

    const whereStr = JSON.stringify(lastQuery.current?._where);
    // lt = exclusive less-than. lte/le would mean the cursor is included,
    // which causes a duplicate when prepending on the client.
    expect(whereStr).toContain('"op":"lt"');
    expect(whereStr).not.toContain('"op":"lte"');
  });

  it("without beforeId cursor still uses ASC ordering (no regression)", async () => {
    queueResults([]);

    const caller = flowsRouter.createCaller(makeCtx("auth0|alice"));
    await caller.getChatMessages({ sessionId: "fcs_1" });

    const orderStr = JSON.stringify(lastQuery.current?._orderBy);
    expect(orderStr).toContain("asc");
    expect(orderStr).not.toContain("desc");
  });
});
