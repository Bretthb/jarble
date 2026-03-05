/**
 * Per-Package Rate Limiting — Package Proxy Middleware
 *
 * Enforces the rate limits declared in a PackageCard's `rateLimits` field:
 *   - requestsPerMinute: fixed 1-minute window
 *   - requestsPerDay: fixed 24-hour window
 *
 * Limits are keyed by `${deploymentId}:${packageId}` so each buyer deployment
 * gets its own quota per package. This matches the PackageCard semantics where
 * the creator declares limits per-consumer, not globally.
 *
 * Implementation: Fixed-window counters stored in a Map. Window boundaries are
 * aligned to clock time (minute/day) for simplicity. A periodic cleanup timer
 * evicts expired entries to prevent unbounded memory growth.
 *
 * In-memory only — not shared between replicas. Acceptable for MVP.
 */

import { createModuleLogger } from "../utils/logger.js";
import type { PackageCardRateLimits } from "../services/packageCard.js";

const log = createModuleLogger("package-rate-limit");

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
 * Build the rate limit key from deployment + package IDs.
 */
function makeKey(deploymentId: string, packageId: string): string {
  return `${deploymentId}:${packageId}`;
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
      log.debug({ evicted, remaining: counters.size }, "Package rate limit: cleanup sweep");
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit
  cleanupTimer.unref();
}

// Start the cleanup timer on module load
startCleanupTimer();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether a request is allowed under the package's rate limits.
 *
 * If `rateLimits` is undefined or both limits are undefined, the request
 * is always allowed (no rate limit configured by the creator).
 *
 * If the request is allowed, the counter is incremented atomically.
 * If denied, the counter is NOT incremented (the request didn't happen).
 *
 * @param deploymentId - The buyer's deployment ID.
 * @param packageId    - The package ID.
 * @param rateLimits   - The rate limits from the PackageCard (may be undefined).
 * @param now          - Current timestamp (for testing; defaults to Date.now()).
 * @returns Whether the request is allowed, and retry info if denied.
 */
export function checkPackageRateLimit(
  deploymentId: string,
  packageId: string,
  rateLimits: PackageCardRateLimits | undefined,
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

  const key = makeKey(deploymentId, packageId);
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
      { deploymentId, packageId, count: entry.minute.count, limit: requestsPerMinute },
      "Package rate limit: per-minute limit exceeded",
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
      { deploymentId, packageId, count: entry.day.count, limit: requestsPerDay },
      "Package rate limit: per-day limit exceeded",
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
 * Get the current rate limit counters for a deployment+package pair.
 *
 * Useful for diagnostics and the `/debug` endpoints.
 */
export function getRateLimitStatus(
  deploymentId: string,
  packageId: string,
): { minuteCount: number; dayCount: number } | null {
  const entry = counters.get(makeKey(deploymentId, packageId));
  if (!entry) return null;
  return {
    minuteCount: entry.minute.count,
    dayCount: entry.day.count,
  };
}

/**
 * Reset rate limit state for a deployment+package pair.
 * Useful for admin actions and tests.
 */
export function resetPackageRateLimit(
  deploymentId: string,
  packageId: string,
): void {
  counters.delete(makeKey(deploymentId, packageId));
}

/**
 * Clear all rate limit state. Primarily used in tests.
 */
export function resetAllPackageRateLimits(): void {
  counters.clear();
}
