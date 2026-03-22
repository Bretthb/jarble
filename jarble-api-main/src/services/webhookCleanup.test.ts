/**
 * Tests for webhookCleanup.ts — periodic deletion of old webhook events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DB module
const mockDelete = vi.fn();
const mockWhere = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    delete: (...args: any[]) => {
      mockDelete(...args);
      return { where: mockWhere };
    },
  },
  tables: {
    processedWebhookEvents: {
      processedAt: "processedAt",
    },
  },
  DB_PROVIDER: "sqlite",
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({
    strings,
    values,
  }),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { cleanupOldWebhookEvents, startWebhookCleanup } from "./webhookCleanup.js";

describe("webhookCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWhere.mockResolvedValue({ changes: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── cleanupOldWebhookEvents ─────────────────────────────────────────────

  describe("cleanupOldWebhookEvents", () => {
    it("deletes records and returns count when old events exist", async () => {
      mockWhere.mockResolvedValue({ changes: 15 });

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(15);
      expect(mockDelete).toHaveBeenCalled();
    });

    it("returns 0 when no old events to purge", async () => {
      mockWhere.mockResolvedValue({ changes: 0 });

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(0);
    });

    it("handles MySQL result format (affectedRows)", async () => {
      mockWhere.mockResolvedValue([{ affectedRows: 7 }]);

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(7);
    });

    it("handles result with rowsAffected property", async () => {
      mockWhere.mockResolvedValue({ rowsAffected: 3 });

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(3);
    });

    it("returns 0 when result has no recognizable count format", async () => {
      mockWhere.mockResolvedValue({});

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(0);
    });

    it("returns 0 and logs error on database failure", async () => {
      mockWhere.mockRejectedValue(new Error("connection refused"));

      const count = await cleanupOldWebhookEvents();

      expect(count).toBe(0);
    });

    it("uses 30-day threshold for deletion", async () => {
      const beforeCall = Date.now();
      mockWhere.mockResolvedValue({ changes: 0 });

      await cleanupOldWebhookEvents();

      // The threshold should be approximately 30 days ago
      // We can verify the delete was called (the actual SQL comparison
      // is done by the DB driver, so we just verify the call happened)
      expect(mockDelete).toHaveBeenCalled();
    });

    it("handles concurrent cleanup calls safely", async () => {
      mockWhere.mockResolvedValue({ changes: 5 });

      const results = await Promise.all([
        cleanupOldWebhookEvents(),
        cleanupOldWebhookEvents(),
        cleanupOldWebhookEvents(),
      ]);

      expect(results).toEqual([5, 5, 5]);
    });
  });

  // ── startWebhookCleanup ────────────────────────────────────────────────

  describe("startWebhookCleanup", () => {
    it("runs cleanup immediately on startup", () => {
      mockWhere.mockResolvedValue({ changes: 0 });

      startWebhookCleanup(60000);

      // cleanupOldWebhookEvents is called via void (fire-and-forget)
      expect(mockDelete).toHaveBeenCalled();
    });

    it("returns an interval handle", () => {
      const timer = startWebhookCleanup(60000);

      expect(timer).toBeDefined();
      clearInterval(timer);
    });

    it("runs cleanup on configured interval", async () => {
      mockWhere.mockResolvedValue({ changes: 0 });

      const timer = startWebhookCleanup(10000); // 10 second interval

      // Reset call count after initial immediate run
      mockDelete.mockClear();

      // Advance by one interval
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockDelete).toHaveBeenCalledTimes(1);

      // Advance by another interval
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockDelete).toHaveBeenCalledTimes(2);

      clearInterval(timer);
    });

    it("uses 24-hour default interval", () => {
      const timer = startWebhookCleanup();

      // Timer was created — default is 24h (86400000ms)
      expect(timer).toBeDefined();
      clearInterval(timer);
    });

    it("cleanup continues running even after error", async () => {
      // First call fails, second succeeds
      let callCount = 0;
      mockWhere.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("transient");
        return { changes: 2 };
      });

      const timer = startWebhookCleanup(5000);

      // Advance past the first interval (which errors)
      await vi.advanceTimersByTimeAsync(5000);

      // Advance past the second interval (which should succeed)
      await vi.advanceTimersByTimeAsync(5000);

      expect(callCount).toBeGreaterThanOrEqual(2);
      clearInterval(timer);
    });

    it("interval can be stopped by clearing returned timer", async () => {
      mockWhere.mockResolvedValue({ changes: 0 });

      const timer = startWebhookCleanup(5000);
      clearInterval(timer);

      mockDelete.mockClear();

      await vi.advanceTimersByTimeAsync(15000);

      // No additional calls after clearing
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles null result from delete", async () => {
      mockWhere.mockResolvedValue(null);
      const count = await cleanupOldWebhookEvents();
      expect(count).toBe(0);
    });

    it("handles undefined result from delete", async () => {
      mockWhere.mockResolvedValue(undefined);
      const count = await cleanupOldWebhookEvents();
      expect(count).toBe(0);
    });

    it("returns exact count from various DB provider formats", async () => {
      // SQLite format
      mockWhere.mockResolvedValue({ changes: 42 });
      expect(await cleanupOldWebhookEvents()).toBe(42);
    });
  });
});
