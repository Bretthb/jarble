/**
 * SSE Edge Case Tests
 *
 * Tests SSE streaming endpoints for resilience edge cases:
 * - Client reconnection mid-stream
 * - Slow DB responses
 * - Connection limit enforcement (exact boundary)
 * - Cleanup after various disconnect scenarios
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  const query = {
    deployments: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    platformCredentials: {
      findFirst: vi.fn(),
    },
  };
  return {
    db: {
      query,
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    },
    tables: {
      deployments: { id: "id", userId: "userId", status: "status" },
      platformCredentials: { deploymentId: "deploymentId", platformId: "platformId" },
    },
  };
});

vi.mock("../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

vi.mock("../utils/encryption.js", () => ({
  encryptApiKey: vi.fn(() => "encrypted"),
}));

vi.mock("../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn(),
}));

vi.mock("../k8s/index.js", () => ({
  streamDeploymentLogs: vi.fn(),
  getDeploymentPodStatus: vi.fn(),
  findPodForDeployment: vi.fn(),
  streamExecInPod: vi.fn(),
}));

vi.mock("../services/statusCache.js", () => ({
  subscribe: vi.fn(),
  unsubscribeAll: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  inArray: vi.fn((...args: any[]) => args),
  desc: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-1234"),
}));

vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock("../utils/safeAsync.js", () => ({
  safeFireAndForget: vi.fn(),
}));

import { verifyToken, getUserFromToken } from "../services/auth.js";
import { db } from "../db/index.js";
import {
  streamDeploymentLogs,
  findPodForDeployment,
  streamExecInPod,
} from "../k8s/index.js";
import {
  subscribe as statusCacheSubscribe,
  unsubscribeAll as statusCacheUnsubscribeAll,
} from "../services/statusCache.js";

const mockVerifyToken = vi.mocked(verifyToken);
const mockGetUserFromToken = vi.mocked(getUserFromToken);
const mockDb = vi.mocked(db);
const mockStreamLogs = vi.mocked(streamDeploymentLogs);
const mockFindPod = vi.mocked(findPodForDeployment);
const mockStreamExec = vi.mocked(streamExecInPod);
const mockStatusSubscribe = vi.mocked(statusCacheSubscribe);
const mockStatusUnsubscribeAll = vi.mocked(statusCacheUnsubscribeAll);

// ── Test helpers ─────────────────────────────────────────────────────────

function createMockRes() {
  const res: any = new EventEmitter();
  res.status = vi.fn().mockReturnThis();
  res.json = vi.fn().mockReturnThis();
  res.writeHead = vi.fn();
  res.flushHeaders = vi.fn();
  res.write = vi.fn().mockReturnValue(true);
  res.end = vi.fn();
  res.headersSent = false;
  res.writableEnded = false;
  res.end.mockImplementation(() => { res.writableEnded = true; });
  return res;
}

function createMockReq(params: any = {}, query: any = {}, headers: any = {}) {
  const req: any = new EventEmitter();
  req.params = params;
  req.query = query;
  req.headers = headers;
  return req;
}

const mockUser = { id: "user-edge-1", email: "edge@example.com" };
const mockUser2 = { id: "user-edge-2", email: "edge2@example.com" };

let sseRouter: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("./sse.js");
  sseRouter = mod.sseRouter;
});

function getRouteHandler(method: string, path: string): Function | undefined {
  const stack = sseRouter.stack;
  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route;
      if (route.path === path && route.methods[method]) {
        return route.stack[0].handle;
      }
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// Client reconnection mid-stream
// ═══════════════════════════════════════════════════════════════════════
describe("client reconnection mid-stream", () => {
  it("cleans up first connection resources when client disconnects, then allows reconnect", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);

    const abortFn1 = vi.fn();
    const abortFn2 = vi.fn();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-edge-1", status: "running",
    } as any);

    mockStreamLogs
      .mockResolvedValueOnce({ podName: "pod-1", abort: abortFn1 })
      .mockResolvedValueOnce({ podName: "pod-1", abort: abortFn2 });

    // First connection
    const req1 = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res1 = createMockRes();
    await handler(req1, res1);
    expect(res1.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));

    // Client disconnects mid-stream
    req1.emit("close");
    expect(abortFn1).toHaveBeenCalled();

    // Client reconnects — should succeed because connection was released
    const req2 = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res2 = createMockRes();
    await handler(req2, res2);
    expect(res2.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));

    // Cleanup
    req2.emit("close");
  });

  it("handles rapid connect/disconnect cycles without leaking connections", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-edge-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    // Rapidly connect and disconnect 20 times
    for (let i = 0; i < 20; i++) {
      const req = createMockReq({ id: `dep-${i % 3}` }, {}, { authorization: "Bearer t" });
      const res = createMockRes();
      await handler(req, res);
      req.emit("close");
    }

    // Should still be able to connect (all were released)
    const req = createMockReq({ id: "dep-final" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.writeHead).toHaveBeenCalled();
    req.emit("close");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Slow DB responses
// ═══════════════════════════════════════════════════════════════════════
describe("slow DB responses", () => {
  it("still responds correctly when DB query is slow", async () => {
    const handler = getRouteHandler("get", "/status/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);

    // Simulate a slow DB query (200ms)
    mockDb.query.deployments.findMany.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve([
          { id: "dep-slow", status: "running" },
        ] as any), 200);
      });
    });
    mockStatusSubscribe.mockResolvedValue({
      deploymentId: "dep-slow",
      status: "running",
    });

    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));

    // Should still send snapshot
    const snapshotWrite = res.write.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("event: snapshot")
    );
    expect(snapshotWrite).toBeTruthy();

    req.emit("close");
  });

  it("sends error event when DB throws during status stream init", async () => {
    const handler = getRouteHandler("get", "/status/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findMany.mockRejectedValue(new Error("Connection timed out"));

    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);

    const errorWrite = res.write.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("event: error")
    );
    expect(errorWrite).toBeTruthy();
    expect(res.end).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Connection limit boundary testing
// ═══════════════════════════════════════════════════════════════════════
describe("connection limit boundary (exact 10th connection)", () => {
  it("allows exactly 10 connections and rejects the 11th", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-edge-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    const connections: any[] = [];

    // Open exactly 10 connections
    for (let i = 0; i < 10; i++) {
      const req = createMockReq({ id: `dep-${i}` }, {}, { authorization: "Bearer t" });
      const res = createMockRes();
      connections.push({ req, res });
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalled();
    }

    // 11th should be rejected
    const req11 = createMockReq({ id: "dep-11" }, {}, { authorization: "Bearer t" });
    const res11 = createMockRes();
    await handler(req11, res11);
    expect(res11.status).toHaveBeenCalledWith(429);

    // Close one connection
    connections[0].req.emit("close");

    // Now the 11th should succeed
    const req11retry = createMockReq({ id: "dep-11-retry" }, {}, { authorization: "Bearer t" });
    const res11retry = createMockRes();
    await handler(req11retry, res11retry);
    expect(res11retry.writeHead).toHaveBeenCalled();

    // Cleanup remaining
    for (let i = 1; i < connections.length; i++) {
      connections[i].req.emit("close");
    }
    req11retry.emit("close");
  });

  it("connection limits are per-user, not global", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-edge-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    const user1Connections: any[] = [];

    // User 1: open 10 connections
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    for (let i = 0; i < 10; i++) {
      const req = createMockReq({ id: `dep-${i}` }, {}, { authorization: "Bearer t" });
      const res = createMockRes();
      user1Connections.push({ req, res });
      await handler(req, res);
    }

    // User 2: should still be able to connect (different user)
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-2" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser2 as any);
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-u2", userId: "user-edge-2", status: "running",
    } as any);

    const req2 = createMockReq({ id: "dep-u2" }, {}, { authorization: "Bearer t" });
    const res2 = createMockRes();
    await handler(req2, res2);
    expect(res2.writeHead).toHaveBeenCalled();

    // Cleanup
    for (const conn of user1Connections) conn.req.emit("close");
    req2.emit("close");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Response error handling
// ═══════════════════════════════════════════════════════════════════════
describe("response error during stream", () => {
  it("handles res.write returning false (backpressure)", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-edge-1", status: "running",
    } as any);

    const abortFn = vi.fn();
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: abortFn });

    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    // Simulate backpressure
    res.write.mockReturnValue(false);

    await handler(req, res);

    // Should still set up the stream correctly
    expect(res.writeHead).toHaveBeenCalled();

    // Simulate error on response
    res.emit("error", new Error("Write stream error"));
    expect(abortFn).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Status stream: empty deployments
// ═══════════════════════════════════════════════════════════════════════
describe("status stream edge cases", () => {
  it("handles user with zero deployments", async () => {
    const handler = getRouteHandler("get", "/status/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findMany.mockResolvedValue([]);

    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);

    // Should send snapshot with empty array
    const snapshotWrite = res.write.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("event: snapshot")
    );
    expect(snapshotWrite).toBeTruthy();
    expect(snapshotWrite![0]).toContain("[]");

    // Should NOT have called subscribe
    expect(mockStatusSubscribe).not.toHaveBeenCalled();

    req.emit("close");
  });

  it("handles mixed deployment statuses in snapshot", async () => {
    const handler = getRouteHandler("get", "/status/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-edge-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-stopped", status: "stopped" },
      { id: "dep-running", status: "running" },
      { id: "dep-creating", status: "creating" },
      { id: "dep-failed", status: "failed" },
    ] as any);
    mockStatusSubscribe.mockResolvedValue({
      deploymentId: "dep-running",
      status: "running",
    });

    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);

    // Should subscribe to running, creating, and failed (not stopped)
    expect(mockStatusSubscribe).toHaveBeenCalledTimes(3);

    req.emit("close");
  });
});
