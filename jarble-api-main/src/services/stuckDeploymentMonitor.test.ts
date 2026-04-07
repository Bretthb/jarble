/**
 * Tests for stuckDeploymentMonitor.ts — observability ticker for
 * deployments stuck in transitional states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────
//
// vi.mock factories are hoisted to the top of the file, so any module-scope
// variables they close over must be declared via `vi.hoisted` to satisfy
// the hoisting invariant. The shared state exposed here lets individual
// tests queue up DB results, inspect the last query shape, and assert
// Sentry / logger activity.
const hoisted = vi.hoisted(() => {
  const selectResult: { rows: any[] | Error } = { rows: [] };
  const lastQuery: { columns: any; from: any; where: any } = {
    columns: null,
    from: null,
    where: null,
  };
  const sentryCaptureMessage = vi.fn();
  const logSpy = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { selectResult, lastQuery, sentryCaptureMessage, logSpy };
});
const { selectResult, lastQuery, sentryCaptureMessage, logSpy } = hoisted;

vi.mock("../db/index.js", () => {
  const chain: any = {};
  chain.from = (table: any) => {
    hoisted.lastQuery.from = table;
    return chain;
  };
  chain.where = (cond: any) => {
    hoisted.lastQuery.where = cond;
    return chain;
  };
  // Make the chain awaitable — `await` resolves with selectResult.rows
  // (or rejects if it's an Error, simulating a DB failure).
  chain.then = (resolve: any, reject: any) => {
    if (hoisted.selectResult.rows instanceof Error) {
      return reject(hoisted.selectResult.rows);
    }
    return resolve(hoisted.selectResult.rows);
  };

  return {
    db: {
      select: (cols: any) => {
        hoisted.lastQuery.columns = cols;
        return chain;
      },
    },
    tables: {
      deployments: {
        id: { name: "id" },
        name: { name: "name" },
        userId: { name: "user_id" },
        runtime: { name: "runtime" },
        status: { name: "status" },
        createdAt: { name: "created_at" },
        updatedAt: { name: "updated_at" },
      },
    },
  };
});

// Drizzle helpers — we don't need their real behavior, just placeholders
// that the monitor can pass into `.where(...)`.
vi.mock("drizzle-orm", () => ({
  and: (...conds: any[]) => ({ op: "and", conds }),
  inArray: (col: any, values: any[]) => ({ op: "inArray", col, values }),
  lt: (col: any, value: any) => ({ op: "lt", col, value }),
}));

// Sentry — capture calls so we can assert dedup behavior.
vi.mock("@sentry/node", () => ({
  captureMessage: (...args: any[]) => hoisted.sentryCaptureMessage(...args),
}));

// Logger — silent but inspectable.
vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => hoisted.logSpy,
  logger: hoisted.logSpy,
}));

// ── Imports under test ──────────────────────────────────────────────────
import {
  pollOnce,
  startStuckDeploymentMonitor,
  stopStuckDeploymentMonitor,
  POLL_INTERVAL_MS,
  STUCK_THRESHOLD_MS,
  STUCK_STATES,
} from "./stuckDeploymentMonitor.js";

// ── Helpers ─────────────────────────────────────────────────────────────

const NOW = new Date("2026-04-07T12:00:00Z");

function makeDeployment(overrides: Partial<{
  id: string;
  name: string;
  userId: string;
  runtime: string;
  status: string;
  ageMinutes: number; // how many minutes ago updatedAt was
}> = {}) {
  const ageMinutes = overrides.ageMinutes ?? 10;
  return {
    id: overrides.id ?? "dep-1",
    name: overrides.name ?? "test-bot",
    userId: overrides.userId ?? "auth0|alice",
    runtime: overrides.runtime ?? "openclaw",
    status: overrides.status ?? "creating",
    createdAt: new Date(NOW.getTime() - ageMinutes * 60_000),
    updatedAt: new Date(NOW.getTime() - ageMinutes * 60_000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResult.rows = [];
  lastQuery.columns = null;
  lastQuery.from = null;
  lastQuery.where = null;
  // Ensure no leftover monitor from a prior test.
  stopStuckDeploymentMonitor();
});

afterEach(() => {
  stopStuckDeploymentMonitor();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════
// pollOnce
// ═══════════════════════════════════════════════════════════════════════
describe("pollOnce", () => {
  it("returns 0 when no deployments are stuck", async () => {
    selectResult.rows = [];

    const count = await pollOnce(NOW);

    expect(count).toBe(0);
    expect(logSpy.warn).not.toHaveBeenCalled();
    expect(sentryCaptureMessage).not.toHaveBeenCalled();
  });

  it("returns the count of stuck deployments and emits a warn log for each", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-1", ageMinutes: 7 }),
      makeDeployment({ id: "dep-2", ageMinutes: 12, status: "restarting" }),
      makeDeployment({ id: "dep-3", ageMinutes: 20, status: "reloading" }),
    ];

    const count = await pollOnce(NOW);

    expect(count).toBe(3);
    expect(logSpy.warn).toHaveBeenCalledTimes(3);
    // Verify each warn carries deployment_id + age + fingerprint
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        ageMinutes: 7,
        fingerprint: "stuck-deployment:dep-1",
      }),
      expect.stringContaining("stuck"),
    );
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-3",
        ageMinutes: 20,
        level: "error", // >15 min escalates
      }),
      expect.any(String),
    );
  });

  it("escalates level from warning to error after 15 minutes", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-warn", ageMinutes: 10 }),
      makeDeployment({ id: "dep-err", ageMinutes: 16 }),
    ];

    await pollOnce(NOW);

    expect(sentryCaptureMessage).toHaveBeenCalledTimes(2);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("dep-warn"),
      expect.objectContaining({ level: "warning" }),
    );
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("dep-err"),
      expect.objectContaining({ level: "error" }),
    );
  });

  it("emits a Sentry event with fingerprint and tags for each stuck deployment", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-1", runtime: "openclaw", ageMinutes: 8 }),
    ];

    await pollOnce(NOW);

    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("dep-1"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          deployment_id: "dep-1",
          runtime: "openclaw",
          stuck_status: "creating",
          stuck_minutes: "8",
        }),
        fingerprint: ["stuck-deployment", "dep-1"],
      }),
    );
  });

  it("issues a SELECT against the deployments table with status + lt(updatedAt) filters", async () => {
    selectResult.rows = [];

    await pollOnce(NOW);

    // Verify the query targeted the deployments table
    expect(lastQuery.from).toBeTruthy();
    expect(lastQuery.from.id?.name).toBe("id");
    // Verify the WHERE includes both an inArray (status) and lt (updatedAt)
    // Our mocked drizzle returns a tagged shape we can introspect.
    expect(lastQuery.where).toEqual(
      expect.objectContaining({
        op: "and",
        conds: expect.arrayContaining([
          expect.objectContaining({
            op: "inArray",
            values: STUCK_STATES,
          }),
          expect.objectContaining({ op: "lt" }),
        ]),
      }),
    );
    // The cutoff timestamp should be NOW - STUCK_THRESHOLD_MS
    const ltCond = (lastQuery.where as any).conds.find(
      (c: any) => c.op === "lt",
    );
    expect(ltCond.value.getTime()).toBe(NOW.getTime() - STUCK_THRESHOLD_MS);
  });

  it("queries only the STUCK_STATES set (creating, restarting, reloading)", async () => {
    selectResult.rows = [];

    await pollOnce(NOW);

    // Drizzle's inArray receives the literal status list — verify we're
    // not accidentally including running/stopped/failed in the filter.
    const inArrayCond = (lastQuery.where as any).conds.find(
      (c: any) => c.op === "inArray",
    );
    expect(inArrayCond.values).toEqual(STUCK_STATES);
    expect(inArrayCond.values).not.toContain("running");
    expect(inArrayCond.values).not.toContain("stopped");
    expect(inArrayCond.values).not.toContain("failed");
  });

  it("swallows DB errors and returns -1 (does not crash the ticker)", async () => {
    selectResult.rows = new Error("DB connection lost");

    const count = await pollOnce(NOW);

    expect(count).toBe(-1);
    expect(logSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: "DB connection lost" }),
      expect.stringContaining("poll cycle failed"),
    );
  });

  it("dedupes Sentry events for the same deployment within the 30-minute window", async () => {
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 10 })];

    // First call — emits.
    await pollOnce(NOW);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);

    // 5 minutes later, still stuck — should be suppressed.
    const fiveMinLater = new Date(NOW.getTime() + 5 * 60_000);
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 15 })];
    await pollOnce(fiveMinLater);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1); // still 1

    // The warn log still fires every cycle (so we have a continuous record),
    // but Sentry stays quiet.
    expect(logSpy.warn).toHaveBeenCalledTimes(2);
  });

  it("re-emits Sentry after the dedup window expires", async () => {
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 10 })];

    await pollOnce(NOW);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);

    // 31 minutes later, dedup window has elapsed.
    const thirtyOneMinLater = new Date(NOW.getTime() + 31 * 60_000);
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 41 })];
    await pollOnce(thirtyOneMinLater);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(2);
  });

  it("does not crash when Sentry capture throws", async () => {
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 10 })];
    sentryCaptureMessage.mockImplementation(() => {
      throw new Error("Sentry transport down");
    });

    const count = await pollOnce(NOW);

    expect(count).toBe(1);
    // The warn log still fires
    expect(logSpy.warn).toHaveBeenCalled();
  });

  it("single-flight guard: skips overlapping pollOnce calls", async () => {
    // Make the DB query slow by deferring its resolution.
    let resolveQuery: ((rows: any[]) => void) | null = null;
    selectResult.rows = [];
    // Override the chain's then to capture the resolver so we can hold
    // the promise open and fire a second pollOnce while the first is mid-flight.
    const dbModule = await import("../db/index.js");
    const slowChain: any = {};
    slowChain.from = () => slowChain;
    slowChain.where = () => slowChain;
    slowChain.then = (resolve: any) => {
      resolveQuery = resolve;
    };
    const originalSelect = dbModule.db.select;
    (dbModule.db as any).select = () => slowChain;

    try {
      // Start the first poll — it will hang until we call resolveQuery.
      const firstPoll = pollOnce(NOW);
      // Give the microtask queue a tick so `running = true` is set.
      await Promise.resolve();
      // Fire a second poll while the first is still in flight.
      const secondPoll = pollOnce(NOW);
      const secondCount = await secondPoll;
      // Second call should bail out immediately with 0.
      expect(secondCount).toBe(0);
      expect(logSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining("previous cycle still running"),
      );
      // Now release the first poll.
      resolveQuery!([]);
      await firstPoll;
    } finally {
      (dbModule.db as any).select = originalSelect;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// startStuckDeploymentMonitor / stopStuckDeploymentMonitor
// ═══════════════════════════════════════════════════════════════════════
describe("startStuckDeploymentMonitor", () => {
  it("runs pollOnce immediately on startup (not waiting for first interval)", () => {
    selectResult.rows = [];

    startStuckDeploymentMonitor(60_000);

    // The startup log fired and the immediate poll triggered a select.
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalMs: 60_000 }),
      expect.stringContaining("starting"),
    );
    // lastQuery.from is set as a side-effect of pollOnce → db.select(...).from(...)
    expect(lastQuery.from).toBeTruthy();
  });

  it("returns the same timer when called twice (idempotent)", () => {
    selectResult.rows = [];

    const t1 = startStuckDeploymentMonitor(60_000);
    const t2 = startStuckDeploymentMonitor(60_000);

    expect(t2).toBe(t1);
    // Second call logs a "already running" debug message.
    expect(logSpy.debug).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );
  });

  it("schedules subsequent polls on the configured interval", async () => {
    vi.useFakeTimers();
    selectResult.rows = [];

    startStuckDeploymentMonitor(10_000);
    // Clear the immediate-startup query record.
    lastQuery.from = null;

    // Advance time by one interval and let the queued microtasks resolve.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lastQuery.from).toBeTruthy();
  });

  it("stopStuckDeploymentMonitor clears the timer and resets dedup state", async () => {
    vi.useFakeTimers();
    selectResult.rows = [makeDeployment({ id: "dep-1", ageMinutes: 10 })];

    startStuckDeploymentMonitor(10_000);
    // Wait for the immediate-startup pollOnce to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    sentryCaptureMessage.mockClear();

    stopStuckDeploymentMonitor();

    // After stop, the interval should not fire any more polls.
    lastQuery.from = null;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastQuery.from).toBeNull();

    // And dedup state was cleared, so a fresh pollOnce re-emits.
    await pollOnce(NOW);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it("stop is safe to call when monitor was never started", () => {
    expect(() => stopStuckDeploymentMonitor()).not.toThrow();
  });

  it("uses POLL_INTERVAL_MS as the default interval", () => {
    selectResult.rows = [];

    startStuckDeploymentMonitor();

    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalMs: POLL_INTERVAL_MS }),
      expect.any(String),
    );
  });
});
