/**
 * MemoryStateStore - In-memory implementation of the StateStore interface.
 *
 * Wraps the same Map-based logic that the rate limiter and circuit breaker
 * used before the StateStore abstraction. Used as fallback when DB is
 * unavailable, and in tests for speed.
 */

import type {
  StateStore,
  RateLimitWindow,
  CircuitBreakerRecord,
} from "./stateStore.js";
import { defaultCircuitBreakerRecord } from "./stateStore.js";

// ── Rate Limit Storage ────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// ── MemoryStateStore ──────────────────────────────────────────────────────

export class MemoryStateStore implements StateStore {
  /** Rate limit counters keyed by `${deploymentId}:${serviceId}:${windowType}`. */
  private rateLimits = new Map<string, RateLimitEntry>();

  /** Circuit breaker state keyed by serviceId. */
  private circuits = new Map<string, CircuitBreakerRecord>();

  // ── Rate Limiting ─────────────────────────────────────────────────────

  private rlKey(deploymentId: string, serviceId: string, windowType: string): string {
    return `${deploymentId}:${serviceId}:${windowType}`;
  }

  async getRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<RateLimitWindow | null> {
    const key = this.rlKey(deploymentId, serviceId, windowType);
    const entry = this.rateLimits.get(key);
    if (!entry || entry.windowStart !== windowStart) return null;
    return { count: entry.count, windowStart: entry.windowStart };
  }

  async incrementRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<number> {
    const key = this.rlKey(deploymentId, serviceId, windowType);
    const entry = this.rateLimits.get(key);

    if (!entry || entry.windowStart !== windowStart) {
      this.rateLimits.set(key, { count: 1, windowStart });
      return 1;
    }

    entry.count += 1;
    return entry.count;
  }

  async cleanupStaleWindows(olderThan: number): Promise<number> {
    let evicted = 0;
    for (const [key, entry] of this.rateLimits) {
      if (entry.windowStart < olderThan) {
        this.rateLimits.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  async deleteRateLimit(deploymentId: string, serviceId: string): Promise<void> {
    // Delete both minute and day windows
    this.rateLimits.delete(this.rlKey(deploymentId, serviceId, "minute"));
    this.rateLimits.delete(this.rlKey(deploymentId, serviceId, "day"));
  }

  async deleteAllRateLimits(): Promise<void> {
    this.rateLimits.clear();
  }

  // ── Circuit Breaker ───────────────────────────────────────────────────

  async getCircuitBreaker(serviceId: string): Promise<CircuitBreakerRecord> {
    return this.circuits.get(serviceId) ?? defaultCircuitBreakerRecord();
  }

  async setCircuitBreaker(serviceId: string, record: CircuitBreakerRecord): Promise<void> {
    this.circuits.set(serviceId, { ...record });
  }

  async claimHalfOpenProbe(serviceId: string, replicaId: string, now: number): Promise<boolean> {
    const record = this.circuits.get(serviceId);
    if (!record || record.state !== "HALF_OPEN") return false;

    // Already claimed by another replica and not timed out (30s)
    if (
      record.halfOpenClaimedBy &&
      record.halfOpenClaimedBy !== replicaId &&
      record.halfOpenClaimedAt !== null &&
      now - record.halfOpenClaimedAt < 30_000
    ) {
      return false;
    }

    record.halfOpenClaimedBy = replicaId;
    record.halfOpenClaimedAt = now;
    return true;
  }

  async deleteCircuitBreaker(serviceId: string): Promise<void> {
    this.circuits.delete(serviceId);
  }

  async deleteAllCircuitBreakers(): Promise<void> {
    this.circuits.clear();
  }
}
