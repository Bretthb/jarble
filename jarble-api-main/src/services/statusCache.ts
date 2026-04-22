/**
 * Shared in-memory status cache for deployment pod status.
 *
 * Instead of each SSE connection independently polling K8s for every
 * deployment, this cache maintains a single polling loop that queries
 * K8s once per deployment (regardless of how many clients watch it).
 *
 * Subscribers register interest in deployment IDs. The cache polls
 * K8s every POLL_INTERVAL_MS for all deployments that have at least
 * one active subscriber. On status change, all subscribers for that
 * deployment are notified.
 */

import { createModuleLogger } from "../utils/logger.js";
import { getDeploymentPodStatus, type DeploymentPodStatus } from "../k8s/status.js";
import { getDeploymentMetrics } from "../k8s/metrics.js";

const log = createModuleLogger("statusCache");

const POLL_INTERVAL_MS = 5_000;

export interface CachedStatus {
  deploymentId: string;
  status: DeploymentPodStatus["status"];
  restarts?: number;
  error?: string;
  // Resource metrics — populated when the pod is running. Absent (undefined)
  // when the pod isn't running or the metrics-server query fails.
  nodeName?: string | null;
  cpuUsageMillicores?: number | null;
  cpuLimitMillicores?: number | null;
  memoryUsageMb?: number | null;
  memoryLimitMb?: number | null;
  uptimeSeconds?: number | null;
}

async function buildCachedStatus(deploymentId: string): Promise<CachedStatus> {
  // Fetch pod status and metrics in parallel. getDeploymentMetrics returns
  // null when the pod isn't running or metrics-server is unavailable (the
  // latter is handled by an internal circuit breaker), so we merge it in
  // defensively.
  const [podStatus, metrics] = await Promise.all([
    getDeploymentPodStatus(deploymentId),
    getDeploymentMetrics(deploymentId),
  ]);

  const base: CachedStatus = {
    deploymentId,
    status: podStatus.status,
    restarts: podStatus.restarts,
    error: podStatus.error,
  };

  if (metrics) {
    base.nodeName = metrics.nodeName;
    base.cpuUsageMillicores = metrics.cpuUsageMillicores;
    base.cpuLimitMillicores = metrics.cpuLimitMillicores;
    base.memoryUsageMb = metrics.memoryUsageMb;
    base.memoryLimitMb = metrics.memoryLimitMb;
    base.uptimeSeconds = metrics.uptimeSeconds;
    // Prefer metrics.restarts if the pod status call didn't return one.
    if (base.restarts == null) base.restarts = metrics.restarts;
  }

  return base;
}

export type StatusChangeCallback = (status: CachedStatus) => void;

interface CacheEntry {
  lastStatus: CachedStatus;
  lastChecked: number;
  subscribers: Set<StatusChangeCallback>;
}

const cache = new Map<string, CacheEntry>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function serializeStatus(s: CachedStatus): string {
  return JSON.stringify(s);
}

/**
 * Start the global polling loop if not already running.
 */
function ensurePolling(): void {
  if (pollTimer) return;

  log.info("Starting shared status polling loop");
  pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
}

/**
 * Stop the global polling loop if no subscribers remain.
 */
function maybeStopPolling(): void {
  if (cache.size > 0) return;
  if (pollTimer) {
    log.info("No subscribers remaining, stopping status polling loop");
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Poll K8s for all deployments that have active subscribers.
 * Runs once per interval, regardless of subscriber count.
 */
async function pollAll(): Promise<void> {
  const entries = Array.from(cache.entries());
  if (entries.length === 0) return;

  // Query all watched deployments in parallel (one K8s call per deployment)
  const results = await Promise.allSettled(
    entries.map(async ([deploymentId, entry]) => {
      try {
        const newStatus = await buildCachedStatus(deploymentId);

        const oldSerialized = serializeStatus(entry.lastStatus);
        const newSerialized = serializeStatus(newStatus);

        entry.lastStatus = newStatus;
        entry.lastChecked = Date.now();

        // Only notify on change
        if (oldSerialized !== newSerialized) {
          for (const cb of entry.subscribers) {
            try {
              cb(newStatus);
            } catch (err) {
              log.warn({ deploymentId, err }, "Subscriber callback threw");
            }
          }
        }
      } catch (err) {
        log.error({ deploymentId, err }, "Failed to poll pod status");
      }
    })
  );
}

/**
 * Subscribe to status changes for a deployment.
 *
 * If this is the first subscriber for the deployment, an initial K8s
 * query is made and the result is returned. Otherwise the cached
 * status is returned immediately.
 *
 * @returns The current cached status (may be from cache if another subscriber already exists)
 */
export async function subscribe(
  deploymentId: string,
  callback: StatusChangeCallback
): Promise<CachedStatus> {
  let entry = cache.get(deploymentId);

  if (entry) {
    // Already being watched - add subscriber, return cached status
    entry.subscribers.add(callback);
    return entry.lastStatus;
  }

  // First subscriber for this deployment - fetch initial status from K8s
  const initialStatus = await buildCachedStatus(deploymentId);

  entry = {
    lastStatus: initialStatus,
    lastChecked: Date.now(),
    subscribers: new Set([callback]),
  };
  cache.set(deploymentId, entry);

  ensurePolling();

  return initialStatus;
}

/**
 * Unsubscribe from status changes for a deployment.
 * If no subscribers remain, the cache entry is removed.
 */
export function unsubscribe(
  deploymentId: string,
  callback: StatusChangeCallback
): void {
  const entry = cache.get(deploymentId);
  if (!entry) return;

  entry.subscribers.delete(callback);

  if (entry.subscribers.size === 0) {
    cache.delete(deploymentId);
    maybeStopPolling();
  }
}

/**
 * Convenience: unsubscribe a callback from multiple deployment IDs at once.
 */
export function unsubscribeAll(
  deploymentIds: string[],
  callback: StatusChangeCallback
): void {
  for (const id of deploymentIds) {
    unsubscribe(id, callback);
  }
}

/**
 * Get the current cached status for a deployment without subscribing.
 * Returns undefined if the deployment is not being watched.
 */
export function getCachedStatus(deploymentId: string): CachedStatus | undefined {
  return cache.get(deploymentId)?.lastStatus;
}

/**
 * Get the number of actively watched deployments (for diagnostics).
 */
export function getWatchedCount(): number {
  return cache.size;
}

/**
 * Get total subscriber count across all deployments (for diagnostics).
 */
export function getTotalSubscriberCount(): number {
  let total = 0;
  for (const entry of cache.values()) {
    total += entry.subscribers.size;
  }
  return total;
}
