import { describe, it, expect, beforeEach } from "vitest";
import {
  checkServiceRateLimit,
  getRateLimitStatus,
  resetServiceRateLimit,
  resetAllServiceRateLimits,
} from "./serviceRateLimit.js";

describe("serviceRateLimit", () => {
  beforeEach(() => {
    resetAllServiceRateLimits();
  });

  // ── No rate limits ───────────────────────────────────────────────────────

  describe("no rate limits configured", () => {
    it("always allows when rateLimits is undefined", () => {
      const result = checkServiceRateLimit("dep-1", "pkg-1", undefined);
      expect(result.allowed).toBe(true);
    });

    it("always allows when both limits are undefined", () => {
      const result = checkServiceRateLimit("dep-1", "pkg-1", {});
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-minute limit ─────────────────────────────────────────────────────

  describe("per-minute rate limiting", () => {
    const limits = { requestsPerMinute: 3 };

    it("allows requests under the limit", () => {
      const now = 1000 * 60 * 10; // aligned to a minute boundary
      for (let i = 0; i < 3; i++) {
        const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks the request that exceeds the limit", () => {
      const now = 1000 * 60 * 10;
      // Use up all 3 allowed requests
      for (let i = 0; i < 3; i++) {
        checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      }

      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("minute");
        expect(result.limit).toBe(3);
        expect(result.current).toBe(3);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
      }
    });

    it("resets counter in a new minute window", () => {
      const minuteMs = 60 * 1000;
      const window1 = minuteMs * 10;
      const window2 = minuteMs * 11;

      // Fill up window 1
      for (let i = 0; i < 3; i++) {
        checkServiceRateLimit("dep-1", "pkg-1", limits, window1);
      }
      expect(checkServiceRateLimit("dep-1", "pkg-1", limits, window1).allowed).toBe(false);

      // New window — allowed again
      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, window2);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-day limit ────────────────────────────────────────────────────────

  describe("per-day rate limiting", () => {
    const limits = { requestsPerDay: 5 };

    it("allows requests under the daily limit", () => {
      const now = 1000 * 60 * 60 * 24 * 10; // aligned to a day boundary
      for (let i = 0; i < 5; i++) {
        const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks after daily limit exceeded", () => {
      const now = 1000 * 60 * 60 * 24 * 10;
      for (let i = 0; i < 5; i++) {
        checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      }

      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
        expect(result.limit).toBe(5);
      }
    });

    it("resets counter in a new day window", () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const day1 = dayMs * 10;
      const day2 = dayMs * 11;

      for (let i = 0; i < 5; i++) {
        checkServiceRateLimit("dep-1", "pkg-1", limits, day1);
      }
      expect(checkServiceRateLimit("dep-1", "pkg-1", limits, day1).allowed).toBe(false);

      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, day2);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Both limits ──────────────────────────────────────────────────────────

  describe("both per-minute and per-day limits", () => {
    const limits = { requestsPerMinute: 2, requestsPerDay: 5 };

    it("per-minute limit takes priority when hit first", () => {
      const now = 1000 * 60 * 10;
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);

      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("minute");
      }
    });

    it("per-day limit blocks after minute windows reset", () => {
      const minuteMs = 60 * 1000;
      // Window 1: 2 requests
      const w1 = minuteMs * 10;
      checkServiceRateLimit("dep-1", "pkg-1", limits, w1);
      checkServiceRateLimit("dep-1", "pkg-1", limits, w1);

      // Window 2: 2 requests
      const w2 = minuteMs * 11;
      checkServiceRateLimit("dep-1", "pkg-1", limits, w2);
      checkServiceRateLimit("dep-1", "pkg-1", limits, w2);

      // Window 3: 1 request (total = 5, hits day limit)
      const w3 = minuteMs * 12;
      checkServiceRateLimit("dep-1", "pkg-1", limits, w3);

      // 6th request — day limit reached
      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, w3);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe("day");
      }
    });
  });

  // ── Per-deployment+service isolation ──────────────────────────────────────

  describe("isolation", () => {
    const limits = { requestsPerMinute: 2 };

    it("different deployments have separate counters", () => {
      const now = 1000 * 60 * 10;
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      expect(checkServiceRateLimit("dep-1", "pkg-1", limits, now).allowed).toBe(false);

      // Different deployment, same service — should be allowed
      expect(checkServiceRateLimit("dep-2", "pkg-1", limits, now).allowed).toBe(true);
    });

    it("different services have separate counters", () => {
      const now = 1000 * 60 * 10;
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      expect(checkServiceRateLimit("dep-1", "pkg-1", limits, now).allowed).toBe(false);

      // Same deployment, different service — should be allowed
      expect(checkServiceRateLimit("dep-1", "pkg-2", limits, now).allowed).toBe(true);
    });
  });

  // ── Counter does not increment on deny ───────────────────────────────────

  describe("deny does not increment counter", () => {
    it("blocked requests are not counted", () => {
      const limits = { requestsPerMinute: 2 };
      const now = 1000 * 60 * 10;

      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);

      // This should be blocked (at 2/2)
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      checkServiceRateLimit("dep-1", "pkg-1", limits, now);

      // Counter should still be 2, not 5
      const status = getRateLimitStatus("dep-1", "pkg-1");
      expect(status).not.toBeNull();
      expect(status!.minuteCount).toBe(2);
    });
  });

  // ── getRateLimitStatus ───────────────────────────────────────────────────

  describe("getRateLimitStatus", () => {
    it("returns null for unknown deployment+service", () => {
      expect(getRateLimitStatus("unknown", "unknown")).toBeNull();
    });

    it("returns current counts", () => {
      const now = 1000 * 60 * 10;
      checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10, requestsPerDay: 100 }, now);
      checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10, requestsPerDay: 100 }, now);

      const status = getRateLimitStatus("dep-1", "pkg-1");
      expect(status).toEqual({ minuteCount: 2, dayCount: 2 });
    });
  });

  // ── resetServiceRateLimit ────────────────────────────────────────────────

  describe("resetServiceRateLimit", () => {
    it("clears a specific deployment+service counter", () => {
      const now = 1000 * 60 * 10;
      checkServiceRateLimit("dep-1", "pkg-1", { requestsPerMinute: 10 }, now);

      resetServiceRateLimit("dep-1", "pkg-1");
      expect(getRateLimitStatus("dep-1", "pkg-1")).toBeNull();
    });
  });

  // ── Retry-After header value ─────────────────────────────────────────────

  describe("retryAfterSeconds", () => {
    it("is at least 1 second", () => {
      const limits = { requestsPerMinute: 1 };
      const minuteMs = 60 * 1000;
      const now = minuteMs * 10 + minuteMs - 100; // 100ms before window end

      checkServiceRateLimit("dep-1", "pkg-1", limits, now);
      const result = checkServiceRateLimit("dep-1", "pkg-1", limits, now);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
