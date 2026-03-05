/**
 * Circuit Breaker — Per-package failure isolation for the package proxy.
 *
 * Prevents cascading failures by stopping requests to a creator API that
 * is consistently failing. Uses the standard 3-state pattern:
 *
 *   CLOSED     → Normal operation. Requests pass through. Track failures.
 *   OPEN       → Blocking. Return 503 immediately without calling upstream.
 *   HALF_OPEN  → Testing. Allow 1 request through to probe recovery.
 *
 * State transitions:
 *   CLOSED → OPEN:      After `FAILURE_THRESHOLD` consecutive failures.
 *   OPEN → HALF_OPEN:   After `RECOVERY_TIMEOUT_MS` has elapsed.
 *   HALF_OPEN → CLOSED: If the probe request succeeds.
 *   HALF_OPEN → OPEN:   If the probe request fails.
 *
 * The circuit is keyed by packageId. Each package gets its own breaker state.
 *
 * In-memory only — state is lost on restart, which is acceptable for MVP
 * (circuits re-learn quickly, and a restart implies the proxy was redeployed).
 */

import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("circuit-breaker");

// ── Configuration ──────────────────────────────────────────────────────────

/** Number of consecutive failures before the circuit opens. */
export const FAILURE_THRESHOLD = 5;

/** How long (ms) the circuit stays OPEN before transitioning to HALF_OPEN. */
export const RECOVERY_TIMEOUT_MS = 60_000; // 60 seconds

// ── Types ──────────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitStatus {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  /** When the circuit last transitioned to OPEN (null if never opened). */
  openedAt: number | null;
}

interface BreakerEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

// ── In-memory store ────────────────────────────────────────────────────────

const breakers = new Map<string, BreakerEntry>();

/**
 * Get or create a breaker entry for a package.
 */
function getEntry(packageId: string): BreakerEntry {
  let entry = breakers.get(packageId);
  if (!entry) {
    entry = {
      state: "CLOSED",
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
    };
    breakers.set(packageId, entry);
  }
  return entry;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a request is allowed through the circuit breaker.
 *
 * Call this BEFORE making the upstream request. If the circuit is OPEN and
 * the recovery timeout has not elapsed, the request should be rejected (503).
 *
 * @returns `{ allowed: true }` if the request can proceed, or
 *          `{ allowed: false, retryAfterMs }` if the circuit is open.
 */
export function canRequest(
  packageId: string,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const entry = getEntry(packageId);

  if (entry.state === "CLOSED") {
    return { allowed: true };
  }

  if (entry.state === "HALF_OPEN") {
    // In HALF_OPEN, we allow exactly one request through (the probe).
    // The proxy should call recordSuccess/recordFailure after the probe.
    return { allowed: true };
  }

  // State: OPEN
  // Check if the recovery timeout has elapsed.
  if (entry.openedAt !== null && now - entry.openedAt >= RECOVERY_TIMEOUT_MS) {
    // Transition to HALF_OPEN — allow one probe request.
    entry.state = "HALF_OPEN";
    log.info(
      { packageId, consecutiveFailures: entry.consecutiveFailures },
      "Circuit breaker: OPEN → HALF_OPEN (recovery timeout elapsed)",
    );
    return { allowed: true };
  }

  // Still OPEN, not yet time to retry.
  const retryAfterMs = entry.openedAt !== null
    ? RECOVERY_TIMEOUT_MS - (now - entry.openedAt)
    : RECOVERY_TIMEOUT_MS;

  return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
}

/**
 * Record a successful request to a package's creator API.
 *
 * Resets the failure counter and closes the circuit (if it was HALF_OPEN).
 */
export function recordSuccess(packageId: string): void {
  const entry = getEntry(packageId);

  if (entry.state === "HALF_OPEN") {
    log.info({ packageId }, "Circuit breaker: HALF_OPEN → CLOSED (probe succeeded)");
  }

  entry.state = "CLOSED";
  entry.consecutiveFailures = 0;
}

/**
 * Record a failed request to a package's creator API.
 *
 * Increments the consecutive failure counter. If the threshold is reached,
 * opens the circuit. If already HALF_OPEN, reopens immediately.
 */
export function recordFailure(packageId: string, now: number = Date.now()): void {
  const entry = getEntry(packageId);
  entry.consecutiveFailures += 1;
  entry.lastFailureAt = now;

  if (entry.state === "HALF_OPEN") {
    // Probe failed — reopen the circuit.
    entry.state = "OPEN";
    entry.openedAt = now;
    log.warn(
      { packageId, consecutiveFailures: entry.consecutiveFailures },
      "Circuit breaker: HALF_OPEN → OPEN (probe failed)",
    );
    return;
  }

  if (
    entry.state === "CLOSED" &&
    entry.consecutiveFailures >= FAILURE_THRESHOLD
  ) {
    entry.state = "OPEN";
    entry.openedAt = now;
    log.warn(
      { packageId, consecutiveFailures: entry.consecutiveFailures },
      `Circuit breaker: CLOSED → OPEN (${FAILURE_THRESHOLD} consecutive failures)`,
    );
  }
}

/**
 * Get the current circuit state for a package.
 *
 * Useful for health check endpoints and diagnostics.
 * Returns a snapshot — the state may change on the next `canRequest()` call
 * (e.g., OPEN → HALF_OPEN on recovery timeout).
 */
export function getCircuitState(packageId: string): CircuitStatus {
  const entry = getEntry(packageId);
  return {
    state: entry.state,
    consecutiveFailures: entry.consecutiveFailures,
    lastFailureAt: entry.lastFailureAt,
    openedAt: entry.openedAt,
  };
}

/**
 * Reset the circuit breaker for a package.
 *
 * Useful for admin actions (e.g., "force re-enable this package").
 */
export function resetCircuit(packageId: string): void {
  breakers.delete(packageId);
  log.info({ packageId }, "Circuit breaker: reset to CLOSED");
}

/**
 * Clear all circuit breaker state.
 *
 * Primarily used in tests.
 */
export function resetAllCircuits(): void {
  breakers.clear();
}
