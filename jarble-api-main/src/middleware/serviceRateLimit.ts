/**
 * Per-Service Rate Limiting — Service Proxy Middleware
 *
 * Enforces the rate limits declared in a ServiceCard's `rateLimits` field:
 *   - requestsPerMinute: fixed 1-minute window
 *   - requestsPerDay: fixed 24-hour window
 *
 * Limits are keyed by `${deploymentId}:${serviceId}` so each buyer deployment
 * gets its own quota per service. This matches the ServiceCard semantics where
 * the creator declares limits per-consumer, not globally.
 *
 * Implementation: Delegates to a StateStore (DB-backed by default, in-memory
 * fallback). Window boundaries are aligned to clock time for consistency.
 */

import { createModuleLogger } from "../utils/logger.js";
import type { ServiceCardRateLimits } from "../services/serviceCard.js";
import type { StateStore } from "../services/stateStore.js";
import { MemoryStateStore } from "../services/memoryStateStore.js";

const log = createModuleLogger("service-rate-limit");

// ── Types ──────────────────────────────────────────────────────────────────

export type RateLimitResult = {
  allowed: true;
} | {
  allowed: false;
  /** Which limit was exceeded: "minute" or "day". */
  limitType: "minute" | "day";
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
  /** The limit that was exceeded. */
  limit: number;
  /** Current request count in the window. */
  current: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How often to run the cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Entries older than this are evicted (2x the longest window = 48 hours). */
const STALE_THRESHOLD_MS = 2 * DAY_MS;

// ── Default store ──────────────────────────────────────────────────────────

let defaultStore: StateStore = new MemoryStateStore();

/**
 * Set the default StateStore used by the rate limiter.
 * Call once at startup after the DB is initialized.
 */
export function setRateLimitStore(store: StateStore): void {
  defaultStore = store;
}

/**
 * Get the start of the current fixed window for a given duration.
 * Aligns to clock boundaries for consistency.
 */
function getWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

// ── Cleanup timer ──────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const threshold = now - STALE_THRESHOLD_MS;
    void defaultStore.cleanupStaleWindows(threshold).then((evicted) => {
      if (evicted > 0) {
        log.debug({ evicted }, "Service rate limit: cleanup sweep");
      }
    }).catch(() => {});
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit
  cleanupTimer.unref();
}

// Start the cleanup timer on module load
startCleanupTimer();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether a request is allowed under the service's rate limits.
 *
 * If `rateLimits` is undefined or both limits are undefined, the request
 * is always allowed (no rate limit configured by the creator).
 *
 * If the request is allowed, the counter is incremented atomically.
 * If denied, the counter is NOT incremented (the request didn't happen).
 *
 * @param deploymentId - The buyer's deployment ID.
 * @param serviceId    - The service ID.
 * @param rateLimits   - The rate limits from the ServiceCard (may be undefined).
 * @param now          - Current timestamp (for testing; defaults to Date.now()).
 * @param store        - Optional StateStore override (for testing).
 * @returns Whether the request is allowed, and retry info if denied.
 */
export async function checkServiceRateLimit(
  deploymentId: string,
  serviceId: string,
  rateLimits: ServiceCardRateLimits | undefined,
  now: number = Date.now(),
  store: StateStore = defaultStore,
): Promise<RateLimitResult> {
  // No rate limits configured — always allow.
  if (!rateLimits) {
    return { allowed: true };
  }

  const { requestsPerMinute, requestsPerDay } = rateLimits;

  // Both limits are undefined — always allow.
  if (requestsPerMinute === undefined && requestsPerDay === undefined) {
    return { allowed: true };
  }

  const minuteWindowStart = getWindowStart(now, MINUTE_MS);
  const dayWindowStart = getWindowStart(now, DAY_MS);

  // Check per-minute limit.
  if (requestsPerMinute !== undefined) {
    const window = await store.getRateLimitWindow(deploymentId, serviceId, "minute", minuteWindowStart);
    const count = window?.count ?? 0;
    if (count >= requestsPerMinute) {
      const retryAfterMs = (minuteWindowStart + MINUTE_MS) - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      log.warn(
        { deploymentId, serviceId, count, limit: requestsPerMinute },
        "Service rate limit: per-minute limit exceeded",
      );
      return {
        allowed: false,
        limitType: "minute",
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        limit: requestsPerMinute,
        current: count,
      };
    }
  }

  // Check per-day limit.
  if (requestsPerDay !== undefined) {
    const window = await store.getRateLimitWindow(deploymentId, serviceId, "day", dayWindowStart);
    const count = window?.count ?? 0;
    if (count >= requestsPerDay) {
      const retryAfterMs = (dayWindowStart + DAY_MS) - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      log.warn(
        { deploymentId, serviceId, count, limit: requestsPerDay },
        "Service rate limit: per-day limit exceeded",
      );
      return {
        allowed: false,
        limitType: "day",
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        limit: requestsPerDay,
        current: count,
      };
    }
  }

  // Allowed — increment both counters atomically.
  await store.incrementRateLimitWindow(deploymentId, serviceId, "minute", minuteWindowStart);
  await store.incrementRateLimitWindow(deploymentId, serviceId, "day", dayWindowStart);

  return { allowed: true };
}

/**
 * Get the current rate limit counters for a deployment+service pair.
 *
 * Useful for diagnostics and the `/debug` endpoints.
 */
export async function getRateLimitStatus(
  deploymentId: string,
  serviceId: string,
  now: number = Date.now(),
  store: StateStore = defaultStore,
): Promise<{ minuteCount: number; dayCount: number } | null> {
  const minuteWindowStart = getWindowStart(now, MINUTE_MS);
  const dayWindowStart = getWindowStart(now, DAY_MS);

  const minuteWindow = await store.getRateLimitWindow(deploymentId, serviceId, "minute", minuteWindowStart);
  const dayWindow = await store.getRateLimitWindow(deploymentId, serviceId, "day", dayWindowStart);

  if (!minuteWindow && !dayWindow) return null;

  return {
    minuteCount: minuteWindow?.count ?? 0,
    dayCount: dayWindow?.count ?? 0,
  };
}

/**
 * Reset rate limit state for a deployment+service pair.
 * Useful for admin actions and tests.
 */
export async function resetServiceRateLimit(
  deploymentId: string,
  serviceId: string,
  store: StateStore = defaultStore,
): Promise<void> {
  await store.deleteRateLimit(deploymentId, serviceId);
}

/**
 * Clear all rate limit state. Primarily used in tests.
 */
export async function resetAllServiceRateLimits(
  store: StateStore = defaultStore,
): Promise<void> {
  await store.deleteAllRateLimits();
}

// ── Backward-compatible aliases ─────────────────────────────────────────────
/** @deprecated Use checkServiceRateLimit */
export const checkPackageRateLimit = checkServiceRateLimit;
/** @deprecated Use resetServiceRateLimit */
export const resetPackageRateLimit = resetServiceRateLimit;
/** @deprecated Use resetAllServiceRateLimits */
export const resetAllPackageRateLimits = resetAllServiceRateLimits;
