/**
 * Unit tests for the Service Health Check service.
 *
 * Tests the periodic health-check loop that pings remote/hybrid service
 * endpoints and updates DB health status accordingly.
 *
 * All external dependencies (db, tables, dbDate, logger, fetch) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      marketplaceServices: {
        findMany: (...args: any[]) => mockFindMany(...args),
      },
    },
    update: (...args: any[]) => {
      mockUpdate(...args);
      return { set: (...setArgs: any[]) => { mockSet(...setArgs); return { where: mockWhere }; } };
    },
  },
  tables: {
    marketplaceServices: {
      id: "id",
      status: "status",
      hostingModel: "hostingModel",
      remoteHealth: "remoteHealth",
      remoteLastCheck: "remoteLastCheck",
    },
  },
  dbDate: vi.fn(() => "2026-03-04T12:00:00.000Z"),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

import {
  startServiceHealthCheck,
  stopServiceHealthCheck,
} from "../serviceHealthCheck.js";
import {
  recordFailure,
  resetAllCircuits,
  FAILURE_THRESHOLD,
} from "../circuitBreaker.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Service Health Check Service", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    await resetAllCircuits();
    mockFindMany.mockResolvedValue([]);
    // Ensure we start clean (no leftover interval)
    stopServiceHealthCheck();
  });

  afterEach(() => {
    stopServiceHealthCheck();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ── startServiceHealthCheck / stopServiceHealthCheck ──────────────────────

  describe("startServiceHealthCheck", () => {
    it("runs checkAllServices immediately on start", async () => {
      startServiceHealthCheck(60_000);

      // Flush the immediate void call
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it("runs checkAllServices on each interval tick", async () => {
      startServiceHealthCheck(10_000);

      await vi.advanceTimersByTimeAsync(0); // immediate
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000); // first tick
      expect(mockFindMany).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10_000); // second tick
      expect(mockFindMany).toHaveBeenCalledTimes(3);
    });

    it("is idempotent (calling twice does not create duplicate intervals)", async () => {
      startServiceHealthCheck(10_000);
      startServiceHealthCheck(10_000); // second call is no-op

      await vi.advanceTimersByTimeAsync(0);
      // Only one immediate call, not two
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      // Only one interval tick, not two
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("stopServiceHealthCheck", () => {
    it("stops the interval so no more ticks fire", async () => {
      startServiceHealthCheck(10_000);

      await vi.advanceTimersByTimeAsync(0); // immediate
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      stopServiceHealthCheck();

      await vi.advanceTimersByTimeAsync(30_000); // well past next tick
      // No additional calls after stop
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it("is safe to call when not started", () => {
      // Should not throw
      expect(() => stopServiceHealthCheck()).not.toThrow();
    });

    it("allows restart after stop", async () => {
      startServiceHealthCheck(10_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      stopServiceHealthCheck();

      startServiceHealthCheck(10_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    });
  });

  // ── checkAllServices (tested via startServiceHealthCheck) ────────────────

  describe("checkAllServices", () => {
    it("queries only published remote/hybrid services", async () => {
      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
        }),
      );
    });

    it("does not crash when db query throws", async () => {
      mockFindMany.mockRejectedValueOnce(new Error("DB connection lost"));

      startServiceHealthCheck(60_000);
      // Should not throw, just log error
      await vi.advanceTimersByTimeAsync(0);

      // Verify the error was logged (via logger.error mock)
      const { logger } = await import("../../utils/logger.js");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("health check failed"),
      );
    });
  });

  // ── checkServiceHealth ─────────────────────────────────────────────────────

  describe("checkServiceHealth (via checkAllServices)", () => {
    it("returns 'healthy' when health endpoint returns 200", async () => {
      const pkg = {
        id: "pkg-001",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          healthEndpoint: "https://api.creator.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("OK", { status: 200 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteHealth: "healthy",
        }),
      );
    });

    it("returns 'degraded' when health endpoint returns non-200", async () => {
      const pkg = {
        id: "pkg-002",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          healthEndpoint: "https://api.creator.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("Service Unavailable", { status: 503 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteHealth: "degraded",
        }),
      );
    });

    it("returns 'offline' when health endpoint fetch throws", async () => {
      const pkg = {
        id: "pkg-003",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          healthEndpoint: "https://api.creator.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => {
        throw new Error("ECONNREFUSED");
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteHealth: "offline",
        }),
      );
    });

    it("returns 'offline' when health endpoint times out (AbortError)", async () => {
      const pkg = {
        id: "pkg-004",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          healthEndpoint: "https://api.creator.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteHealth: "offline",
        }),
      );
    });

    it("uses explicit healthEndpoint from remoteApiConfig when present", async () => {
      const pkg = {
        id: "pkg-005",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          healthEndpoint: "https://status.creator.test/ping",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      const fetchedUrls: string[] = [];
      mockFetch((url) => {
        fetchedUrls.push(url);
        return new Response("OK", { status: 200 });
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchedUrls).toContain("https://status.creator.test/ping");
    });

    it("falls back to {endpoint}/health when no explicit healthEndpoint", async () => {
      const pkg = {
        id: "pkg-006",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.creator.test/v1",
          // no healthEndpoint field
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      const fetchedUrls: string[] = [];
      mockFetch((url) => {
        fetchedUrls.push(url);
        return new Response("OK", { status: 200 });
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchedUrls).toContain("https://api.creator.test/v1/health");
    });

    it("falls back to remoteApiEndpoint/health when no remoteApiConfig", async () => {
      const pkg = {
        id: "pkg-007",
        remoteApiConfig: null,
        remoteApiEndpoint: "https://fallback.creator.test/api",
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      const fetchedUrls: string[] = [];
      mockFetch((url) => {
        fetchedUrls.push(url);
        return new Response("OK", { status: 200 });
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchedUrls).toContain("https://fallback.creator.test/api/health");
    });

    it("skips services with no endpoint at all", async () => {
      const pkg = {
        id: "pkg-008",
        remoteApiConfig: null,
        remoteApiEndpoint: null,
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("OK", { status: 200 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      // fetch should not have been called
      expect(globalThis.fetch).not.toHaveBeenCalled();
      // DB update should not have been called
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("skips services with invalid remoteApiConfig JSON", async () => {
      const pkg = {
        id: "pkg-009",
        remoteApiConfig: "not valid json {{{",
        remoteApiEndpoint: null,
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("OK", { status: 200 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      // fetch should not have been called since JSON parse fails and no fallback
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("checks multiple services sequentially", async () => {
      const pkg1 = {
        id: "pkg-multi-1",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api1.test/v1",
          healthEndpoint: "https://api1.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "s1", description: "S1", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      const pkg2 = {
        id: "pkg-multi-2",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api2.test/v1",
          healthEndpoint: "https://api2.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "s2", description: "S2", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg1, pkg2]);

      const fetchedUrls: string[] = [];
      mockFetch((url) => {
        fetchedUrls.push(url);
        return new Response("OK", { status: 200 });
      });

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchedUrls).toHaveLength(2);
      expect(fetchedUrls).toContain("https://api1.test/health");
      expect(fetchedUrls).toContain("https://api2.test/health");

      // Both services should have their health updated
      expect(mockSet).toHaveBeenCalledTimes(2);
    });

    it("logs a warning when service is not healthy", async () => {
      const pkg = {
        id: "pkg-warn",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.warn.test/v1",
          healthEndpoint: "https://api.warn.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("Error", { status: 500 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      const { logger } = await import("../../utils/logger.js");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "pkg-warn",
          health: "degraded",
        }),
        expect.stringContaining("not healthy"),
      );
    });

    it("skips network call and marks offline when circuit breaker is open", async () => {
      const pkg = {
        id: "pkg-circuit",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.circuit.test/v1",
          healthEndpoint: "https://api.circuit.test/health",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      // Trip the circuit breaker for this service
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure("pkg-circuit");
      }

      mockFetch(() => new Response("OK", { status: 200 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      // fetch should NOT have been called — circuit is open
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // DB should still be updated to "offline"
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteHealth: "offline",
        }),
      );
    });

    it("updates remoteLastCheck with current timestamp", async () => {
      const pkg = {
        id: "pkg-timestamp",
        remoteApiConfig: JSON.stringify({
          endpoint: "https://api.ts.test/v1",
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
          version: "1.0.0",
        }),
      };
      mockFindMany.mockResolvedValueOnce([pkg]);

      mockFetch(() => new Response("OK", { status: 200 }));

      startServiceHealthCheck(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteLastCheck: "2026-03-04T12:00:00.000Z",
        }),
      );
    });
  });
});
