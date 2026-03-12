/**
 * Circuit Breaker — Per-service failure isolation for the service proxy.
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
 * Now delegates to a StateStore for persistence (DB-backed by default,
 * shared across API replicas). HALF_OPEN probe coordination uses
 * claimHalfOpenProbe() to ensure only one replica sends the probe.
 */

import crypto from "crypto";
import { createModuleLogger } from "../utils/logger.js";
import type { StateStore, CircuitBreakerRecord } from "./stateStore.js";
import { MemoryStateStore } from "./memoryStateStore.js";

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

// ── Default store + replica ID ─────────────────────────────────────────────

let defaultStore: StateStore = new MemoryStateStore();

/** Unique identifier for this API replica — used for HALF_OPEN probe coordination. */
const REPLICA_ID = crypto.randomUUID();

/**
 * Set the default StateStore used by the circuit breaker.
 * Call once at startup after the DB is initialized.
 */
export function setCircuitBreakerStore(store: StateStore): void {
  defaultStore = store;
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
export async function canRequest(
  packageId: string,
  now: number = Date.now(),
  store: StateStore = defaultStore,
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const entry = await store.getCircuitBreaker(packageId);

  if (entry.state === "CLOSED") {
    return { allowed: true };
  }

  if (entry.state === "HALF_OPEN") {
    // In HALF_OPEN, we allow exactly one request through (the probe).
    return { allowed: true };
  }

  // State: OPEN
  // Check if the recovery timeout has elapsed.
  if (entry.openedAt !== null && now - entry.openedAt >= RECOVERY_TIMEOUT_MS) {
    // Transition to HALF_OPEN — allow one probe request.
    entry.state = "HALF_OPEN";
    entry.halfOpenClaimedBy = null;
    entry.halfOpenClaimedAt = null;
    await store.setCircuitBreaker(packageId, entry);
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
 * Record a successful request to a service's creator API.
 *
 * Resets the failure counter and closes the circuit (if it was HALF_OPEN).
 */
export async function recordSuccess(
  packageId: string,
  store: StateStore = defaultStore,
): Promise<void> {
  const entry = await store.getCircuitBreaker(packageId);

  if (entry.state === "HALF_OPEN") {
    log.info({ packageId }, "Circuit breaker: HALF_OPEN → CLOSED (probe succeeded)");
  }

  entry.state = "CLOSED";
  entry.consecutiveFailures = 0;
  entry.halfOpenClaimedBy = null;
  entry.halfOpenClaimedAt = null;
  await store.setCircuitBreaker(packageId, entry);
}

/**
 * Record a failed request to a service's creator API.
 *
 * Increments the consecutive failure counter. If the threshold is reached,
 * opens the circuit. If already HALF_OPEN, reopens immediately.
 */
export async function recordFailure(
  packageId: string,
  now: number = Date.now(),
  store: StateStore = defaultStore,
): Promise<void> {
  const entry = await store.getCircuitBreaker(packageId);
  entry.consecutiveFailures += 1;
  entry.lastFailureAt = now;

  if (entry.state === "HALF_OPEN") {
    // Probe failed — reopen the circuit.
    entry.state = "OPEN";
    entry.openedAt = now;
    entry.halfOpenClaimedBy = null;
    entry.halfOpenClaimedAt = null;
    await store.setCircuitBreaker(packageId, entry);
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
    await store.setCircuitBreaker(packageId, entry);
    log.warn(
      { packageId, consecutiveFailures: entry.consecutiveFailures },
      `Circuit breaker: CLOSED → OPEN (${FAILURE_THRESHOLD} consecutive failures)`,
    );
    return;
  }

  await store.setCircuitBreaker(packageId, entry);
}

/**
 * Get the current circuit state for a service.
 *
 * Useful for health check endpoints and diagnostics.
 * Returns a snapshot — the state may change on the next `canRequest()` call.
 */
export async function getCircuitState(
  packageId: string,
  store: StateStore = defaultStore,
): Promise<CircuitStatus> {
  const entry = await store.getCircuitBreaker(packageId);
  return {
    state: entry.state,
    consecutiveFailures: entry.consecutiveFailures,
    lastFailureAt: entry.lastFailureAt,
    openedAt: entry.openedAt,
  };
}

/**
 * Reset the circuit breaker for a service.
 *
 * Useful for admin actions (e.g., "force re-enable this service").
 */
export async function resetCircuit(
  packageId: string,
  store: StateStore = defaultStore,
): Promise<void> {
  await store.deleteCircuitBreaker(packageId);
  log.info({ packageId }, "Circuit breaker: reset to CLOSED");
}

/**
 * Clear all circuit breaker state.
 *
 * Primarily used in tests.
 */
export async function resetAllCircuits(
  store: StateStore = defaultStore,
): Promise<void> {
  await store.deleteAllCircuitBreakers();
}
