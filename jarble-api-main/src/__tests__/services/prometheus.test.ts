/**
 * Unit tests for prometheus.ts.
 *
 * The service is the API's read-side window into the cluster's
 * monitoring stack. It is consulted by the admin dashboard to render
 * node CPU / memory / disk gauges, the running-pods count, and the
 * active-alerts list. The contract has three load-bearing pieces:
 *
 *   1. **Allowlisted queries** — `QUERY_KEYS` is the only way callers
 *      pick a query. A regression that let arbitrary PromQL through
 *      would let a curious admin DoS Prometheus or read metrics
 *      outside the `jarble` namespace.
 *
 *   2. **Response shape parsing** — both instant + range responses
 *      come back as `[timestamp, "string-value"]` tuples. The
 *      service has to coerce the string to number; a regression that
 *      forgot the parseFloat would give the dashboard `NaN` charts.
 *
 *   3. **Circuit breaker** — when Prometheus is down, the service
 *      MUST stop calling it for 60s rather than hammering away on
 *      every dashboard render. Tests verify the circuit trips on
 *      failure, returns empty results without fetching while open,
 *      and auto-resets after the cooldown elapses.
 *
 * Each test uses `vi.resetModules()` + dynamic import so it sees
 * a fresh circuit (untripped) — the module-level `available` /
 * `retryAfter` are otherwise sticky between tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockFetch = vi.fn();

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Helper: build a Response-like object the SUT expects. */
function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as any;
}
function fail(status = 500, statusText = "Internal Server Error") {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ status: "error" }),
  } as any;
}

// ── QUERY_KEYS allowlist ────────────────────────────────────────────────────

describe("QUERY_KEYS", () => {
  it("exposes a fixed list of allowed query keys", async () => {
    const { QUERY_KEYS } = await import("../../services/prometheus.js");
    // The list is the source of truth — locking it down here means a
    // future PR that adds an unsafe query MUST update this test.
    expect([...QUERY_KEYS]).toEqual([
      "node_cpu",
      "node_memory",
      "node_disk",
      "pod_cpu",
      "pod_memory",
      "running_pods",
      "pod_restarts",
    ]);
  });
});

// ── isReachable ─────────────────────────────────────────────────────────────

describe("isReachable", () => {
  it("returns true when Prometheus answers a successful 'up' probe", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "success", data: { result: [] } }));
    const { isReachable } = await import("../../services/prometheus.js");

    await expect(isReachable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/v1/query");
    expect(decodeURIComponent(url)).toContain("query=up");
  });

  it("returns false when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { isReachable } = await import("../../services/prometheus.js");

    await expect(isReachable()).resolves.toBe(false);
  });

  it("returns false when Prometheus answers non-200", async () => {
    mockFetch.mockResolvedValueOnce(fail(503, "Service Unavailable"));
    const { isReachable } = await import("../../services/prometheus.js");

    await expect(isReachable()).resolves.toBe(false);
  });
});

// ── queryInstant ────────────────────────────────────────────────────────────

describe("queryInstant", () => {
  it("parses the [timestamp, string-value] tuple into MetricSample shape", async () => {
    const ts = 1700000000;
    mockFetch.mockResolvedValueOnce(
      ok({
        status: "success",
        data: {
          result: [
            { metric: { instance: "node-1" }, value: [ts, "12.5"] },
            { metric: { instance: "node-2" }, value: [ts, "0"] },
          ],
        },
      }),
    );
    const { queryInstant } = await import("../../services/prometheus.js");

    const samples = await queryInstant("node_cpu");
    expect(samples).toEqual([
      { metric: { instance: "node-1" }, value: 12.5, timestamp: ts },
      { metric: { instance: "node-2" }, value: 0, timestamp: ts },
    ]);
  });

  it("returns an empty array when Prometheus answers status: 'error'", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "error", data: { result: [] } }));
    const { queryInstant } = await import("../../services/prometheus.js");

    await expect(queryInstant("node_cpu")).resolves.toEqual([]);
  });

  it("returns an empty array when the response is non-200", async () => {
    mockFetch.mockResolvedValueOnce(fail(500));
    const { queryInstant } = await import("../../services/prometheus.js");

    await expect(queryInstant("node_cpu")).resolves.toEqual([]);
  });
});

// ── queryRange ──────────────────────────────────────────────────────────────

describe("queryRange", () => {
  it("flattens range data into TimeSeries with label derived from instance|pod|job|unknown", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        status: "success",
        data: {
          result: [
            { metric: { instance: "node-1" }, values: [[100, "1"], [200, "2"]] },
            { metric: { pod: "pod-x" }, values: [[100, "3"]] },
            { metric: { job: "kubelet" }, values: [[100, "4"]] },
            { metric: { unrelated: "y" }, values: [[100, "5"]] },
          ],
        },
      }),
    );
    const { queryRange } = await import("../../services/prometheus.js");

    const series = await queryRange("node_cpu", 100, 200, 30);
    expect(series).toHaveLength(4);
    expect(series[0].label).toBe("node-1");
    expect(series[1].label).toBe("pod-x");
    expect(series[2].label).toBe("kubelet");
    expect(series[3].label).toBe("unknown"); // fallback when no key is present
    // Values are coerced from string to number.
    expect(series[0].data).toEqual([
      { time: 100, value: 1 },
      { time: 200, value: 2 },
    ]);
  });

  it("forwards start / end / step as URL query params", async () => {
    mockFetch.mockResolvedValueOnce(ok({ status: "success", data: { result: [] } }));
    const { queryRange } = await import("../../services/prometheus.js");

    await queryRange("node_memory", 1700000000, 1700003600, 30);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/v1/query_range");
    expect(url).toContain("start=1700000000");
    expect(url).toContain("end=1700003600");
    expect(url).toContain("step=30");
  });
});

// ── getActiveAlerts ─────────────────────────────────────────────────────────

describe("getActiveAlerts", () => {
  it("filters to firing alerts and maps the response shape", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        status: "success",
        data: {
          alerts: [
            {
              labels: { alertname: "DiskFull", severity: "critical" },
              annotations: { summary: "Disk > 95%" },
              state: "firing",
              activeAt: "2026-04-24T19:00:00Z",
            },
            {
              labels: { alertname: "Pending", severity: "warning" },
              annotations: { summary: "Pod pending" },
              state: "pending", // NOT firing → must be filtered out
              activeAt: "2026-04-24T19:01:00Z",
            },
          ],
        },
      }),
    );
    const { getActiveAlerts } = await import("../../services/prometheus.js");

    const alerts = await getActiveAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      name: "DiskFull",
      severity: "critical",
      state: "firing",
      summary: "Disk > 95%",
      startsAt: "2026-04-24T19:00:00Z",
    });
  });

  it("falls back to 'unknown' for missing labels / empty summary", async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        status: "success",
        data: {
          alerts: [
            { labels: {}, annotations: {}, state: "firing", activeAt: "2026-04-24T19:00:00Z" },
          ],
        },
      }),
    );
    const { getActiveAlerts } = await import("../../services/prometheus.js");

    const [a] = await getActiveAlerts();
    expect(a.name).toBe("unknown");
    expect(a.severity).toBe("unknown");
    expect(a.summary).toBe("");
  });
});

// ── Circuit breaker ─────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  it("trips after a failure — subsequent calls within cooldown return empty without fetching", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const { isReachable, queryInstant } = await import("../../services/prometheus.js");

    // First call fails and trips the circuit.
    await expect(isReachable()).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call — circuit is open, no fetch should happen.
    await expect(queryInstant("node_cpu")).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1); // still only the first call
  });

  it("auto-resets after the 60s cooldown elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T19:00:00Z"));

    // First call fails -> trip the circuit.
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const { isReachable, queryInstant } = await import("../../services/prometheus.js");
    await isReachable();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Within cooldown — no fetch.
    await queryInstant("node_cpu");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past the 60s cooldown.
    vi.setSystemTime(new Date("2026-04-24T19:01:01Z"));

    // Now the circuit auto-resets and the next call fetches.
    mockFetch.mockResolvedValueOnce(ok({ status: "success", data: { result: [] } }));
    await queryInstant("node_cpu");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("a successful response after a transient failure keeps later calls reaching out", async () => {
    // First call succeeds — circuit stays closed.
    mockFetch.mockResolvedValueOnce(ok({ status: "success", data: { result: [] } }));
    mockFetch.mockResolvedValueOnce(ok({ status: "success", data: { result: [] } }));
    const { queryInstant } = await import("../../services/prometheus.js");

    await queryInstant("node_cpu");
    await queryInstant("node_memory");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
