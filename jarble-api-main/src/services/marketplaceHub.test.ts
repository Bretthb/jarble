/**
 * Unit tests for marketplaceHub.executeAgentCall — JAR-50 fractal delegation
 * topology plumbing.
 *
 * The hub historically inserted `agent_calls` rows directly without setting
 * `parent_call_id` / `depth` / `kind` / `trace_id` / `parent_span_id`, which
 * orphaned skill hops from any surrounding delegation tree. These tests lock
 * in the fix: both the success and failure insert sites must propagate the
 * new topology fields and tag the row with `kind: "skill"`.
 *
 * Strategy: we stub `db.select()` (service lookup) and `db.insert()` (row
 * capture) via vi.mock + vi.hoisted so we can assert exactly what landed on
 * the row, and we stub global `fetch` so the test never touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock context — insert captures + service lookup result.
const mocks = vi.hoisted(() => {
  const insertedRows: any[] = [];
  let serviceLookupResult: any[] = [];
  return {
    insertedRows,
    setServiceLookup(rows: any[]) {
      serviceLookupResult = rows;
    },
    getServiceLookup() {
      return serviceLookupResult;
    },
  };
});

vi.mock("../db/index.js", () => {
  const selectBuilder = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    limit: async () => mocks.getServiceLookup(),
  };
  const insertBuilder = {
    values: async (row: any) => {
      mocks.insertedRows.push(row);
    },
  };
  return {
    db: {
      select: () => selectBuilder,
      insert: () => insertBuilder,
    },
    tables: {
      marketplaceServices: {
        id: "marketplace_services.id",
      },
      agentCalls: {},
    },
    dbDate: () => new Date(),
  };
});

vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// drizzle-orm's `eq` helper is called inside the select chain. The stub above
// ignores its return value so we just make sure it exists.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return {
    ...actual,
    eq: () => ({}),
  };
});

import { executeAgentCall } from "./marketplaceHub.js";

const PUBLISHED_SERVICE = {
  id: "svc_weather",
  status: "published",
  creatorDeploymentId: "dep_creator",
  displayName: "Weather",
};

function stubFetchOk(body: any) {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  }));
}

function stubFetchError(status: number, body: string) {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: false,
    status,
    async json() {
      return {};
    },
    async text() {
      return body;
    },
  }));
}

beforeEach(() => {
  mocks.insertedRows.length = 0;
  mocks.setServiceLookup([PUBLISHED_SERVICE]);
});

describe("marketplaceHub.executeAgentCall — fractal delegation topology", () => {
  it("stitches parent_call_id / depth / trace_id / parent_span_id into the successful insert and tags kind=skill", async () => {
    stubFetchOk({ ok: true, value: 42 });

    await executeAgentCall({
      callerDeploymentId: "dep_caller",
      calleeServiceId: PUBLISHED_SERVICE.id,
      skillName: "forecast",
      args: { zip: "94103" },
      callerUserId: "user_1",
      parentCallId: "acl_parent",
      depth: 2,
      traceId: "trace-abc",
      parentSpanId: "span-parent",
      orgId: "org_1",
    });

    expect(mocks.insertedRows).toHaveLength(1);
    const row = mocks.insertedRows[0];
    expect(row.status).toBe("completed");
    expect(row.parentCallId).toBe("acl_parent");
    expect(row.depth).toBe(2);
    expect(row.kind).toBe("skill");
    expect(row.traceId).toBe("trace-abc");
    expect(row.parentSpanId).toBe("span-parent");
    expect(row.userId).toBe("user_1");
    expect(row.orgId).toBe("org_1");
    expect(row.skillName).toBe("forecast");
    expect(row.callerDeploymentId).toBe("dep_caller");
    expect(row.calleeDeploymentId).toBe(PUBLISHED_SERVICE.creatorDeploymentId);
  });

  it("stitches the same topology fields into the FAILED insert path when the downstream service errors", async () => {
    stubFetchError(500, "boom");

    await expect(
      executeAgentCall({
        callerDeploymentId: "dep_caller",
        calleeServiceId: PUBLISHED_SERVICE.id,
        skillName: "forecast",
        args: {},
        callerUserId: "user_1",
        parentCallId: "acl_parent",
        depth: 3,
        traceId: "trace-xyz",
        parentSpanId: "span-parent-2",
      }),
    ).rejects.toThrow(/Agent call failed/);

    expect(mocks.insertedRows).toHaveLength(1);
    const row = mocks.insertedRows[0];
    expect(row.status).toBe("failed");
    expect(row.parentCallId).toBe("acl_parent");
    expect(row.depth).toBe(3);
    expect(row.kind).toBe("skill");
    expect(row.traceId).toBe("trace-xyz");
    expect(row.parentSpanId).toBe("span-parent-2");
    expect(row.errorMessage).toContain("500");
  });

  it("defaults to a root-level skill row (parentCallId=null, depth=0) when no topology fields are provided — backward compatibility path", async () => {
    stubFetchOk({ ok: true });

    await executeAgentCall({
      callerDeploymentId: "dep_caller",
      calleeServiceId: PUBLISHED_SERVICE.id,
      skillName: "forecast",
      args: {},
      callerUserId: "user_1",
    });

    expect(mocks.insertedRows).toHaveLength(1);
    const row = mocks.insertedRows[0];
    expect(row.parentCallId).toBeNull();
    expect(row.depth).toBe(0);
    expect(row.kind).toBe("skill");
    expect(row.traceId).toBeNull();
    expect(row.parentSpanId).toBeNull();
    expect(row.orgId).toBeNull();
  });

  it("throws before inserting when the service is not found", async () => {
    mocks.setServiceLookup([]);

    await expect(
      executeAgentCall({
        callerDeploymentId: "dep_caller",
        calleeServiceId: "svc_missing",
        skillName: "forecast",
        args: {},
        callerUserId: "user_1",
      }),
    ).rejects.toThrow(/Service not found/);

    expect(mocks.insertedRows).toHaveLength(0);
  });
});
