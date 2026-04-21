/**
 * Unit tests for the lifecycle jobs queue (JAR-86).
 *
 * Exercises enqueue + process loop against the in-memory SQLite test mirror
 * with all K8s + configSync dependencies mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../__tests__/helpers/testDb.js";
import { lifecycleJobs as lifecycleJobsTable, deployments as deploymentsTable } from "../__tests__/helpers/testSchema.sqlite.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// ── Mock K8s surface ──────────────────────────────────────────────────────
const mockCreateDeployment = vi.fn().mockResolvedValue(undefined);
const mockStartDeployment = vi.fn().mockResolvedValue(undefined);
const mockRestartDeployment = vi.fn().mockResolvedValue(undefined);
const mockGetDeploymentPodStatus = vi.fn().mockResolvedValue({ status: "running" });

vi.mock("../k8s/index.js", () => ({
  createDeployment: (...args: any[]) => mockCreateDeployment(...args),
  startDeployment: (...args: any[]) => mockStartDeployment(...args),
  restartDeployment: (...args: any[]) => mockRestartDeployment(...args),
  getDeploymentPodStatus: (...args: any[]) => mockGetDeploymentPodStatus(...args),
}));

vi.mock("../k8s/constants.js", () => ({
  getPvcMountPath: () => "/data",
}));

// configSync is called at the end of a successful start/restart job — stub it
// and keep a handle so we can assert invocations.
const mockSyncConfigsToPvc = vi.fn().mockResolvedValue({ success: true, durationMs: 0 });
vi.mock("./configSync.js", () => ({
  syncConfigsToPvc: (...args: any[]) => mockSyncConfigsToPvc(...args),
}));

// Mock the default db/index to point at the test db tables (so that the
// service's tables.lifecycleJobs/deployments references resolve).
let testCtx: TestDbContext;
vi.mock("../db/index.js", () => ({
  get db() { return testCtx.db; },
  get tables() {
    return {
      lifecycleJobs: lifecycleJobsTable,
      deployments: deploymentsTable,
    };
  },
  dbDate: (d: Date = new Date()) => d.toISOString(),
}));

// Import AFTER mocks are set up.
import { enqueueLifecycleJob, processLifecycleJobs } from "./lifecycleJobs.js";

describe("lifecycleJobs", () => {
  beforeEach(() => {
    testCtx = createTestDb();
    // Speed up the readiness poll by returning running on the first call.
    mockGetDeploymentPodStatus.mockResolvedValue({ status: "running" });
    mockCreateDeployment.mockResolvedValue(undefined);
    mockStartDeployment.mockResolvedValue(undefined);
    mockRestartDeployment.mockResolvedValue(undefined);
    vi.clearAllMocks();
    mockGetDeploymentPodStatus.mockResolvedValue({ status: "running" });
  });

  afterEach(() => {
    testCtx.raw.close();
  });

  function seedDeployment(status: string = "creating"): string {
    const id = nanoid();
    testCtx.raw
      .prepare(`INSERT INTO deployments (id, user_id, name, runtime, status) VALUES (?, ?, ?, ?, ?)`)
      .run(id, testCtx.testUserId, "Test", "openclaw", status);
    return id;
  }

  it("enqueueLifecycleJob inserts a pending row", async () => {
    const depId = seedDeployment();
    const jobId = await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "create",
      payload: {
        type: "create",
        managedBy: "legacy",
        name: "Test",
        runtime: "openclaw",
        initialConfigs: [],
        extraSecretEntries: {},
        gatewayToken: "tok",
        isolationLevel: "standard",
        deploymentType: "agent",
      },
    });
    expect(jobId).toBeTruthy();

    const rows = await testCtx.db.query.lifecycleJobs.findMany({
      where: eq(lifecycleJobsTable.id, jobId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].deploymentId).toBe(depId);
    expect(rows[0].type).toBe("create");
  });

  it("processLifecycleJobs runs a create job and marks it completed", async () => {
    const depId = seedDeployment("creating");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "create",
      payload: {
        type: "create",
        managedBy: "legacy",
        name: "Test",
        runtime: "openclaw",
        initialConfigs: [],
        extraSecretEntries: {},
        gatewayToken: "tok",
        isolationLevel: "standard",
        deploymentType: "agent",
      },
    });

    const count = await processLifecycleJobs(testCtx.db);
    expect(count).toBe(1);
    expect(mockCreateDeployment).toHaveBeenCalledTimes(1);

    // Deployment row should flip to running.
    const dep = await testCtx.db.query.deployments.findFirst({
      where: eq(deploymentsTable.id, depId),
    });
    expect(dep?.status).toBe("running");

    // Job row should be completed.
    const jobs = await testCtx.db.query.lifecycleJobs.findMany({
      where: eq(lifecycleJobsTable.deploymentId, depId),
    });
    expect(jobs[0].status).toBe("completed");
  });

  it("start job calls startDeployment when not in failed state", async () => {
    const depId = seedDeployment("creating");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "start",
      payload: {
        type: "start",
        managedBy: "legacy",
        wasFailedState: false,
        deployConfig: { name: "Test", runtime: "openclaw" },
      },
    });

    await processLifecycleJobs(testCtx.db);
    expect(mockStartDeployment).toHaveBeenCalledTimes(1);
    expect(mockRestartDeployment).not.toHaveBeenCalled();
  });

  it("start job calls restartDeployment when wasFailedState=true", async () => {
    const depId = seedDeployment("creating");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "start",
      payload: {
        type: "start",
        managedBy: "legacy",
        wasFailedState: true,
        deployConfig: { name: "Test", runtime: "openclaw" },
      },
    });

    await processLifecycleJobs(testCtx.db);
    expect(mockRestartDeployment).toHaveBeenCalledTimes(1);
    expect(mockStartDeployment).not.toHaveBeenCalled();
  });

  it("restart job flips status from restarting to running", async () => {
    const depId = seedDeployment("restarting");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "restart",
      payload: {
        type: "restart",
        managedBy: "legacy",
        deployConfig: { name: "Test", runtime: "openclaw" },
      },
    });

    await processLifecycleJobs(testCtx.db);
    expect(mockRestartDeployment).toHaveBeenCalledTimes(1);
    const dep = await testCtx.db.query.deployments.findFirst({
      where: eq(deploymentsTable.id, depId),
    });
    expect(dep?.status).toBe("running");
  });

  it("restart job syncs configs to the fresh pod on success (JAR-126)", async () => {
    const depId = seedDeployment("restarting");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "restart",
      payload: {
        type: "restart",
        managedBy: "legacy",
        deployConfig: { name: "Test", runtime: "openclaw" },
      },
    });

    await processLifecycleJobs(testCtx.db);
    // Config sync is dispatched via safeFireAndForget, so give the microtask
    // queue a tick to resolve before asserting.
    await new Promise((r) => setImmediate(r));
    expect(mockSyncConfigsToPvc).toHaveBeenCalledWith(depId);
  });

  it("restart job does NOT sync configs when pod never reaches ready (JAR-126)", async () => {
    mockGetDeploymentPodStatus.mockResolvedValue({ status: "failed" });
    const depId = seedDeployment("restarting");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "restart",
      payload: {
        type: "restart",
        managedBy: "legacy",
        deployConfig: { name: "Test", runtime: "openclaw" },
      },
    });

    await processLifecycleJobs(testCtx.db);
    await new Promise((r) => setImmediate(r));
    expect(mockSyncConfigsToPvc).not.toHaveBeenCalled();
  });

  it("retries on transient error and bumps attempts", async () => {
    mockCreateDeployment.mockRejectedValueOnce(new Error("k8s flake"));
    const depId = seedDeployment("creating");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "create",
      payload: {
        type: "create",
        managedBy: "legacy",
        name: "Test",
        runtime: "openclaw",
        initialConfigs: [],
        extraSecretEntries: {},
        gatewayToken: "tok",
        isolationLevel: "standard",
        deploymentType: "agent",
      },
      maxAttempts: 3,
    });

    await processLifecycleJobs(testCtx.db);

    const jobs = await testCtx.db.query.lifecycleJobs.findMany({
      where: eq(lifecycleJobsTable.deploymentId, depId),
    });
    expect(jobs[0].status).toBe("pending"); // re-queued
    expect(jobs[0].attempts).toBe(1);
    expect(jobs[0].lastError).toContain("k8s flake");
  });

  it("marks job failed after exhausting retries", async () => {
    mockCreateDeployment.mockRejectedValue(new Error("permanent failure"));
    const depId = seedDeployment("creating");
    await enqueueLifecycleJob(testCtx.db, {
      deploymentId: depId,
      userId: testCtx.testUserId,
      type: "create",
      payload: {
        type: "create",
        managedBy: "legacy",
        name: "Test",
        runtime: "openclaw",
        initialConfigs: [],
        extraSecretEntries: {},
        gatewayToken: "tok",
        isolationLevel: "standard",
        deploymentType: "agent",
      },
      maxAttempts: 1,
    });

    await processLifecycleJobs(testCtx.db);

    const jobs = await testCtx.db.query.lifecycleJobs.findMany({
      where: eq(lifecycleJobsTable.deploymentId, depId),
    });
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].attempts).toBe(1);
  });

  // JAR-127 regression: the Postgres branch of claimJobs previously used
  // `WHERE id = ANY(${ids})`. Drizzle expands a JS array into a tuple expression
  // (`($1, $2, ...)`) rather than a Postgres array, so Postgres rejected the
  // query with `op ANY/ALL (array) requires array on right side` and the worker
  // never claimed any jobs. The fix switches to `IN (${sql.join(...)})`.
  //
  // The other tests in this file exercise only the SQLite branch via the
  // in-memory test mirror, so they can't catch the Postgres SQL shape. This
  // test forces the Postgres branch by temporarily flipping env vars and
  // inspecting the compiled SQL via PgDialect.
  it("claimJobs (Postgres path) compiles filter as IN (...), not ANY(...) — JAR-127", async () => {
    const savedVitest = process.env.VITEST;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";

    const executedSqls: any[] = [];
    const findManyWheres: any[] = [];
    const tx = {
      execute: vi.fn(async (chunk: any) => {
        executedSqls.push(chunk);
        if (executedSqls.length === 1) {
          return { rows: [{ id: "job-1" }, { id: "job-2" }, { id: "job-3" }] };
        }
        return { rows: [] };
      }),
      query: {
        lifecycleJobs: {
          findMany: vi.fn(async (opts: { where: any }) => {
            findManyWheres.push(opts.where);
            return [];
          }),
        },
      },
    };
    const fakeDb: any = {
      transaction: vi.fn((fn: any) => fn(tx)),
    };

    try {
      await processLifecycleJobs(fakeDb, 5);
    } finally {
      if (savedVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = savedVitest;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }

    // Expect SELECT + UPDATE to have been issued against the fake tx.
    expect(executedSqls).toHaveLength(2);
    expect(findManyWheres).toHaveLength(1);

    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();

    const updateQ = dialect.sqlToQuery(executedSqls[1]);
    expect(updateQ.sql).toMatch(/WHERE\s+id\s+IN\s*\(/i);
    expect(updateQ.sql).not.toMatch(/ANY\s*\(/i);
    expect(updateQ.params).toEqual(["job-1", "job-2", "job-3"]);

    const whereQ = dialect.sqlToQuery(findManyWheres[0]);
    expect(whereQ.sql).toMatch(/id\s+IN\s*\(/i);
    expect(whereQ.sql).not.toMatch(/ANY\s*\(/i);
    expect(whereQ.params).toEqual(["job-1", "job-2", "job-3"]);
  });

  it("only processes pending jobs whose runAfter <= now", async () => {
    const depId = seedDeployment("creating");
    // Seed a row directly with a future runAfter.
    const future = new Date(Date.now() + 60_000).toISOString();
    testCtx.raw.prepare(
      `INSERT INTO lifecycle_jobs (id, deployment_id, user_id, type, status, payload, run_after) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      "future-job",
      depId,
      testCtx.testUserId,
      "create",
      JSON.stringify({
        type: "create",
        managedBy: "legacy",
        name: "Test",
        runtime: "openclaw",
        initialConfigs: [],
        extraSecretEntries: {},
        gatewayToken: "tok",
        isolationLevel: "standard",
        deploymentType: "agent",
      }),
      future,
    );

    const count = await processLifecycleJobs(testCtx.db);
    expect(count).toBe(0);
    expect(mockCreateDeployment).not.toHaveBeenCalled();
  });
});
