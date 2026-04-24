/**
 * Unit tests for waitForPodReady (JAR-89 §9).
 *
 * The helper drives both Tier 2 (process restart, fixed 2s/60s) and
 * Tier 3 (full pod restart, adaptive 1s/2s/3s for 180s) of configSync.
 * Coverage focus is on the state machine and timing semantics, not on
 * the underlying K8s status query (which has its own retry layer at
 * `k8s/status.ts`).
 *
 * Covers:
 *  1. Returns ready=true on running transition
 *  2. Returns ready=false + error on failed transition
 *  3. Returns ready=false (no error) on timeout
 *  4. Default interval is fixed 2s when intervalFn is not supplied
 *  5. Custom intervalFn is consulted with elapsed-ms argument
 *  6. ADAPTIVE_POLL_INTERVAL bands at 20s and 60s
 *  7. Stops polling immediately once a terminal state is observed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockGetStatus = vi.fn();

vi.mock("../../k8s/index.js", () => ({
  getDeploymentPodStatus: (...args: any[]) => mockGetStatus(...args),
}));

import {
  waitForPodReady,
  ADAPTIVE_POLL_INTERVAL,
} from "../../services/waitForPodReady.js";

beforeEach(() => {
  mockGetStatus.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForPodReady", () => {
  it("returns ready=true when the pod transitions to running on first poll", async () => {
    mockGetStatus.mockResolvedValueOnce({ status: "running" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: true });
    expect(mockGetStatus).toHaveBeenCalledWith("dep-1", "legacy");
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });

  it("returns ready=true when the pod becomes running after a few polls", async () => {
    mockGetStatus
      .mockResolvedValueOnce({ status: "creating" })
      .mockResolvedValueOnce({ status: "creating" })
      .mockResolvedValueOnce({ status: "running" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: true });
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
  });

  it("returns ready=false with the reported error when pod fails", async () => {
    mockGetStatus.mockResolvedValueOnce({
      status: "failed",
      error: "ImagePullBackOff",
    });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: false, error: "ImagePullBackOff" });
  });

  it("falls back to a generic error message when failed status carries no error", async () => {
    mockGetStatus.mockResolvedValueOnce({ status: "failed" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: false, error: "Pod failed" });
  });

  it("returns ready=false with no error on timeout", async () => {
    // Stay in `creating` forever — the loop should bail when the wall
    // clock crosses timeoutMs.
    mockGetStatus.mockResolvedValue({ status: "creating" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 5_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: false });
    // No `error` key set on timeout (caller can supply a timeout-specific
    // message if desired).
    expect(result.error).toBeUndefined();
  });

  it("uses a 2s default interval when intervalFn is not supplied", async () => {
    // We can observe the interval by counting polls within a known
    // window. With timeoutMs=10_000 and 2s polling, we expect ~5 polls
    // before the timeout fires.
    mockGetStatus.mockResolvedValue({ status: "creating" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 10_000 });
    await vi.runAllTimersAsync();
    await promise;

    // Allow some slop for the wall-clock check at loop top: between 4
    // and 6 polls is the legitimate range for a 2s/10s combo.
    expect(mockGetStatus.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mockGetStatus.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("consults intervalFn with the elapsed-ms argument", async () => {
    mockGetStatus.mockResolvedValue({ status: "creating" });
    const intervalFn = vi.fn().mockReturnValue(500);

    const promise = waitForPodReady("dep-1", "legacy", {
      timeoutMs: 3_000,
      intervalFn,
    });
    await vi.runAllTimersAsync();
    await promise;

    // Each call gets `elapsedMs` since polling started — must be a non-
    // negative number, monotonically non-decreasing across calls.
    expect(intervalFn).toHaveBeenCalled();
    let prev = -1;
    for (const call of intervalFn.mock.calls) {
      const elapsed = call[0] as number;
      expect(typeof elapsed).toBe("number");
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeGreaterThanOrEqual(prev);
      prev = elapsed;
    }
  });

  it("stops polling immediately once a terminal state is observed", async () => {
    mockGetStatus
      .mockResolvedValueOnce({ status: "creating" })
      .mockResolvedValueOnce({ status: "running" })
      // Anything beyond this would be a regression — assert it is never reached.
      .mockResolvedValue({ status: "failed", error: "should not happen" });

    const promise = waitForPodReady("dep-1", "legacy", { timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ready: true });
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
  });
});

describe("ADAPTIVE_POLL_INTERVAL", () => {
  it("returns 1s while elapsed < 20s (warm-boot window)", () => {
    expect(ADAPTIVE_POLL_INTERVAL(0)).toBe(1000);
    expect(ADAPTIVE_POLL_INTERVAL(10_000)).toBe(1000);
    expect(ADAPTIVE_POLL_INTERVAL(19_999)).toBe(1000);
  });

  it("returns 2s between 20s and 60s elapsed", () => {
    expect(ADAPTIVE_POLL_INTERVAL(20_000)).toBe(2000);
    expect(ADAPTIVE_POLL_INTERVAL(40_000)).toBe(2000);
    expect(ADAPTIVE_POLL_INTERVAL(59_999)).toBe(2000);
  });

  it("returns 3s once elapsed >= 60s (cold-boot npm install window)", () => {
    expect(ADAPTIVE_POLL_INTERVAL(60_000)).toBe(3000);
    expect(ADAPTIVE_POLL_INTERVAL(120_000)).toBe(3000);
    expect(ADAPTIVE_POLL_INTERVAL(180_000)).toBe(3000);
  });
});
