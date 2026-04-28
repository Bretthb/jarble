/**
 * WebSocket integration tests for `src/routes/chatControl.ts`.
 *
 * Auth + control channel for chat operations that don't fit in
 * SSE — stop generation, typing indicators, ping/pong. The auth
 * gate is in the HTTP upgrade handler; once promoted to a WS,
 * messages dispatch to the chatSessionManager.
 *
 * Three contracts pinned:
 *
 *   1. **Upgrade-time auth gate** — every connection MUST pass
 *      query-param JWT verification + deployment-ownership check
 *      BEFORE the socket is upgraded. A regression that promoted
 *      the connection first would let an attacker open a WS to
 *      any deployment and start sending control messages.
 *
 *   2. **Cross-creator isolation** — even with a valid JWT, a
 *      user MUST NOT be able to control another user's
 *      deployment. The ownership filter is `deploymentId AND
 *      userId` — a regression that dropped the userId filter
 *      would let any authed user stop any pod's generation.
 *
 *   3. **Message dispatch** — `stop` calls
 *      `sessionManager.abortRun(deploymentId)` and replies
 *      `stopped`; `typing` updates the typing flag; `ping` →
 *      `pong`. Malformed messages are silently ignored (don't
 *      crash the connection).
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── DB mock (proxy pattern) ─────────────────────────────────────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__chatCtlTestDb;
      if (!ref) throw new Error("Test DB not initialized");
      return ref[prop];
    },
  });
  return { db: proxy, tables: schema, dbDate: () => new Date().toISOString() };
});

// Auth mocks — verifyToken + getUserFromToken
const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();

vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

// chatSessionManager mocks
const mockAbortRun = vi.fn();
const mockSetTyping = vi.fn();

vi.mock("../../services/chatSessionManager.js", () => ({
  sessionManager: {
    abortRun: (...args: any[]) => mockAbortRun(...args),
    setTyping: (...args: any[]) => mockSetTyping(...args),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    DATABASE_URL: "postgres://test",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    NODE_ENV: "test",
  },
}));

import { createServer, type Server } from "http";
import { type AddressInfo } from "net";
import WebSocket from "ws";
import { attachChatControlWs } from "../../routes/chatControl.js";

// ── Lifecycle ───────────────────────────────────────────────────────────────

let server: Server;
let port: number;
let ctx: TestDbContext;

const VALID_TOKEN = "valid.jwt.token";
const USER = { id: "user-1", auth0Id: "auth0|user-1", email: "u@e.com" };

async function startServer() {
  return new Promise<void>((resolve) => {
    server = createServer();
    attachChatControlWs(server);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      port = addr.port;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise<void>((resolve) => {
    if (!server) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    // Force-close any lingering sockets (e.g. orphaned upgrades the
    // SUT left dangling on non-/ws/chat paths). closeAllConnections
    // is Node 18.2+; falls back to a hard timeout below if missing.
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    server.close(() => finish());
    // Hard timeout: if a socket is stuck (e.g. the SUT silently
    // ignored a non-matching upgrade path), don't deadlock the
    // afterEach hook — give up after 500ms and let GC reclaim it.
    setTimeout(finish, 500);
  });
}

function seedDeployment(ownerId: string, depId = "dep-mine") {
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, 'Test Bot', 'openclaw', 'running', 0, 0, 'byok', 'openrouter', 'legacy')
  `).run(depId, ownerId);
}

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__chatCtlTestDb = ctx.db;

  // Seed both users (deployments.user_id has a FK to users).
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-1', 'u@e.com', 'User One', 'auth0|user-1', 1, 0);
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-2', 'other@e.com', 'Other', 'auth0|user-2', 1, 0);
  `);

  vi.clearAllMocks();
  mockVerifyToken.mockResolvedValue({ sub: "auth0|user-1" });
  mockGetUserFromToken.mockResolvedValue(USER);

  await stopServer();
  await startServer();
});

afterEach(async () => {
  await stopServer();
});

afterAll(() => {
  if (ctx) ctx.raw.close();
});

/**
 * Open a WS connection. Resolves with the ws instance once handshake
 * succeeds OR with an Error containing the rejection status code on
 * upgrade failure (400/401/404).
 */
function connect(opts: {
  token?: string;
  deploymentId?: string;
}): Promise<WebSocket | { code: number }> {
  const params = new URLSearchParams();
  if (opts.token !== undefined) params.set("token", opts.token);
  if (opts.deploymentId !== undefined) params.set("deploymentId", opts.deploymentId);
  const url = `ws://127.0.0.1:${port}/ws/chat?${params.toString()}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => resolve({ code: res.statusCode || 0 }));
    ws.once("error", () => {
      // ws emits 'error' on connection refused / bad upgrade. The
      // unexpected-response listener fires first for HTTP-level
      // rejections, so this catches the truly-unexpected paths.
      // We don't expect to hit this branch in passing tests.
    });
  });
}

/** Send a message and wait for the next reply (resolves with parsed JSON or null). */
function sendAndReceive(ws: WebSocket, payload: any): Promise<any> {
  return new Promise((resolve) => {
    const onMsg = (raw: WebSocket.Data) => {
      ws.off("message", onMsg);
      try { resolve(JSON.parse(raw.toString())); } catch { resolve(null); }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify(payload));
    // Timeout after 1s — for messages the server doesn't reply to (e.g. typing)
    setTimeout(() => {
      ws.off("message", onMsg);
      resolve(null);
    }, 1000);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Upgrade-time auth gate
// ════════════════════════════════════════════════════════════════════════════

describe("upgrade auth gate", () => {
  it("rejects 400 when token query param is missing", async () => {
    seedDeployment("user-1");
    const result = await connect({ deploymentId: "dep-mine" });
    expect(result).toMatchObject({ code: 400 });
  });

  it("rejects 400 when deploymentId query param is missing", async () => {
    const result = await connect({ token: VALID_TOKEN });
    expect(result).toMatchObject({ code: 400 });
  });

  it("rejects 401 when verifyToken throws (bad signature, expired, etc.)", async () => {
    seedDeployment("user-1");
    mockVerifyToken.mockRejectedValueOnce(new Error("jwt expired"));

    const result = await connect({ token: "bad-token", deploymentId: "dep-mine" });
    expect(result).toMatchObject({ code: 401 });
  });

  it("rejects 401 when getUserFromToken returns null/undefined (user not in DB)", async () => {
    seedDeployment("user-1");
    mockGetUserFromToken.mockResolvedValueOnce(null);

    const result = await connect({ token: VALID_TOKEN, deploymentId: "dep-mine" });
    expect(result).toMatchObject({ code: 401 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cross-creator isolation
// ════════════════════════════════════════════════════════════════════════════

describe("ownership filter", () => {
  it("rejects 404 when deployment does not exist", async () => {
    const result = await connect({ token: VALID_TOKEN, deploymentId: "dep-ghost" });
    expect(result).toMatchObject({ code: 404 });
  });

  it("rejects 404 when deployment belongs to another user (NOT 401 — preferred to avoid existence probe)", async () => {
    // user-1 is the authed user; deployment owned by user-2.
    seedDeployment("user-2", "dep-theirs");

    const result = await connect({ token: VALID_TOKEN, deploymentId: "dep-theirs" });
    expect(result).toMatchObject({ code: 404 });
  });

  it("accepts the upgrade when deployment is owned by the authed user", async () => {
    seedDeployment("user-1", "dep-mine");

    const result = await connect({ token: VALID_TOKEN, deploymentId: "dep-mine" });
    // Real WebSocket instance (not a {code} object).
    expect(result).toBeInstanceOf(WebSocket);
    if (result instanceof WebSocket) {
      result.close();
      // Wait for close to settle.
      await new Promise((r) => setTimeout(r, 50));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Message dispatch
// ════════════════════════════════════════════════════════════════════════════

describe("message dispatch", () => {
  let ws: WebSocket = undefined as any;

  beforeEach(async () => {
    seedDeployment("user-1", "dep-mine");
    const result = await connect({ token: VALID_TOKEN, deploymentId: "dep-mine" });
    if (!(result instanceof WebSocket)) {
      throw new Error(`WS connect failed with code ${(result as any)?.code}`);
    }
    ws = result;
  });

  afterEach(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    ws = undefined as any;
  });

  it("stop → calls sessionManager.abortRun with deploymentId, replies type='stopped'", async () => {
    mockAbortRun.mockReturnValueOnce(true);

    const reply = await sendAndReceive(ws, { type: "stop" });

    expect(mockAbortRun).toHaveBeenCalledWith("dep-mine");
    expect(reply).toMatchObject({ type: "stopped", message: "Generation stopped" });
  });

  it("stop → 'No active generation' message when abortRun returns false", async () => {
    mockAbortRun.mockReturnValueOnce(false);

    const reply = await sendAndReceive(ws, { type: "stop" });

    expect(reply).toMatchObject({ type: "stopped", message: "No active generation" });
  });

  it("ping → replies type='pong'", async () => {
    const reply = await sendAndReceive(ws, { type: "ping" });
    expect(reply).toEqual({ type: "pong" });
  });

  it("typing → calls sessionManager.setTyping with the isTyping flag (no reply)", async () => {
    const reply = await sendAndReceive(ws, { type: "typing", isTyping: true });

    expect(mockSetTyping).toHaveBeenCalledWith("dep-mine", true);
    // No server message in response — sendAndReceive resolves null after timeout.
    expect(reply).toBeNull();
  });

  it("typing without isTyping defaults to false", async () => {
    await sendAndReceive(ws, { type: "typing" });

    expect(mockSetTyping).toHaveBeenCalledWith("dep-mine", false);
  });

  it("unknown type → replies type='error'", async () => {
    const reply = await sendAndReceive(ws, { type: "made-up-type" });
    expect(reply).toMatchObject({ type: "error" });
    expect(reply.message).toContain("Unknown message type");
  });

  it("malformed JSON → silently ignored (no crash, no reply)", async () => {
    const reply = await new Promise<any>((resolve) => {
      const onMsg = (raw: WebSocket.Data) => {
        ws.off("message", onMsg);
        try { resolve(JSON.parse(raw.toString())); } catch { resolve(null); }
      };
      ws.on("message", onMsg);
      ws.send("not-json{{{");
      setTimeout(() => {
        ws.off("message", onMsg);
        resolve(null);
      }, 500);
    });

    expect(reply).toBeNull();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("supports multiple sequential operations on the same connection", async () => {
    mockAbortRun.mockReturnValueOnce(true);

    const r1 = await sendAndReceive(ws, { type: "ping" });
    expect(r1).toEqual({ type: "pong" });

    const r2 = await sendAndReceive(ws, { type: "stop" });
    expect(r2.type).toBe("stopped");

    const r3 = await sendAndReceive(ws, { type: "ping" });
    expect(r3).toEqual({ type: "pong" });

    expect(mockAbortRun).toHaveBeenCalledTimes(1);
  });

  it("ignores upgrade requests on paths other than /ws/chat", async () => {
    // The handler short-circuits if pathname !== "/ws/chat". A
    // connection to /ws/other should be passed-through to whatever
    // else might handle it; in the test there's no other handler so
    // the upgrade fails. Connection error / close is acceptable.
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/other?token=x&deploymentId=y`);
    const result = await new Promise<string>((resolve) => {
      ws2.once("open", () => resolve("opened"));
      ws2.once("error", () => resolve("error"));
      ws2.once("close", () => resolve("closed"));
      ws2.once("unexpected-response", () => resolve("rejected"));
      setTimeout(() => resolve("timeout"), 1000);
    });
    // Force-terminate the socket so the underlying TCP connection
    // releases — otherwise stopServer() hangs in afterEach.
    try { ws2.terminate(); } catch { /* noop */ }
    // The test passes whichever way the rejection is signaled — the
    // important thing is the connection does NOT successfully open.
    expect(result).not.toBe("opened");
  });
});
