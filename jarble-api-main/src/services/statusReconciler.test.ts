import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  const query = {
    deployments: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return {
    db: {
      query,
      update: vi.fn(),
    },
    tables: {
      deployments: { id: "id", status: "status", managedBy: "managedBy" },
    },
  };
});

vi.mock("../k8s/index.js", () => ({
  getDeploymentPodStatus: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  inArray: vi.fn((...args: any[]) => args),
  desc: vi.fn(),
}));

import { db } from "../db/index.js";
import { getDeploymentPodStatus } from "../k8s/index.js";
import { reconcileStatuses, startStatusReconciler } from "./statusReconciler.js";

const mockDb = vi.mocked(db) as any;
const mockGetPodStatus = vi.mocked(getDeploymentPodStatus);

function setupUpdateChain() {
  const whereFn = vi.fn().mockResolvedValue([]);
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  mockDb.update.mockReturnValue({ set: setFn } as any);
  return { setFn, whereFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.USE_SQLITE;
});

// ═══════════════════════════════════════════════════════════════════════
// reconcileStatuses
// ═══════════════════════════════════════════════════════════════════════
describe("reconcileStatuses", () => {
  it("skips when USE_SQLITE is true (local dev)", async () => {
    process.env.USE_SQLITE = "true";
    await reconcileStatuses();
    expect(mockDb.query.deployments.findMany).not.toHaveBeenCalled();
  });

  it("returns early when no drift candidates found", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([]);
    await reconcileStatuses();
    expect(mockGetPodStatus).not.toHaveBeenCalled();
  });

  it("checks pod status for creating deployments", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "creating" });

    await reconcileStatuses();

    expect(mockGetPodStatus).toHaveBeenCalledWith("dep-1", "legacy");
  });

  it("fixes creating → running mismatch", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", status: "creating",
    } as any);
    const { setFn } = setupUpdateChain();

    await reconcileStatuses();

    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: "running",
      error: null, // clear error on running
    }));
  });

  it("fixes creating → failed mismatch", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({
      status: "failed",
      error: "CrashLoopBackOff",
      phase: "Running",
    });
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", status: "creating",
    } as any);
    const { setFn } = setupUpdateChain();

    await reconcileStatuses();

    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      error: "CrashLoopBackOff",
    }));
  });

  it("fixes running → stopped when pod not found", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "not_found" });
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", status: "running",
    } as any);
    const { setFn } = setupUpdateChain();

    await reconcileStatuses();

    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: "stopped",
    }));
  });

  it("does not downgrade running → creating (temporary probe failure)", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "creating", phase: "Running" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not change restarting when K8s shows creating", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "restarting", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "creating", phase: "Pending" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not change reloading when K8s shows creating", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "reloading", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "creating", phase: "Pending" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not update when creating deployment has no pod yet", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "not_found" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not update when restarting deployment has no pod yet", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "restarting", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "not_found" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not update when status already matches K8s", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("skips fix when deployment was deleted between check and apply", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });
    mockDb.query.deployments.findFirst.mockResolvedValue(null as any);

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("skips fix when status changed between check and apply", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", status: "running", // already changed!
    } as any);

    await reconcileStatuses();

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("uses managedBy from deployment record", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: "operator" },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });

    await reconcileStatuses();

    expect(mockGetPodStatus).toHaveBeenCalledWith("dep-1", "operator");
  });

  it("defaults to legacy when managedBy is null", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });

    await reconcileStatuses();

    expect(mockGetPodStatus).toHaveBeenCalledWith("dep-1", "legacy");
  });

  it("handles multiple deployments in one sweep", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
      { id: "dep-2", status: "running", name: "bot-2", managedBy: null },
      { id: "dep-3", status: "creating", name: "bot-3", managedBy: null },
    ] as any);

    mockGetPodStatus
      .mockResolvedValueOnce({ status: "running", phase: "Running" })
      .mockResolvedValueOnce({ status: "running", phase: "Running" })
      .mockResolvedValueOnce({ status: "failed", error: "OOMKilled", phase: "Running" });

    mockDb.query.deployments.findFirst
      .mockResolvedValueOnce({ id: "dep-1", status: "creating" } as any)
      .mockResolvedValueOnce({ id: "dep-3", status: "creating" } as any);

    setupUpdateChain();

    await reconcileStatuses();

    // dep-1: creating → running (mismatch)
    // dep-2: running → running (no mismatch)
    // dep-3: creating → failed (mismatch)
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it("handles K8s API errors gracefully for individual deployments", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running", name: "bot-1", managedBy: null },
      { id: "dep-2", status: "running", name: "bot-2", managedBy: null },
    ] as any);

    mockGetPodStatus
      .mockRejectedValueOnce(new Error("K8s timeout"))
      .mockResolvedValueOnce({ status: "running", phase: "Running" });

    // Should not throw - errors are caught per-deployment
    await expect(reconcileStatuses()).resolves.toBeUndefined();
  });

  it("handles DB update errors gracefully", async () => {
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating", name: "bot-1", managedBy: null },
    ] as any);
    mockGetPodStatus.mockResolvedValue({ status: "running", phase: "Running" });
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", status: "creating",
    } as any);
    mockDb.update.mockImplementation(() => {
      throw new Error("DB write failed");
    });

    // Should not throw
    await expect(reconcileStatuses()).resolves.toBeUndefined();
  });

  it("handles sweep-level DB query error gracefully", async () => {
    mockDb.query.deployments.findMany.mockRejectedValue(new Error("DB connection lost"));

    await expect(reconcileStatuses()).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// startStatusReconciler
// ═══════════════════════════════════════════════════════════════════════
describe("startStatusReconciler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately on startup", () => {
    vi.useFakeTimers();
    mockDb.query.deployments.findMany.mockResolvedValue([]);

    startStatusReconciler(60000);

    // reconcileStatuses was called (void promise)
    expect(mockDb.query.deployments.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns an interval timer", () => {
    vi.useFakeTimers();
    mockDb.query.deployments.findMany.mockResolvedValue([]);

    const timer = startStatusReconciler(60000);

    expect(timer).toBeTruthy();
    clearInterval(timer);
  });

  it("uses custom interval", () => {
    vi.useFakeTimers();
    mockDb.query.deployments.findMany.mockResolvedValue([]);

    const timer = startStatusReconciler(5000);

    // Advance time to trigger one interval
    vi.advanceTimersByTime(5000);

    // Initial call + one interval call
    expect(mockDb.query.deployments.findMany).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });
});
