/**
 * StateStore - Abstraction for rate limiter and circuit breaker state.
 *
 * Allows swapping between in-memory (single-replica) and DB-backed
 * (shared across replicas) storage without touching consumer code.
 * A future Redis implementation can slot in without changes to callers.
 */

// ── Rate Limit Types ──────────────────────────────────────────────────────

export interface RateLimitWindow {
  count: number;
  windowStart: number;
}

// ── Circuit Breaker Types ─────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerRecord {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  halfOpenClaimedBy: string | null;
  halfOpenClaimedAt: number | null;
}

// ── StateStore Interface ──────────────────────────────────────────────────

export interface StateStore {
  // ── Rate Limiting ─────────────────────────────────────────────────────

  /** Get the current counter for a window. Returns null if no entry exists. */
  getRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<RateLimitWindow | null>;

  /** Atomically increment the counter for a window. Creates the entry if needed. */
  incrementRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<number>;

  /** Delete stale windows older than the given threshold (Unix ms). */
  cleanupStaleWindows(olderThan: number): Promise<number>;

  /** Delete a specific deployment+service rate limit entry. */
  deleteRateLimit(deploymentId: string, serviceId: string): Promise<void>;

  /** Delete all rate limit entries. */
  deleteAllRateLimits(): Promise<void>;

  // ── Circuit Breaker ───────────────────────────────────────────────────

  /** Get the current circuit breaker state for a service. Returns a default CLOSED record if none exists. */
  getCircuitBreaker(serviceId: string): Promise<CircuitBreakerRecord>;

  /** Upsert the circuit breaker state. */
  setCircuitBreaker(serviceId: string, record: CircuitBreakerRecord): Promise<void>;

  /** Attempt to claim the HALF_OPEN probe for a service. Returns true if this replica won the claim. */
  claimHalfOpenProbe(serviceId: string, replicaId: string, now: number): Promise<boolean>;

  /** Delete a specific circuit breaker entry. */
  deleteCircuitBreaker(serviceId: string): Promise<void>;

  /** Delete all circuit breaker entries. */
  deleteAllCircuitBreakers(): Promise<void>;
}

// ── Default Circuit Breaker Record ────────────────────────────────────────

export function defaultCircuitBreakerRecord(): CircuitBreakerRecord {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    lastFailureAt: null,
    openedAt: null,
    halfOpenClaimedBy: null,
    halfOpenClaimedAt: null,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create the active StateStore. Uses DbStateStore when a DB connection is
 * available, wrapped with MemoryStateStore as a fallback for resilience.
 *
 * If DbStateStore fails on any operation, the fallback silently serves
 * from the in-memory store (same behavior as before this change).
 */
export function createStateStore(): StateStore {
  // Lazy import to avoid circular dependency at module load time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MemoryStateStore } = require("./memoryStateStore.js");
  let dbStore: StateStore | null = null;

  try {
    const { DbStateStore } = require("./dbStateStore.js");
    dbStore = new DbStateStore();
  } catch {
    // DB not available - use memory-only
  }

  const memStore = new MemoryStateStore();

  if (!dbStore) return memStore;

  // Return a fallback wrapper: try DB first, fall back to memory on error.
  return new FallbackStateStore(dbStore, memStore);
}

// ── Fallback Wrapper ──────────────────────────────────────────────────────

class FallbackStateStore implements StateStore {
  constructor(
    private primary: StateStore,
    private fallback: StateStore,
  ) {}

  private async tryPrimary<T>(fn: () => Promise<T>, fallbackFn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallbackFn();
    }
  }

  getRateLimitWindow(deploymentId: string, serviceId: string, windowType: "minute" | "day", windowStart: number) {
    return this.tryPrimary(
      () => this.primary.getRateLimitWindow(deploymentId, serviceId, windowType, windowStart),
      () => this.fallback.getRateLimitWindow(deploymentId, serviceId, windowType, windowStart),
    );
  }

  incrementRateLimitWindow(deploymentId: string, serviceId: string, windowType: "minute" | "day", windowStart: number) {
    return this.tryPrimary(
      () => this.primary.incrementRateLimitWindow(deploymentId, serviceId, windowType, windowStart),
      () => this.fallback.incrementRateLimitWindow(deploymentId, serviceId, windowType, windowStart),
    );
  }

  cleanupStaleWindows(olderThan: number) {
    return this.tryPrimary(
      () => this.primary.cleanupStaleWindows(olderThan),
      () => this.fallback.cleanupStaleWindows(olderThan),
    );
  }

  deleteRateLimit(deploymentId: string, serviceId: string) {
    return this.tryPrimary(
      () => this.primary.deleteRateLimit(deploymentId, serviceId),
      () => this.fallback.deleteRateLimit(deploymentId, serviceId),
    );
  }

  deleteAllRateLimits() {
    return this.tryPrimary(
      () => this.primary.deleteAllRateLimits(),
      () => this.fallback.deleteAllRateLimits(),
    );
  }

  getCircuitBreaker(serviceId: string) {
    return this.tryPrimary(
      () => this.primary.getCircuitBreaker(serviceId),
      () => this.fallback.getCircuitBreaker(serviceId),
    );
  }

  setCircuitBreaker(serviceId: string, record: CircuitBreakerRecord) {
    return this.tryPrimary(
      () => this.primary.setCircuitBreaker(serviceId, record),
      () => this.fallback.setCircuitBreaker(serviceId, record),
    );
  }

  claimHalfOpenProbe(serviceId: string, replicaId: string, now: number) {
    return this.tryPrimary(
      () => this.primary.claimHalfOpenProbe(serviceId, replicaId, now),
      () => this.fallback.claimHalfOpenProbe(serviceId, replicaId, now),
    );
  }

  deleteCircuitBreaker(serviceId: string) {
    return this.tryPrimary(
      () => this.primary.deleteCircuitBreaker(serviceId),
      () => this.fallback.deleteCircuitBreaker(serviceId),
    );
  }

  deleteAllCircuitBreakers() {
    return this.tryPrimary(
      () => this.primary.deleteAllCircuitBreakers(),
      () => this.fallback.deleteAllCircuitBreakers(),
    );
  }
}
