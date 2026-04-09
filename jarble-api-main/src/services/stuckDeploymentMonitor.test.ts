/**
 * Tests for stuckDeploymentMonitor.ts — observability ticker for
 * deployments stuck in transitional states.
 *
 * Wave 4 Layer C extends the original 17 tests with K8s + Longhorn
 * mocks and 8+ new tests for the diagnosis helper and orphan cleanup
 * ticker. The original tests are preserved unchanged below.
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
  const updateCalls: Array<{ set: any; where: any }> = [];
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
  // K8s client mocks — Wave 4 Layer C. Tests that don't override these
  // get an empty pod list + 404s, which the diagnose helper's
  // graceful-degradation path turns into `null` (= no diagnosis,
  // generic warning fires as before).
  const listNamespacedPod = vi.fn().mockResolvedValue({ body: { items: [] } });
  const readNamespacedPersistentVolumeClaim = vi.fn().mockRejectedValue(
    Object.assign(new Error("not found"), { statusCode: 404 }),
  );
  const getNamespacedCustomObject = vi.fn().mockRejectedValue(
    Object.assign(new Error("not found"), { statusCode: 404 }),
  );
  return {
    selectResult,
    updateCalls,
    lastQuery,
    sentryCaptureMessage,
    logSpy,
    listNamespacedPod,
    readNamespacedPersistentVolumeClaim,
    getNamespacedCustomObject,
  };
});
const {
  selectResult,
  updateCalls,
  lastQuery,
  sentryCaptureMessage,
  logSpy,
  listNamespacedPod,
  readNamespacedPersistentVolumeClaim,
  getNamespacedCustomObject,
} = hoisted;

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

  // Wave 4 Layer C: stub `db.update(table).set(...).where(...)` chain
  // so the monitor can flip statuses to `failed`. Each call is recorded
  // in `hoisted.updateCalls` for assertion.
  const updateChain: any = {};
  updateChain.set = (set: any) => {
    updateChain._lastSet = set;
    return updateChain;
  };
  updateChain.where = (where: any) => {
    hoisted.updateCalls.push({ set: updateChain._lastSet, where });
    return Promise.resolve();
  };

  return {
    db: {
      select: (cols: any) => {
        hoisted.lastQuery.columns = cols;
        return chain;
      },
      update: (_table: any) => updateChain,
    },
    tables: {
      deployments: {
        id: { name: "id" },
        name: { name: "name" },
        userId: { name: "user_id" },
        runtime: { name: "runtime" },
        status: { name: "status" },
        storageMb: { name: "storage_mb" },
        error: { name: "error" },
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
  eq: (col: any, value: any) => ({ op: "eq", col, value }),
  inArray: (col: any, values: any[]) => ({ op: "inArray", col, values }),
  lt: (col: any, value: any) => ({ op: "lt", col, value }),
}));

// Wave 4 Layer C: K8s client mock. The default mocks return empty/404
// so the diagnose helper falls through to `null` for tests that don't
// install custom K8s state. Individual tests can update the spy
// implementations to inject pod / PVC / Longhorn responses.
vi.mock("../k8s/client.js", () => ({
  coreApi: {
    listNamespacedPod: (...args: any[]) => hoisted.listNamespacedPod(...args),
    readNamespacedPersistentVolumeClaim: (...args: any[]) =>
      hoisted.readNamespacedPersistentVolumeClaim(...args),
  },
  customApi: {
    getNamespacedCustomObject: (...args: any[]) =>
      hoisted.getNamespacedCustomObject(...args),
  },
}));

vi.mock("../k8s/constants.js", () => ({
  NAMESPACE: "jarble",
}));

// Wave 4 Layer C: lifecycle + nodeManager mocks for the orphan ticker.
// Tests can re-bind these via the hoisted spy if they need to verify
// orphan-cleanup invocations.
const lifecycleHoisted = vi.hoisted(() => ({
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  checkScaleDown: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../k8s/lifecycle.js", () => ({
  deleteDeployment: (...args: any[]) =>
    lifecycleHoisted.deleteDeployment(...args),
}));
vi.mock("../k8s/nodeManager.js", () => ({
  checkScaleDown: (...args: any[]) =>
    lifecycleHoisted.checkScaleDown(...args),
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
  cleanupOrphansOnce,
  startOrphanCleanupMonitor,
  diagnoseStuckDeployment,
  __setDiagnoseStuckDeploymentFn,
  __setOrphanCleanupFns,
  POLL_INTERVAL_MS,
  STUCK_THRESHOLD_MS,
  STUCK_STATES,
  ORPHAN_AGE_THRESHOLD_MS,
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
  // `clearAllMocks` only clears call history, not mock implementations.
  // The "does not crash when Sentry capture throws" test installs a
  // throwing impl on `sentryCaptureMessage` that would otherwise leak
  // into Wave 4 Layer C tests (where the dedup logic depends on the
  // post-capture `lastSentryEmitAt.set` actually running). Explicitly
  // reset the impl back to a no-op spy here.
  sentryCaptureMessage.mockReset();
  selectResult.rows = [];
  updateCalls.length = 0;
  lastQuery.columns = null;
  lastQuery.from = null;
  lastQuery.where = null;
  // Reset K8s mocks to their safe defaults so existing tests continue
  // to fall through to the generic warning path.
  listNamespacedPod.mockReset().mockResolvedValue({ body: { items: [] } });
  readNamespacedPersistentVolumeClaim
    .mockReset()
    .mockRejectedValue(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
  getNamespacedCustomObject
    .mockReset()
    .mockRejectedValue(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
  // Ensure no leftover monitor from a prior test. Note: stop() clears
  // the diagnose injection back to the default impl, so we install our
  // sync-null override AFTER stop() to avoid being clobbered.
  stopStuckDeploymentMonitor();
  // Reset diagnose + orphan injection. The default diagnose installed
  // here returns `null` SYNCHRONOUSLY so the existing 17 tests still
  // see the generic time-based warning path without an extra microtask
  // hop. Tests for Wave 4 Layer C diagnosis explicitly install a richer
  // diagnose fn that returns a Promise<StuckDiagnosis>.
  __setDiagnoseStuckDeploymentFn((() => null) as any);
  __setOrphanCleanupFns({ deleteFn: null, scaleDownFn: null });
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

// ═══════════════════════════════════════════════════════════════════════
// Wave 4 Layer C: Longhorn diagnosis + orphan cleanup
// ═══════════════════════════════════════════════════════════════════════
//
// These tests cover the new Wave 4 helpers added on top of the original
// Wave 3epsilon stuckDeploymentMonitor:
//   * `diagnoseStuckDeployment` queries pod / PVC / Longhorn volume CR
//     for the actual root cause of a stuck deployment
//   * `pollOnce` consumes the diagnosis and emits a precise message,
//     auto-flipping the row to `failed` when the diagnosis is unrecoverable
//   * `cleanupOrphansOnce` reaps K8s resources for `failed` deployments
//     older than ORPHAN_AGE_THRESHOLD_MS and asks nodeManager to scale
//     down empty Hetzner workers
//
// All K8s + lifecycle interactions are mocked so the tests never touch
// a real cluster.

describe("Wave 4 Layer C: diagnoseStuckDeployment", () => {
  it("detects Longhorn LocalReplicaSchedulingFailure and returns an unrecoverable diagnosis with the precise size", async () => {
    // Pod is Pending, PVC requests 30Gi, Longhorn volume condition says
    // Scheduled=False with reason=LocalReplicaSchedulingFailure and an
    // "insufficient storage" message.
    listNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            status: { phase: "Pending", containerStatuses: [] },
            spec: {
              volumes: [
                {
                  persistentVolumeClaim: { claimName: "pvc-dep-stuck-1" },
                },
              ],
            },
          },
        ],
      },
    });
    readNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        spec: {
          volumeName: "pvc-d-12345",
          resources: { requests: { storage: "30Gi" } },
        },
      },
    });
    getNamespacedCustomObject.mockResolvedValue({
      body: {
        status: {
          conditions: [
            {
              type: "Scheduled",
              status: "False",
              reason: "LocalReplicaSchedulingFailure",
              message:
                "replica scheduling failed: insufficient storage on node jarble-auto-x",
            },
          ],
        },
      },
    });

    // Reset diagnose injection so the REAL default impl runs against
    // our K8s mocks instead of the sync-null no-op installed in beforeEach.
    __setDiagnoseStuckDeploymentFn(null);

    const diagnosis = await diagnoseStuckDeployment({
      id: "dep-stuck-1",
      name: "my-stuck-bot",
      storageMb: 30,
    });

    expect(diagnosis).not.toBeNull();
    expect(diagnosis?.failureKind).toBe("longhorn_storage");
    expect(diagnosis?.unrecoverable).toBe(true);
    expect(diagnosis?.message).toContain("LocalReplicaSchedulingFailure");
    expect(diagnosis?.message).toContain("30Gi");
    expect(diagnosis?.message).toContain("insufficient storage");
    expect(diagnosis?.message).toContain("dep-stuck-1");
    expect(diagnosis?.message).toContain("my-stuck-bot");
    // Verifies the actionable recommendation is in the message
    expect(diagnosis?.message.toLowerCase()).toMatch(
      /reduce.*pvc.*size|upgrade.*node/,
    );
  });

  it("returns null when the pod is found and Longhorn looks healthy (falls through to generic warning)", async () => {
    // Pod is Pending, PVC bound, but Longhorn Scheduled=True.
    listNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            status: { phase: "Pending", containerStatuses: [] },
            spec: {
              volumes: [
                { persistentVolumeClaim: { claimName: "pvc-dep-1" } },
              ],
            },
          },
        ],
      },
    });
    readNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        spec: {
          volumeName: "pvc-x",
          resources: { requests: { storage: "20Gi" } },
        },
      },
    });
    getNamespacedCustomObject.mockResolvedValue({
      body: {
        status: { conditions: [{ type: "Scheduled", status: "True" }] },
      },
    });

    __setDiagnoseStuckDeploymentFn(null);

    const diagnosis = await diagnoseStuckDeployment({
      id: "dep-1",
      name: "ok-bot",
      storageMb: 20,
    });

    expect(diagnosis).toBeNull();
  });

  it("returns null when the K8s API is unreachable (graceful degradation, never throws)", async () => {
    listNamespacedPod.mockRejectedValue(
      new Error("ECONNREFUSED 10.0.0.1:6443"),
    );

    __setDiagnoseStuckDeploymentFn(null);

    // Must not throw — graceful degradation is the contract.
    const diagnosis = await diagnoseStuckDeployment({
      id: "dep-network-fail",
      name: "x",
      storageMb: 20,
    });

    expect(diagnosis).toBeNull();
  });

  it("detects ImagePullBackOff and returns a non-unrecoverable diagnosis", async () => {
    listNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            status: {
              phase: "Pending",
              containerStatuses: [
                {
                  state: {
                    waiting: {
                      reason: "ImagePullBackOff",
                      message: "manifest unknown",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    __setDiagnoseStuckDeploymentFn(null);

    const diagnosis = await diagnoseStuckDeployment({
      id: "dep-img",
      name: "img-bot",
      storageMb: null,
    });

    expect(diagnosis).not.toBeNull();
    expect(diagnosis?.failureKind).toBe("image_pull");
    expect(diagnosis?.unrecoverable).toBe(false);
    expect(diagnosis?.message).toContain("ImagePullBackOff");
  });
});

describe("Wave 4 Layer C: pollOnce + diagnosis integration", () => {
  it("emits the precise Longhorn message and flips status to failed when diagnosis is unrecoverable", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-storage", name: "stuck-bot", ageMinutes: 10 }),
    ];

    // Inject a deterministic Longhorn-storage diagnosis (avoids the real
    // default impl needing to walk the K8s API for this test).
    __setDiagnoseStuckDeploymentFn(async (row) => ({
      failureKind: "longhorn_storage",
      message: `Deployment ${row.name} (${row.id}) stuck: Longhorn cannot schedule a 30Gi replica because the node has insufficient storage. Either reduce the PVC size or upgrade the node tier. (LocalReplicaSchedulingFailure)`,
      unrecoverable: true,
    }));

    const count = await pollOnce(NOW);

    expect(count).toBe(1);

    // The warn log uses the precise message AND tags it with the failure_kind
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-storage",
        failureKind: "longhorn_storage",
      }),
      expect.stringContaining("LocalReplicaSchedulingFailure"),
    );

    // Sentry got the precise message with the failure_kind tag
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("LocalReplicaSchedulingFailure"),
      expect.objectContaining({
        tags: expect.objectContaining({
          failure_kind: "longhorn_storage",
          deployment_id: "dep-storage",
        }),
      }),
    );

    // The DB row was flipped to `failed` with the message in the `error` column
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("LocalReplicaSchedulingFailure"),
      }),
    );
    expect(updateCalls[0].where).toEqual(
      expect.objectContaining({ op: "eq", value: "dep-storage" }),
    );
    // The success log fired
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-storage",
        failureKind: "longhorn_storage",
      }),
      expect.stringContaining("flipped"),
    );
  });

  it("does NOT flip status when diagnosis is recoverable (e.g. ImagePullBackOff)", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-img", ageMinutes: 8 }),
    ];

    __setDiagnoseStuckDeploymentFn(async () => ({
      failureKind: "image_pull",
      message: "Deployment dep-img stuck: container image pull failed",
      unrecoverable: false,
    }));

    await pollOnce(NOW);

    // No status update
    expect(updateCalls).toHaveLength(0);
    // But the precise message + failure_kind tag still went to Sentry
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("image pull failed"),
      expect.objectContaining({
        tags: expect.objectContaining({ failure_kind: "image_pull" }),
      }),
    );
  });

  it("falls back to the generic time-based warning when diagnose throws", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-fallback", ageMinutes: 7 }),
    ];

    __setDiagnoseStuckDeploymentFn((() => {
      throw new Error("kube-apiserver timeout");
    }) as any);

    const count = await pollOnce(NOW);

    expect(count).toBe(1);
    // Warn log uses the generic message
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-fallback",
        failureKind: "unknown",
      }),
      expect.stringContaining("stuck in creating for 7m"),
    );
    // No DB update (no diagnosis)
    expect(updateCalls).toHaveLength(0);
    // Sentry tagged failure_kind=unknown
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ failure_kind: "unknown" }),
      }),
    );
  });

  it("preserves Sentry dedup window even after a precise diagnosis fires once", async () => {
    selectResult.rows = [
      makeDeployment({ id: "dep-dedup", ageMinutes: 10 }),
    ];

    __setDiagnoseStuckDeploymentFn(async (row) => ({
      failureKind: "longhorn_storage",
      message: `dep ${row.id} insufficient storage`,
      unrecoverable: true,
    }));

    // First poll — emits Sentry + flips status
    await pollOnce(NOW);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(1);

    // 5 minutes later — still inside dedup window. Sentry should NOT
    // re-emit, even though diagnosis still says unrecoverable. (We'd
    // also flip status again, but that's idempotent.)
    const fiveMinLater = new Date(NOW.getTime() + 5 * 60_000);
    selectResult.rows = [
      makeDeployment({ id: "dep-dedup", ageMinutes: 15 }),
    ];
    await pollOnce(fiveMinLater);
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("Wave 4 Layer C: cleanupOrphansOnce", () => {
  it("deletes K8s resources for failed deployments older than ORPHAN_AGE_THRESHOLD_MS and calls scaleDown", async () => {
    selectResult.rows = [
      {
        id: "dep-orphan-1",
        name: "old-failed-bot-1",
        status: "failed",
        updatedAt: new Date(NOW.getTime() - 45 * 60_000), // 45 min ago
      },
      {
        id: "dep-orphan-2",
        name: "old-failed-bot-2",
        status: "failed",
        updatedAt: new Date(NOW.getTime() - 60 * 60_000), // 60 min ago
      },
    ];

    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const scaleDownSpy = vi.fn().mockResolvedValue(undefined);
    __setOrphanCleanupFns({ deleteFn, scaleDownFn: scaleDownSpy });

    const cleaned = await cleanupOrphansOnce(NOW);

    expect(cleaned).toBe(2);
    expect(deleteFn).toHaveBeenCalledTimes(2);
    expect(deleteFn).toHaveBeenCalledWith("dep-orphan-1");
    expect(deleteFn).toHaveBeenCalledWith("dep-orphan-2");
    expect(scaleDownSpy).toHaveBeenCalledTimes(1);
    // The query filters by status=failed AND updatedAt < cutoff
    expect(lastQuery.where).toEqual(
      expect.objectContaining({
        op: "and",
        conds: expect.arrayContaining([
          expect.objectContaining({ op: "eq", value: "failed" }),
          expect.objectContaining({ op: "lt" }),
        ]),
      }),
    );
    const ltCond = (lastQuery.where as any).conds.find(
      (c: any) => c.op === "lt",
    );
    expect(ltCond.value.getTime()).toBe(
      NOW.getTime() - ORPHAN_AGE_THRESHOLD_MS,
    );
  });

  it("returns 0 and skips scaleDown when there are no orphans", async () => {
    selectResult.rows = [];
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const scaleDownSpy = vi.fn().mockResolvedValue(undefined);
    __setOrphanCleanupFns({ deleteFn, scaleDownFn: scaleDownSpy });

    const cleaned = await cleanupOrphansOnce(NOW);

    expect(cleaned).toBe(0);
    expect(deleteFn).not.toHaveBeenCalled();
    expect(scaleDownSpy).not.toHaveBeenCalled();
  });

  it("continues cleaning remaining orphans when one delete fails", async () => {
    selectResult.rows = [
      {
        id: "dep-fail-delete",
        name: "x",
        status: "failed",
        updatedAt: new Date(NOW.getTime() - 60 * 60_000),
      },
      {
        id: "dep-ok",
        name: "y",
        status: "failed",
        updatedAt: new Date(NOW.getTime() - 60 * 60_000),
      },
    ];

    const deleteFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("kube apiserver 500"))
      .mockResolvedValueOnce(undefined);
    const scaleDownSpy = vi.fn().mockResolvedValue(undefined);
    __setOrphanCleanupFns({ deleteFn, scaleDownFn: scaleDownSpy });

    const cleaned = await cleanupOrphansOnce(NOW);

    // 1 succeeded, 1 failed → still 1 cleaned, but scaleDown still ran
    expect(cleaned).toBe(1);
    expect(deleteFn).toHaveBeenCalledTimes(2);
    expect(scaleDownSpy).toHaveBeenCalledTimes(1);
    // The failure was logged
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-fail-delete" }),
      expect.stringContaining("delete failed"),
    );
  });

  it("single-flight guard: skips overlapping cleanupOrphansOnce calls", async () => {
    // Defer the DB query so we can fire a second cleanupOrphans while the
    // first is in flight.
    let resolveQuery: ((rows: any[]) => void) | null = null;
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
      const first = cleanupOrphansOnce(NOW);
      // Allow `orphanRunning = true` to take effect.
      await Promise.resolve();
      const second = cleanupOrphansOnce(NOW);
      const secondCount = await second;
      expect(secondCount).toBe(0);
      expect(logSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining("previous cycle still running"),
      );
      // Release the first call so it doesn't leak.
      resolveQuery!([]);
      await first;
    } finally {
      (dbModule.db as any).select = originalSelect;
    }
  });

  it("does NOT touch deployments in non-failed states (conservative filter)", async () => {
    // Even if the DB mock returns these (e.g. an over-broad filter
    // somehow slipped through), the orphan cleanup query MUST be
    // SELECTing with status=failed. Verify the WHERE clause directly.
    selectResult.rows = [];
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    __setOrphanCleanupFns({ deleteFn, scaleDownFn: vi.fn() });

    await cleanupOrphansOnce(NOW);

    const eqCond = (lastQuery.where as any).conds.find(
      (c: any) => c.op === "eq",
    );
    expect(eqCond.value).toBe("failed");
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("startOrphanCleanupMonitor schedules a recurring ticker, runs once immediately, and is idempotent", async () => {
    selectResult.rows = [];
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    __setOrphanCleanupFns({ deleteFn, scaleDownFn: vi.fn() });

    const t1 = startOrphanCleanupMonitor(60_000);
    expect(t1).not.toBeNull();
    // Immediate run scheduled.
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalMs: 60_000 }),
      expect.stringContaining("orphan cleanup"),
    );

    // Idempotent — second start returns the same timer.
    const t2 = startOrphanCleanupMonitor(60_000);
    expect(t2).toBe(t1);
    expect(logSpy.debug).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );
  });

  it("stopStuckDeploymentMonitor also clears the orphan ticker", async () => {
    selectResult.rows = [];
    __setOrphanCleanupFns({
      deleteFn: vi.fn().mockResolvedValue(undefined),
      scaleDownFn: vi.fn().mockResolvedValue(undefined),
    });

    startOrphanCleanupMonitor(60_000);
    // Stop should clear both timers without throwing.
    expect(() => stopStuckDeploymentMonitor()).not.toThrow();
    // Calling stop again is safe.
    expect(() => stopStuckDeploymentMonitor()).not.toThrow();
    // After stop, the orphan ticker is reset and can be re-started.
    const t = startOrphanCleanupMonitor(60_000);
    expect(t).not.toBeNull();
  });
});
