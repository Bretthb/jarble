import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStateStore } from "./memoryStateStore.js";
import { defaultCircuitBreakerRecord } from "./stateStore.js";

describe("MemoryStateStore", () => {
  let store: MemoryStateStore;

  beforeEach(() => {
    store = new MemoryStateStore();
  });

  // ── Rate Limiting ─────────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("returns null for non-existent window", async () => {
      const result = await store.getRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      expect(result).toBeNull();
    });

    it("increments and returns the count", async () => {
      const count = await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      expect(count).toBe(1);

      const count2 = await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      expect(count2).toBe(2);
    });

    it("returns correct window after increment", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);

      const window = await store.getRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      expect(window).toEqual({ count: 2, windowStart: 60000 });
    });

    it("returns null for wrong window start", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      const result = await store.getRateLimitWindow("dep-1", "svc-1", "minute", 120000);
      expect(result).toBeNull();
    });

    it("resets count when window changes", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);

      // New window
      const count = await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 120000);
      expect(count).toBe(1);
    });

    it("minute and day windows are independent", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      await store.incrementRateLimitWindow("dep-1", "svc-1", "day", 86400000);

      const minuteWindow = await store.getRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      const dayWindow = await store.getRateLimitWindow("dep-1", "svc-1", "day", 86400000);

      expect(minuteWindow?.count).toBe(1);
      expect(dayWindow?.count).toBe(1);
    });

    it("deleteRateLimit removes both window types", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      await store.incrementRateLimitWindow("dep-1", "svc-1", "day", 86400000);

      await store.deleteRateLimit("dep-1", "svc-1");

      expect(await store.getRateLimitWindow("dep-1", "svc-1", "minute", 60000)).toBeNull();
      expect(await store.getRateLimitWindow("dep-1", "svc-1", "day", 86400000)).toBeNull();
    });

    it("deleteAllRateLimits clears everything", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 60000);
      await store.incrementRateLimitWindow("dep-2", "svc-2", "minute", 60000);

      await store.deleteAllRateLimits();

      expect(await store.getRateLimitWindow("dep-1", "svc-1", "minute", 60000)).toBeNull();
      expect(await store.getRateLimitWindow("dep-2", "svc-2", "minute", 60000)).toBeNull();
    });

    it("cleanupStaleWindows evicts old entries", async () => {
      await store.incrementRateLimitWindow("dep-1", "svc-1", "minute", 1000); // old
      await store.incrementRateLimitWindow("dep-2", "svc-2", "minute", 999999); // newer, different key

      const evicted = await store.cleanupStaleWindows(5000);
      expect(evicted).toBe(1);

      // The old one should be gone
      expect(await store.getRateLimitWindow("dep-1", "svc-1", "minute", 1000)).toBeNull();
      // The newer one should still exist
      expect(await store.getRateLimitWindow("dep-2", "svc-2", "minute", 999999)).not.toBeNull();
    });
  });

  // ── Circuit Breaker ───────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it("returns default CLOSED record for unknown service", async () => {
      const record = await store.getCircuitBreaker("unknown");
      expect(record).toEqual(defaultCircuitBreakerRecord());
    });

    it("persists circuit breaker state", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      const record = await store.getCircuitBreaker("svc-1");
      expect(record.state).toBe("OPEN");
      expect(record.consecutiveFailures).toBe(5);
      expect(record.lastFailureAt).toBe(1000);
      expect(record.openedAt).toBe(1000);
    });

    it("updates existing circuit breaker state", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      await store.setCircuitBreaker("svc-1", {
        state: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      const record = await store.getCircuitBreaker("svc-1");
      expect(record.state).toBe("HALF_OPEN");
    });

    it("deleteCircuitBreaker restores to default", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      await store.deleteCircuitBreaker("svc-1");
      const record = await store.getCircuitBreaker("svc-1");
      expect(record.state).toBe("CLOSED");
      expect(record.consecutiveFailures).toBe(0);
    });

    it("deleteAllCircuitBreakers clears everything", async () => {
      await store.setCircuitBreaker("svc-1", { state: "OPEN", consecutiveFailures: 5, lastFailureAt: 1000, openedAt: 1000, halfOpenClaimedBy: null, halfOpenClaimedAt: null });
      await store.setCircuitBreaker("svc-2", { state: "OPEN", consecutiveFailures: 3, lastFailureAt: 2000, openedAt: 2000, halfOpenClaimedBy: null, halfOpenClaimedAt: null });

      await store.deleteAllCircuitBreakers();

      expect((await store.getCircuitBreaker("svc-1")).state).toBe("CLOSED");
      expect((await store.getCircuitBreaker("svc-2")).state).toBe("CLOSED");
    });
  });

  // ── HALF_OPEN Probe Claim ──────────────────────────────────────────────

  describe("claimHalfOpenProbe", () => {
    it("returns false when circuit is not HALF_OPEN", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      const claimed = await store.claimHalfOpenProbe("svc-1", "replica-1", 2000);
      expect(claimed).toBe(false);
    });

    it("allows first replica to claim", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      const claimed = await store.claimHalfOpenProbe("svc-1", "replica-1", 2000);
      expect(claimed).toBe(true);
    });

    it("denies second replica while claim is active", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      await store.claimHalfOpenProbe("svc-1", "replica-1", 2000);

      const claimed = await store.claimHalfOpenProbe("svc-1", "replica-2", 2100);
      expect(claimed).toBe(false);
    });

    it("allows same replica to re-claim", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      await store.claimHalfOpenProbe("svc-1", "replica-1", 2000);
      const claimed = await store.claimHalfOpenProbe("svc-1", "replica-1", 2100);
      expect(claimed).toBe(true);
    });

    it("allows new claim after 30s timeout (crashed replica)", async () => {
      await store.setCircuitBreaker("svc-1", {
        state: "HALF_OPEN",
        consecutiveFailures: 5,
        lastFailureAt: 1000,
        openedAt: 1000,
        halfOpenClaimedBy: null,
        halfOpenClaimedAt: null,
      });

      await store.claimHalfOpenProbe("svc-1", "replica-1", 2000);

      // 30 seconds later, replica-1 is assumed crashed
      const claimed = await store.claimHalfOpenProbe("svc-1", "replica-2", 2000 + 30_001);
      expect(claimed).toBe(true);
    });
  });
});
