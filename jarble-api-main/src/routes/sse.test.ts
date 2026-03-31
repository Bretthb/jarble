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
const mockDb = vi.mocked(db) as any;
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
  // Mock end to set writableEnded
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

const mockUser = { id: "user-1", email: "test@example.com" };

// Import the router - must be after mocks
let sseRouter: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-import router fresh
  const mod = await import("./sse.js");
  sseRouter = mod.sseRouter;
});

// Helper to get the route handler
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
// Authentication
// ═══════════════════════════════════════════════════════════════════════
describe("SSE authentication", () => {
  it("returns 401 when no auth token provided (log stream)", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream");
    expect(handler).toBeDefined();

    const req = createMockReq({ id: "dep-1" }, {}, {});
    const res = createMockRes();

    mockVerifyToken.mockRejectedValue(new Error("No token"));

    await handler!(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("authenticates via Bearer header", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream");
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer valid-token" });
    const res = createMockRes();

    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue(null as any);

    await handler!(req, res);

    expect(mockVerifyToken).toHaveBeenCalledWith("valid-token");
  });

  it("authenticates via query token", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream");
    const req = createMockReq({ id: "dep-1" }, { token: "query-token" }, {});
    const res = createMockRes();

    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue(null as any);

    await handler!(req, res);

    expect(mockVerifyToken).toHaveBeenCalledWith("query-token");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Log Stream
// ═══════════════════════════════════════════════════════════════════════
describe("log stream (/:id/logs/stream)", () => {
  let handler: Function;

  beforeEach(() => {
    handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
  });

  it("returns 404 when deployment not found", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue(null as any);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when deployment is not running", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "stopped",
    } as any);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("sets SSE headers on success", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    await handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
    }));
  });

  it("sends initial connected comment", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    await handler(req, res);

    expect(res.write).toHaveBeenCalledWith(": connected\n\n");
  });

  it("caps tailLines at 1000", async () => {
    const req = createMockReq({ id: "dep-1" }, { tailLines: "5000" }, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    await handler(req, res);

    expect(mockStreamLogs).toHaveBeenCalledWith(
      "dep-1",
      expect.any(Object),
      { tailLines: 1000 }
    );
  });

  it("defaults tailLines to 100", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    await handler(req, res);

    expect(mockStreamLogs).toHaveBeenCalledWith("dep-1", expect.any(Object), { tailLines: 100 });
  });

  it("sends error event when log stream fails to start", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockRejectedValue(new Error("Pod not found"));

    await handler(req, res);

    expect(res.write).toHaveBeenCalledWith(expect.stringContaining("event: error"));
    expect(res.end).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Connection Limiting
// ═══════════════════════════════════════════════════════════════════════
describe("per-user connection limiting", () => {
  it("returns 429 when user exceeds max connections", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: vi.fn() });

    // Open 10 connections (the max)
    const connections: any[] = [];
    for (let i = 0; i < 10; i++) {
      const req = createMockReq({ id: `dep-${i}` }, {}, { authorization: "Bearer t" });
      const res = createMockRes();
      connections.push({ req, res });
      await handler(req, res);
    }

    // 11th should be rejected
    const req = createMockReq({ id: "dep-11" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);

    // Cleanup: disconnect all to reset state
    for (const conn of connections) {
      conn.req.emit("close");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// QR Stream
// ═══════════════════════════════════════════════════════════════════════
describe("WhatsApp QR stream (/:id/whatsapp/qr)", () => {
  let handler: Function;

  beforeEach(() => {
    handler = getRouteHandler("get", "/:id/whatsapp/qr")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
  });

  it("returns 401 when unauthenticated", async () => {
    mockVerifyToken.mockRejectedValue(new Error("bad token"));
    const req = createMockReq({ id: "dep-1" }, {}, {});
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 404 when deployment not found", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue(null as any);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when deployment is not running", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "stopped",
    } as any);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when no running pod found", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockFindPod.mockResolvedValue(null);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("starts exec stream with correct WhatsApp login command", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockFindPod.mockResolvedValue("pod-1");
    mockStreamExec.mockResolvedValue({ abort: vi.fn() });

    await handler(req, res);

    expect(mockStreamExec).toHaveBeenCalledWith(
      "pod-1",
      ["npx", "openclaw", "channels", "login", "--channel", "whatsapp"],
      expect.any(Function), // onLine
      expect.any(Function), // onExit
    );
  });

  it("sets SSE headers for QR stream", async () => {
    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockFindPod.mockResolvedValue("pod-1");
    mockStreamExec.mockResolvedValue({ abort: vi.fn() });

    await handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Status Stream
// ═══════════════════════════════════════════════════════════════════════
describe("status stream (/status/stream)", () => {
  let handler: Function;

  beforeEach(() => {
    handler = getRouteHandler("get", "/status/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);
  });

  it("returns 401 when unauthenticated", async () => {
    mockVerifyToken.mockRejectedValue(new Error("bad token"));
    const req = createMockReq({}, {}, {});
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("sets SSE headers and sends connected comment", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([]);

    await handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));
    expect(res.write).toHaveBeenCalledWith(": connected\n\n");

    // Cleanup
    req.emit("close");
  });

  it("sends initial snapshot with user deployments", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "stopped" },
      { id: "dep-2", status: "running" },
    ] as any);
    mockStatusSubscribe.mockResolvedValue({
      deploymentId: "dep-2",
      status: "running",
    });

    await handler(req, res);

    // Should send snapshot event
    const snapshotWrite = res.write.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("event: snapshot")
    );
    expect(snapshotWrite).toBeTruthy();

    req.emit("close");
  });

  it("subscribes running deployments to status cache", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running" },
    ] as any);
    mockStatusSubscribe.mockResolvedValue({
      deploymentId: "dep-1",
      status: "running",
    });

    await handler(req, res);

    expect(mockStatusSubscribe).toHaveBeenCalledWith("dep-1", expect.any(Function));

    req.emit("close");
  });

  it("does not subscribe stopped deployments", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "stopped" },
    ] as any);

    await handler(req, res);

    expect(mockStatusSubscribe).not.toHaveBeenCalled();

    req.emit("close");
  });

  it("subscribes creating/restarting deployments", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "creating" },
      { id: "dep-2", status: "restarting" },
    ] as any);
    mockStatusSubscribe.mockResolvedValue({ deploymentId: "x", status: "creating" });

    await handler(req, res);

    expect(mockStatusSubscribe).toHaveBeenCalledTimes(2);

    req.emit("close");
  });

  it("cleans up on client disconnect", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockResolvedValue([
      { id: "dep-1", status: "running" },
    ] as any);
    mockStatusSubscribe.mockResolvedValue({ deploymentId: "dep-1", status: "running" });

    await handler(req, res);

    req.emit("close");

    expect(mockStatusUnsubscribeAll).toHaveBeenCalled();
  });

  it("sends error event when initial snapshot fails", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    mockDb.query.deployments.findMany.mockRejectedValue(new Error("DB error"));

    await handler(req, res);

    expect(res.write).toHaveBeenCalledWith(expect.stringContaining("event: error"));
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 500 on unexpected top-level error", async () => {
    const req = createMockReq({}, {}, { authorization: "Bearer t" });
    const res = createMockRes();
    // Simulate error before headers sent
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);

    // Make acquireConnection throw (internal state error)
    // This tests the outer try/catch
    mockDb.query.deployments.findMany.mockImplementation(() => {
      throw new Error("Unexpected");
    });

    await handler(req, res);

    // Should send error event or return 500
    const hasError = res.write.mock.calls.some(
      (call: any) => typeof call[0] === "string" && call[0].includes("error")
    ) || res.status.mock.calls.some((call: any) => call[0] === 500);
    expect(hasError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════════
describe("SSE error handling", () => {
  it("handles req error event on log stream", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);

    const abortFn = vi.fn();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: abortFn });

    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();

    await handler(req, res);

    // Simulate request error
    req.emit("error", new Error("Connection reset"));

    expect(abortFn).toHaveBeenCalled();
  });

  it("handles res error event on log stream", async () => {
    const handler = getRouteHandler("get", "/:id/logs/stream")!;
    mockVerifyToken.mockResolvedValue({ sub: "user-1" } as any);
    mockGetUserFromToken.mockResolvedValue(mockUser as any);

    const abortFn = vi.fn();
    mockDb.query.deployments.findFirst.mockResolvedValue({
      id: "dep-1", userId: "user-1", status: "running",
    } as any);
    mockStreamLogs.mockResolvedValue({ podName: "pod-1", abort: abortFn });

    const req = createMockReq({ id: "dep-1" }, {}, { authorization: "Bearer t" });
    const res = createMockRes();

    await handler(req, res);

    // Simulate response error
    res.emit("error", new Error("Write failed"));

    expect(abortFn).toHaveBeenCalled();
  });
});
