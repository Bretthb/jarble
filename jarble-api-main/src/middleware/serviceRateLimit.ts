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
 * Implementation: Fixed-window counters stored in a Map. Window boundaries are
 * aligned to clock time (minute/day) for simplicity. A periodic cleanup timer
 * evicts expired entries to prevent unbounded memory growth.
 *
 * In-memory only — not shared between replicas. Acceptable for MVP.
 */

import { createModuleLogger } from "../utils/logger.js";
import type { ServiceCardRateLimits } from "../services/serviceCard.js";

const log = createModuleLogger("service-rate-limit");

// ── Types ──────────────────────────────────────────────────────────────────

interface WindowCounter {
  count: number;
  /** Start of the current window (Unix ms). */
  windowStart: number;
}

interface RateLimitEntry {
  minute: WindowCounter;
  day: WindowCounter;
}

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

// ── In-memory store ────────────────────────────────────────────────────────

const counters = new Map<string, RateLimitEntry>();

/**
 * Build the rate limit key from deployment + service IDs.
 */
function makeKey(deploymentId: string, serviceId: string): string {
  return `${deploymentId}:${serviceId}`;
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
    let evicted = 0;
    for (const [key, entry] of counters) {
      const minuteAge = now - entry.minute.windowStart;
      const dayAge = now - entry.day.windowStart;
      if (minuteAge > STALE_THRESHOLD_MS && dayAge > STALE_THRESHOLD_MS) {
        counters.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      log.debug({ evicted, remaining: counters.size }, "Service rate limit: cleanup sweep");
    }
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
 * @returns Whether the request is allowed, and retry info if denied.
 */
export function checkServiceRateLimit(
  deploymentId: string,
  serviceId: string,
  rateLimits: ServiceCardRateLimits | undefined,
  now: number = Date.now(),
): RateLimitResult {
  // No rate limits configured — always allow.
  if (!rateLimits) {
    return { allowed: true };
  }

  const { requestsPerMinute, requestsPerDay } = rateLimits;

  // Both limits are undefined — always allow.
  if (requestsPerMinute === undefined && requestsPerDay === undefined) {
    return { allowed: true };
  }

  const key = makeKey(deploymentId, serviceId);
  let entry = counters.get(key);

  const minuteWindowStart = getWindowStart(now, MINUTE_MS);
  const dayWindowStart = getWindowStart(now, DAY_MS);

  if (!entry) {
    entry = {
      minute: { count: 0, windowStart: minuteWindowStart },
      day: { count: 0, windowStart: dayWindowStart },
    };
    counters.set(key, entry);
  }

  // Reset counters if we've moved to a new window.
  if (entry.minute.windowStart !== minuteWindowStart) {
    entry.minute = { count: 0, windowStart: minuteWindowStart };
  }
  if (entry.day.windowStart !== dayWindowStart) {
    entry.day = { count: 0, windowStart: dayWindowStart };
  }

  // Check per-minute limit.
  if (requestsPerMinute !== undefined && entry.minute.count >= requestsPerMinute) {
    const retryAfterMs = (minuteWindowStart + MINUTE_MS) - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    log.warn(
      { deploymentId, serviceId, count: entry.minute.count, limit: requestsPerMinute },
      "Service rate limit: per-minute limit exceeded",
    );
    return {
      allowed: false,
      limitType: "minute",
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      limit: requestsPerMinute,
      current: entry.minute.count,
    };
  }

  // Check per-day limit.
  if (requestsPerDay !== undefined && entry.day.count >= requestsPerDay) {
    const retryAfterMs = (dayWindowStart + DAY_MS) - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    log.warn(
      { deploymentId, serviceId, count: entry.day.count, limit: requestsPerDay },
      "Service rate limit: per-day limit exceeded",
    );
    return {
      allowed: false,
      limitType: "day",
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      limit: requestsPerDay,
      current: entry.day.count,
    };
  }

  // Allowed — increment both counters.
  entry.minute.count += 1;
  entry.day.count += 1;

  return { allowed: true };
}

/**
 * Get the current rate limit counters for a deployment+service pair.
 *
 * Useful for diagnostics and the `/debug` endpoints.
 */
export function getRateLimitStatus(
  deploymentId: string,
  serviceId: string,
): { minuteCount: number; dayCount: number } | null {
  const entry = counters.get(makeKey(deploymentId, serviceId));
  if (!entry) return null;
  return {
    minuteCount: entry.minute.count,
    dayCount: entry.day.count,
  };
}

/**
 * Reset rate limit state for a deployment+service pair.
 * Useful for admin actions and tests.
 */
export function resetServiceRateLimit(
  deploymentId: string,
  serviceId: string,
): void {
  counters.delete(makeKey(deploymentId, serviceId));
}

/**
 * Clear all rate limit state. Primarily used in tests.
 */
export function resetAllServiceRateLimits(): void {
  counters.clear();
}

// ── Backward-compatible aliases ─────────────────────────────────────────────
/** @deprecated Use checkServiceRateLimit */
export const checkPackageRateLimit = checkServiceRateLimit;
/** @deprecated Use resetServiceRateLimit */
export const resetPackageRateLimit = resetServiceRateLimit;
/** @deprecated Use resetAllServiceRateLimits */
export const resetAllPackageRateLimits = resetAllServiceRateLimits;
