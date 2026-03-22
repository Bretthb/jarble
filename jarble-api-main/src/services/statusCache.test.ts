/**
 * Tests for statusCache.ts — shared in-memory deployment status cache with pub/sub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock K8s status module
const mockGetDeploymentPodStatus = vi.fn();

vi.mock("../k8s/status.js", () => ({
  getDeploymentPodStatus: (...args: any[]) => mockGetDeploymentPodStatus(...args),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

// We need to isolate the module for each test since it has module-level state.
// Use dynamic import + vi.resetModules.

let subscribe: typeof import("./statusCache.js")["subscribe"];
let unsubscribe: typeof import("./statusCache.js")["unsubscribe"];
let unsubscribeAll: typeof import("./statusCache.js")["unsubscribeAll"];
let getCachedStatus: typeof import("./statusCache.js")["getCachedStatus"];
let getWatchedCount: typeof import("./statusCache.js")["getWatchedCount"];
let getTotalSubscriberCount: typeof import("./statusCache.js")["getTotalSubscriberCount"];

async function reimportModule() {
  vi.resetModules();
  const mod = await import("./statusCache.js");
  subscribe = mod.subscribe;
  unsubscribe = mod.unsubscribe;
  unsubscribeAll = mod.unsubscribeAll;
  getCachedStatus = mod.getCachedStatus;
  getWatchedCount = mod.getWatchedCount;
  getTotalSubscriberCount = mod.getTotalSubscriberCount;
}

describe("statusCache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetDeploymentPodStatus.mockResolvedValue({
      status: "running",
      restarts: 0,
      error: undefined,
    });
    await reimportModule();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── subscribe ───────────────────────────────────────────────────────────

  describe("subscribe", () => {
    it("returns initial status from K8s for first subscriber", async () => {
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 2,
        error: undefined,
      });

      const cb = vi.fn();
      const status = await subscribe("dep-1", cb);

      expect(status.deploymentId).toBe("dep-1");
      expect(status.status).toBe("running");
      expect(status.restarts).toBe(2);
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledWith("dep-1");
    });

    it("returns cached status for subsequent subscribers (no K8s call)", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      await subscribe("dep-1", cb1);
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledTimes(1);

      const status2 = await subscribe("dep-1", cb2);
      // Should NOT call K8s again — uses cache
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledTimes(1);
      expect(status2.status).toBe("running");
    });

    it("fetches independently for different deployment IDs", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);
      await subscribe("dep-2", cb);

      expect(mockGetDeploymentPodStatus).toHaveBeenCalledTimes(2);
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledWith("dep-1");
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledWith("dep-2");
    });

    it("starts polling loop on first subscriber", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // Verify polling is active by advancing time
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 0,
        error: "CrashLoop",
      });

      await vi.advanceTimersByTimeAsync(5000);

      // Callback should be notified of the status change
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error: "CrashLoop" })
      );
    });
  });

  // ── unsubscribe ─────────────────────────────────────────────────────────

  describe("unsubscribe", () => {
    it("removes subscriber from deployment", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      expect(getWatchedCount()).toBe(1);
      expect(getTotalSubscriberCount()).toBe(1);

      unsubscribe("dep-1", cb);

      expect(getWatchedCount()).toBe(0);
      expect(getTotalSubscriberCount()).toBe(0);
    });

    it("removes cache entry when last subscriber leaves", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      expect(getCachedStatus("dep-1")).toBeDefined();

      unsubscribe("dep-1", cb);

      expect(getCachedStatus("dep-1")).toBeUndefined();
    });

    it("keeps cache entry when other subscribers remain", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      await subscribe("dep-1", cb1);
      await subscribe("dep-1", cb2);

      expect(getTotalSubscriberCount()).toBe(2);

      unsubscribe("dep-1", cb1);

      expect(getWatchedCount()).toBe(1);
      expect(getTotalSubscriberCount()).toBe(1);
      expect(getCachedStatus("dep-1")).toBeDefined();
    });

    it("is a no-op for unknown deployment", () => {
      const cb = vi.fn();
      // Should not throw
      expect(() => unsubscribe("dep-unknown", cb)).not.toThrow();
    });

    it("is a no-op for unknown callback", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      await subscribe("dep-1", cb1);

      // cb2 was never subscribed
      unsubscribe("dep-1", cb2);

      // cb1 should still be subscribed
      expect(getTotalSubscriberCount()).toBe(1);
    });
  });

  // ── unsubscribeAll ─────────────────────────────────────────────────────

  describe("unsubscribeAll", () => {
    it("unsubscribes from multiple deployments at once", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);
      await subscribe("dep-2", cb);
      await subscribe("dep-3", cb);

      expect(getWatchedCount()).toBe(3);

      unsubscribeAll(["dep-1", "dep-2", "dep-3"], cb);

      expect(getWatchedCount()).toBe(0);
    });

    it("handles empty array", () => {
      const cb = vi.fn();
      expect(() => unsubscribeAll([], cb)).not.toThrow();
    });
  });

  // ── getCachedStatus ───────────────────────────────────────────────────

  describe("getCachedStatus", () => {
    it("returns undefined for unwatched deployment", () => {
      expect(getCachedStatus("dep-not-watched")).toBeUndefined();
    });

    it("returns current cached status", async () => {
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "creating",
        restarts: 0,
      });

      const cb = vi.fn();
      await subscribe("dep-1", cb);

      const cached = getCachedStatus("dep-1");
      expect(cached).toBeDefined();
      expect(cached!.status).toBe("creating");
    });
  });

  // ── getWatchedCount / getTotalSubscriberCount ─────────────────────────

  describe("diagnostics", () => {
    it("getWatchedCount returns number of unique deployments", async () => {
      const cb = vi.fn();
      expect(getWatchedCount()).toBe(0);

      await subscribe("dep-1", cb);
      expect(getWatchedCount()).toBe(1);

      await subscribe("dep-2", cb);
      expect(getWatchedCount()).toBe(2);

      // Same deployment, different callback
      await subscribe("dep-1", vi.fn());
      expect(getWatchedCount()).toBe(2); // Still 2 deployments
    });

    it("getTotalSubscriberCount counts all subscribers across deployments", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      expect(getTotalSubscriberCount()).toBe(0);

      await subscribe("dep-1", cb1);
      await subscribe("dep-1", cb2);
      await subscribe("dep-2", cb1);

      expect(getTotalSubscriberCount()).toBe(3);
    });
  });

  // ── Polling behavior ─────────────────────────────────────────────────────

  describe("polling", () => {
    it("notifies all subscribers on status change", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      await subscribe("dep-1", cb1);
      await subscribe("dep-1", cb2);

      // Change status
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 5,
        error: "OOMKilled",
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(cb1).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error: "OOMKilled" })
      );
      expect(cb2).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error: "OOMKilled" })
      );
    });

    it("does NOT notify when status is unchanged", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // Status stays the same
      await vi.advanceTimersByTimeAsync(5000);

      expect(cb).not.toHaveBeenCalled();
    });

    it("handles subscriber callback throwing without breaking other subscribers", async () => {
      const badCb = vi.fn().mockImplementation(() => {
        throw new Error("subscriber error");
      });
      const goodCb = vi.fn();

      await subscribe("dep-1", badCb);
      await subscribe("dep-1", goodCb);

      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 0,
      });

      await vi.advanceTimersByTimeAsync(5000);

      // Bad callback threw, but good callback should still be called
      expect(badCb).toHaveBeenCalled();
      expect(goodCb).toHaveBeenCalled();
    });

    it("handles K8s polling failure without crashing", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      mockGetDeploymentPodStatus.mockRejectedValue(new Error("K8s unreachable"));

      // Should not throw
      await vi.advanceTimersByTimeAsync(5000);

      // Callback should not be called on error
      expect(cb).not.toHaveBeenCalled();
    });

    it("polls multiple deployments in parallel", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      await subscribe("dep-1", cb1);
      await subscribe("dep-2", cb2);

      let callCount = 0;
      mockGetDeploymentPodStatus.mockImplementation(async (id: string) => {
        callCount++;
        return { status: "failed", restarts: 0 };
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(callCount).toBe(2);
      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it("stops polling when all subscribers removed", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      unsubscribe("dep-1", cb);

      mockGetDeploymentPodStatus.mockResolvedValue({ status: "failed" });

      await vi.advanceTimersByTimeAsync(15000);

      // No callbacks after unsubscribe
      expect(cb).not.toHaveBeenCalled();
    });

    it("detects change in restarts field", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // Same status, different restarts count
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 3,
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ restarts: 3 })
      );
    });

    it("detects change in error field", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // Same status, new error
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 0,
        error: "Warning: high memory usage",
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Warning: high memory usage" })
      );
    });
  });

  // ── Concurrent subscribe/unsubscribe ──────────────────────────────────

  describe("concurrent operations", () => {
    it("handles subscribe and unsubscribe in rapid succession", async () => {
      const cb = vi.fn();

      await subscribe("dep-1", cb);
      unsubscribe("dep-1", cb);
      await subscribe("dep-1", cb);

      expect(getWatchedCount()).toBe(1);
      expect(getTotalSubscriberCount()).toBe(1);
    });

    it("handles multiple subscriptions to same deployment sequentially", async () => {
      const callbacks = Array.from({ length: 5 }, () => vi.fn());

      for (const cb of callbacks) {
        await subscribe("dep-1", cb);
      }

      expect(getTotalSubscriberCount()).toBe(5);
      expect(getWatchedCount()).toBe(1);

      // K8s should only be called once (first subscriber)
      expect(mockGetDeploymentPodStatus).toHaveBeenCalledTimes(1);
    });
  });

  // ── Status transitions over time ─────────────────────────────────────

  describe("status transitions over time", () => {
    it("tracks multiple status changes sequentially", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // Change 1: running → creating
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "creating",
        restarts: 0,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ status: "creating" })
      );

      // Change 2: creating → running
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 0,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ status: "running" })
      );

      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("cached status updates after poll", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      expect(getCachedStatus("dep-1")!.status).toBe("running");

      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 0,
        error: "OOM",
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(getCachedStatus("dep-1")!.status).toBe("failed");
      expect(getCachedStatus("dep-1")!.error).toBe("OOM");
    });

    it("new subscriber gets latest cached status, not stale initial", async () => {
      const cb1 = vi.fn();
      await subscribe("dep-1", cb1);

      // Update status via poll
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 3,
      });
      await vi.advanceTimersByTimeAsync(5000);

      // New subscriber should get the latest status
      const cb2 = vi.fn();
      const status = await subscribe("dep-1", cb2);
      expect(status.status).toBe("failed");
      expect(status.restarts).toBe(3);
    });

    it("does not notify for identical consecutive poll results", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);

      // First poll — status unchanged (same as initial)
      await vi.advanceTimersByTimeAsync(5000);
      expect(cb).not.toHaveBeenCalled();

      // Second poll — still unchanged
      await vi.advanceTimersByTimeAsync(5000);
      expect(cb).not.toHaveBeenCalled();
    });

    it("re-subscribing after full unsubscribe fetches fresh status", async () => {
      const cb = vi.fn();
      await subscribe("dep-1", cb);
      unsubscribe("dep-1", cb);

      // Change the K8s status while unsubscribed
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "failed",
        restarts: 10,
      });

      // Re-subscribe — should fetch fresh from K8s
      const status = await subscribe("dep-1", cb);
      expect(status.status).toBe("failed");
      expect(status.restarts).toBe(10);
    });
  });

  // ── Edge cases with K8s responses ────────────────────────────────────

  describe("K8s response edge cases", () => {
    it("handles undefined error field from K8s", async () => {
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 0,
        error: undefined,
      });

      const cb = vi.fn();
      const status = await subscribe("dep-1", cb);

      expect(status.error).toBeUndefined();
    });

    it("handles zero restarts", async () => {
      mockGetDeploymentPodStatus.mockResolvedValue({
        status: "running",
        restarts: 0,
      });

      const cb = vi.fn();
      const status = await subscribe("dep-1", cb);
      expect(status.restarts).toBe(0);
    });

    it("handles K8s returning error on initial subscribe", async () => {
      mockGetDeploymentPodStatus.mockRejectedValue(new Error("K8s down"));

      const cb = vi.fn();
      await expect(subscribe("dep-1", cb)).rejects.toThrow("K8s down");
    });
  });
});
