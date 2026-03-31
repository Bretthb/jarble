import { describe, it, expect, beforeEach } from "vitest";
import {
  checkServiceRateLimit,
  getRateLimitStatus,
  resetServiceRateLimit,
  resetAllServiceRateLimits,
} from "./serviceRateLimit.js";
import { MemoryStateStore } from "../services/memoryStateStore.js";

describe("serviceRateLimit", () => {
  let store: MemoryStateStore;

  beforeEach(async () => {
    store = new MemoryStateStore();
    await resetAllServiceRateLimits(store);
  });

  // ── No rate limits ───────────────────────────────────────────────────────

  describe("no rate limits configured", () => {
    it("always allows when rateLimits is undefined", async () => {
      const result = await checkServiceRateLimit("dep-1", "pkg-1", undefined, undefined, store);
      expect(result.allowed).toBe(true);
    });

    it("always allows when both limits are undefined", async () => {
      const result = await checkServiceRateLimit("dep-1", "pkg-1", {}, undefined, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-minute limit ─────────────────────────────────────────────────────

  describe("per-minute rate limiting", () => {
    const limits = { requestsPerMinute: 3 };

    it("allows requests under the limit", async () => {
      const now = 1000 * 60 * 10; // aligned to a minute boundary
      for (let i = 0; i < 3; i++) {
        const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks the request that exceeds the limit", async () => {
      const now = 1000 * 60 * 10;
      // Use up all 3 allowed requests
      for (let i = 0; i < 3; i++) {
        await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      }

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("minute");
        expect(result.limit).toBe(3);
        expect(result.current).toBe(3);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
      }
    });

    it("resets counter in a new minute window", async () => {
      const minuteMs = 60 * 1000;
      const window1 = minuteMs * 10;
      const window2 = minuteMs * 11;

      // Fill up window 1
      for (let i = 0; i < 3; i++) {
        await checkServiceRateLimit("dep-1", "pkg-1", limits, window1, store);
      }
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, window1, store)).allowed).toBe(false);

      // New window - allowed again
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, window2, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-day limit ────────────────────────────────────────────────────────

  describe("per-day rate limiting", () => {
    const limits = { requestsPerDay: 5 };

    it("allows requests under the daily limit", async () => {
      const now = 1000 * 60 * 60 * 24 * 10; // aligned to a day boundary
      for (let i = 0; i < 5; i++) {
        const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks after daily limit exceeded", async () => {
      const now = 1000 * 60 * 60 * 24 * 10;
      for (let i = 0; i < 5; i++) {
        await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      }

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
        expect(result.limit).toBe(5);
      }
    });

    it("resets counter in a new day window", async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const day1 = dayMs * 10;
      const day2 = dayMs * 11;

      for (let i = 0; i < 5; i++) {
        await checkServiceRateLimit("dep-1", "pkg-1", limits, day1, store);
      }
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, day1, store)).allowed).toBe(false);

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, day2, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Both limits ──────────────────────────────────────────────────────────

  describe("both per-minute and per-day limits", () => {
    const limits = { requestsPerMinute: 2, requestsPerDay: 5 };

    it("per-minute limit takes priority when hit first", async () => {
      const now = 1000 * 60 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("minute");
      }
    });

    it("per-day limit blocks after minute windows reset", async () => {
      const minuteMs = 60 * 1000;
      // Window 1: 2 requests
      const w1 = minuteMs * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store);

      // Window 2: 2 requests
      const w2 = minuteMs * 11;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w2, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w2, store);

      // Window 3: 1 request (total = 5, hits day limit)
      const w3 = minuteMs * 12;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w3, store);

      // 6th request - day limit reached
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, w3, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
      }
    });
  });

  // ── Per-deployment+service isolation ──────────────────────────────────────

  describe("isolation", () => {
    const limits = { requestsPerMinute: 2 };

    it("different deployments have separate counters", async () => {
      const now = 1000 * 60 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store)).allowed).toBe(false);

      // Different deployment, same service - should be allowed
      expect((await checkServiceRateLimit("dep-2", "pkg-1", limits, now, store)).allowed).toBe(true);
    });

    it("different services have separate counters", async () => {
      const now = 1000 * 60 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store)).allowed).toBe(false);

      // Same deployment, different service - should be allowed
      expect((await checkServiceRateLimit("dep-1", "pkg-2", limits, now, store)).allowed).toBe(true);
    });
  });

  // ── Counter does not increment on deny ───────────────────────────────────

  describe("deny does not increment counter", () => {
    it("blocked requests are not counted", async () => {
      const limits = { requestsPerMinute: 2 };
      const now = 1000 * 60 * 10;

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      // These should be blocked (at 2/2)
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      // Counter should still be 2, not 5
      const status = await getRateLimitStatus("dep-1", "pkg-1", now, store);
      expect(status).not.toBeNull();
      expect(status!.minuteCount).toBe(2);
    });
  });

  // ── getRateLimitStatus ───────────────────────────────────────────────────

  describe("getRateLimitStatus", () => {
    it("returns null for unknown deployment+service", async () => {
      const now = 1000 * 60 * 10;
      expect(await getRateLimitStatus("unknown", "unknown", now, store)).toBeNull();
    });

    it("returns current counts", async () => {
      const now = 1000 * 60 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10, requestsPerDay: 100 }, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10, requestsPerDay: 100 }, now, store);

      const status = await getRateLimitStatus("dep-1", "pkg-1", now, store);
      expect(status).toEqual({ minuteCount: 2, dayCount: 2 });
    });
  });

  // ── resetServiceRateLimit ────────────────────────────────────────────────

  describe("resetServiceRateLimit", () => {
    it("clears a specific deployment+service counter", async () => {
      const now = 1000 * 60 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10 }, now, store);

      await resetServiceRateLimit("dep-1", "pkg-1", store);
      expect(await getRateLimitStatus("dep-1", "pkg-1", now, store)).toBeNull();
    });
  });

  // ── Retry-After header value ─────────────────────────────────────────────

  describe("retryAfterSeconds", () => {
    it("is at least 1 second", async () => {
      const limits = { requestsPerMinute: 1 };
      const minuteMs = 60 * 1000;
      const now = minuteMs * 10 + minuteMs - 100; // 100ms before window end

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
    });

    it("day retryAfterSeconds is correct", async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const limits = { requestsPerDay: 1 };
      // 1 hour into the day
      const now = dayMs * 10 + 3600 * 1000;

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        // Should be approximately 23 hours
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(24 * 3600);
      }
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles limit of 0 (always blocked)", async () => {
      const limits = { requestsPerMinute: 0 };
      const now = 60 * 1000 * 10;

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("minute");
        expect(result.current).toBe(0);
        expect(result.limit).toBe(0);
      }
    });

    it("handles very large limits", async () => {
      const limits = { requestsPerMinute: 1000000 };
      const now = 60 * 1000 * 10;

      for (let i = 0; i < 100; i++) {
        const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
        expect(result.allowed).toBe(true);
      }
    });

    it("handles only requestsPerMinute set (requestsPerDay undefined)", async () => {
      const limits = { requestsPerMinute: 2 };
      const now = 60 * 1000 * 10;

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect(result.allowed).toBe(false);
    });

    it("handles only requestsPerDay set (requestsPerMinute undefined)", async () => {
      const limits = { requestsPerDay: 2 };
      const dayMs = 24 * 60 * 60 * 1000;
      const now = dayMs * 10;

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);

      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
      }
    });

    it("minute window boundary exact alignment", async () => {
      const minuteMs = 60 * 1000;
      const limits = { requestsPerMinute: 1 };

      // Request at exact window boundary
      const windowStart = minuteMs * 100;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, windowStart, store);

      // Request at next window boundary exactly
      const nextWindow = minuteMs * 101;
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, nextWindow, store);
      expect(result.allowed).toBe(true);
    });

    it("day window boundary exact alignment", async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const limits = { requestsPerDay: 1 };

      const dayStart = dayMs * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, dayStart, store);

      // Next day boundary
      const nextDay = dayMs * 11;
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, nextDay, store);
      expect(result.allowed).toBe(true);
    });

    it("same callback for minute and day gets same count", async () => {
      const limits = { requestsPerMinute: 5, requestsPerDay: 10 };
      const now = 60 * 1000 * 100;

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store);
      }

      const status = await getRateLimitStatus("dep-1", "pkg-1", now, store);
      expect(status).not.toBeNull();
      expect(status!.minuteCount).toBe(3);
      expect(status!.dayCount).toBe(3);
    });
  });

  // ── resetAllServiceRateLimits ──────────────────────────────────────────

  describe("resetAllServiceRateLimits", () => {
    it("clears all rate limit state across all deployments and services", async () => {
      const now = 60 * 1000 * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10 }, now, store);
      await checkServiceRateLimit("dep-2", "pkg-1", { requestsPerMinute: 10 }, now, store);
      await checkServiceRateLimit("dep-1", "pkg-2", { requestsPerMinute: 10 }, now, store);

      await resetAllServiceRateLimits(store);

      expect(await getRateLimitStatus("dep-1", "pkg-1", now, store)).toBeNull();
      expect(await getRateLimitStatus("dep-2", "pkg-1", now, store)).toBeNull();
      expect(await getRateLimitStatus("dep-1", "pkg-2", now, store)).toBeNull();
    });
  });

  // ── Multiple request patterns ─────────────────────────────────────────

  describe("complex request patterns", () => {
    it("minute resets allow more requests within same day", async () => {
      const minuteMs = 60 * 1000;
      const limits = { requestsPerMinute: 2, requestsPerDay: 100 };

      // Window 1
      const w1 = minuteMs * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store);
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store);
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store)).allowed).toBe(false);

      // Window 2 - minute resets, day does not
      const w2 = minuteMs * 11;
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, w2, store)).allowed).toBe(true);
    });

    it("day limit accumulates across minute windows", async () => {
      const minuteMs = 60 * 1000;
      const limits = { requestsPerMinute: 10, requestsPerDay: 3 };

      const w1 = minuteMs * 10;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w1, store);

      const w2 = minuteMs * 11;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w2, store);

      const w3 = minuteMs * 12;
      await checkServiceRateLimit("dep-1", "pkg-1", limits, w3, store);

      // Day limit of 3 reached
      const w4 = minuteMs * 13;
      const result = await checkServiceRateLimit("dep-1", "pkg-1", limits, w4, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
      }
    });
  });

  // ── StateStore fallback ─────────────────────────────────────────────────

  describe("StateStore abstraction", () => {
    it("works with explicitly provided MemoryStateStore", async () => {
      const customStore = new MemoryStateStore();
      const limits = { requestsPerMinute: 1 };
      const now = 60 * 1000 * 10;

      const r1 = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, customStore);
      expect(r1.allowed).toBe(true);

      const r2 = await checkServiceRateLimit("dep-1", "pkg-1", limits, now, customStore);
      expect(r2.allowed).toBe(false);
    });

    it("different stores have independent state", async () => {
      const store1 = new MemoryStateStore();
      const store2 = new MemoryStateStore();
      const limits = { requestsPerMinute: 1 };
      const now = 60 * 1000 * 10;

      await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store1);
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store1)).allowed).toBe(false);

      // store2 should be independent
      expect((await checkServiceRateLimit("dep-1", "pkg-1", limits, now, store2)).allowed).toBe(true);
    });
  });
});
