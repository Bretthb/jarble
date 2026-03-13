import { logger } from "../utils/logger.js";

// ── Configuration ───────────────────────────────────────────────────────

const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ||
  "http://prometheus.monitoring.svc.cluster.local:9090";

// ── Query Allowlist ─────────────────────────────────────────────────────

export const QUERY_KEYS = [
  "node_cpu",
  "node_memory",
  "node_disk",
  "pod_cpu",
  "pod_memory",
  "running_pods",
  "pod_restarts",
] as const;

export type QueryKey = (typeof QUERY_KEYS)[number];

const QUERIES: Record<QueryKey, string> = {
  node_cpu:
    '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  node_memory:
    "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100",
  node_disk:
    '(1 - (node_filesystem_avail_bytes{fstype!="tmpfs",mountpoint="/"} / node_filesystem_size_bytes{fstype!="tmpfs",mountpoint="/"})) * 100',
  pod_cpu:
    'sum(rate(container_cpu_usage_seconds_total{namespace="jarble"}[5m])) by (pod)',
  pod_memory:
    'sum(container_memory_usage_bytes{namespace="jarble"}) by (pod)',
  running_pods:
    'sum(kube_pod_status_phase{phase="Running",namespace="jarble"})',
  pod_restarts:
    'increase(kube_pod_container_status_restarts_total{namespace="jarble"}[1h])',
};

// ── Circuit Breaker ─────────────────────────────────────────────────────

let available = true;
let retryAfter = 0;
const CIRCUIT_COOLDOWN_MS = 60_000;

function checkCircuit(): boolean {
  if (available) return true;
  if (Date.now() > retryAfter) {
    available = true;
    return true;
  }
  return false;
}

function tripCircuit(): void {
  if (available) {
    logger.warn("Prometheus unavailable, disabling for 60s");
  }
  available = false;
  retryAfter = Date.now() + CIRCUIT_COOLDOWN_MS;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface MetricSample {
  metric: Record<string, string>;
  value: number;
  timestamp: number;
}

export interface TimeSeriesPoint {
  time: number;
  value: number;
}

export interface TimeSeries {
  label: string;
  data: TimeSeriesPoint[];
}

interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt: string;
}

export interface AlertInfo {
  name: string;
  severity: string;
  state: string;
  summary: string;
  startsAt: string;
}

// ── HTTP Helpers ────────────────────────────────────────────────────────

async function promFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, PROMETHEUS_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Prometheus ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as { status: string; data: unknown };
  if (json.status !== "success") {
    throw new Error(`Prometheus query failed: ${json.status}`);
  }

  available = true;
  return json.data;
}

// ── Public API ──────────────────────────────────────────────────────────

export async function queryInstant(key: QueryKey): Promise<MetricSample[]> {
  if (!checkCircuit()) return [];

  try {
    const data = (await promFetch("/api/v1/query", {
      query: QUERIES[key],
    })) as {
      result: Array<{
        metric: Record<string, string>;
        value: [number, string];
      }>;
    };

    return data.result.map((r) => ({
      metric: r.metric,
      value: parseFloat(r.value[1]),
      timestamp: r.value[0],
    }));
  } catch (err) {
    tripCircuit();
    logger.error({ err, key }, "Prometheus instant query failed");
    return [];
  }
}

export async function queryRange(
  key: QueryKey,
  start: number,
  end: number,
  step: number
): Promise<TimeSeries[]> {
  if (!checkCircuit()) return [];

  try {
    const data = (await promFetch("/api/v1/query_range", {
      query: QUERIES[key],
      start: String(start),
      end: String(end),
      step: String(step),
    })) as {
      result: Array<{
        metric: Record<string, string>;
        values: Array<[number, string]>;
      }>;
    };

    return data.result.map((r) => {
      const label =
        r.metric.instance || r.metric.pod || r.metric.job || "unknown";
      return {
        label,
        data: r.values.map(([t, v]) => ({
          time: t,
          value: parseFloat(v),
        })),
      };
    });
  } catch (err) {
    tripCircuit();
    logger.error({ err, key }, "Prometheus range query failed");
    return [];
  }
}

export async function getActiveAlerts(): Promise<AlertInfo[]> {
  if (!checkCircuit()) return [];

  try {
    const data = (await promFetch("/api/v1/alerts", {})) as {
      alerts: PrometheusAlert[];
    };

    return data.alerts
      .filter((a) => a.state === "firing")
      .map((a) => ({
        name: a.labels.alertname ?? "unknown",
        severity: a.labels.severity ?? "unknown",
        state: a.state,
        summary: a.annotations.summary ?? "",
        startsAt: a.activeAt,
      }));
  } catch (err) {
    tripCircuit();
    logger.error({ err }, "Prometheus alerts query failed");
    return [];
  }
}

export async function isReachable(): Promise<boolean> {
  if (!checkCircuit()) return false;

  try {
    await promFetch("/api/v1/query", { query: "up" });
    return true;
  } catch {
    tripCircuit();
    return false;
  }
}
