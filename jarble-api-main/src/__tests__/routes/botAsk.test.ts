/**
 * Tests for `POST /api/deployments/:id/bridge/ask` (src/routes/botAsk.ts).
 *
 * The route is the entry point for sandbox components asking the bot
 * out-of-band, isolated-session questions. Contracts pinned here:
 *
 *   1. Input validation gates (400 missing/oversize question).
 *   2. Auth gates (401 missing/invalid bearer; 403 cross-user dep).
 *   3. Lifecycle gate (400 when deployment is not running).
 *   4. Pod reachability (503 when no podIp can be resolved).
 *   5. Rate limiting:
 *        - per-deployment 10 asks / 60s window  → 429
 *        - per-deployment 3 concurrent          → 429
 *        - successful asks decrement the concurrent counter on a
 *          finally branch even when chatViaGateway throws.
 *   6. Happy path: chatViaGateway result.text is returned as `answer`.
 *
 * Approach: mount the router on an Express app on a random port, fetch
 * over real HTTP. Mock db, auth, K8s client, gateway, and secret read
 * surfaces — none of those are under test here.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__botAskTestDb;
      if (!ref) throw new Error("Test DB not initialized");
      return ref[prop];
    },
  });
  return {
    db: proxy,
    tables: schema,
    dbDate: () => new Date().toISOString(),
  };
});

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

// ── Auth mocks ──────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();

vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

// ── Gateway / K8s mocks ─────────────────────────────────────────────────────

const mockChatViaGateway = vi.fn();
vi.mock("../../services/openclawGateway.js", () => ({
  chatViaGateway: (...args: any[]) => mockChatViaGateway(...args),
}));

const mockFindPodForDeployment = vi.fn();
const mockReadCurrentSecretData = vi.fn();
vi.mock("../../k8s/index.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  readCurrentSecretData: (...args: any[]) => mockReadCurrentSecretData(...args),
}));

const mockReadNamespacedPod = vi.fn();
vi.mock("../../k8s/client.js", () => ({
  coreApi: { readNamespacedPod: (...args: any[]) => mockReadNamespacedPod(...args) },
}));

vi.mock("../../k8s/constants.js", () => ({ NAMESPACE: "jarble-test" }));

// ── Route + harness setup ───────────────────────────────────────────────────

import express from "express";
import { botAskRouter } from "../../routes/botAsk.js";
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deployments", botAskRouter);
  return app;
}

let ctx: TestDbContext;
let server: Server;
let port: number;

const VALID_TOKEN = "valid.jwt";
const USER = { id: "user-1", auth0Id: "auth0|user-1", email: "u@e.com" };

function seedDeployment(opts: {
  id?: string;
  ownerId?: string;
  status?: "running" | "stopped" | "failed";
} = {}) {
  const { id = "dep-1", ownerId = "user-1", status = "running" } = opts;
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, 'Test Bot', 'openclaw', ?, 0, 0, 'byok', 'openrouter', 'legacy')
  `).run(id, ownerId, status);
}

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__botAskTestDb = ctx.db;
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-1', 'u@e.com', 'User', 'auth0|user-1', 1, 0);
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-2', 'other@e.com', 'Other', 'auth0|user-2', 1, 0);
  `);

  vi.clearAllMocks();
  mockVerifyToken.mockResolvedValue({ sub: "auth0|user-1" });
  mockGetUserFromToken.mockResolvedValue(USER);
  mockFindPodForDeployment.mockResolvedValue("pod-name-1");
  mockReadNamespacedPod.mockResolvedValue({ body: { status: { podIP: "10.0.0.1" } } });
  mockReadCurrentSecretData.mockResolvedValue({ OPENCLAW_GATEWAY_TOKEN: "t-token" });
  mockChatViaGateway.mockResolvedValue({ text: "answer-text" });

  await new Promise<void>((resolve) => {
    server = createServer(buildApp());
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(() => {
  if (ctx) ctx.raw.close();
});

async function ask(body: unknown, headers: Record<string, string> = {}, depId = "dep-1") {
  const url = `http://127.0.0.1:${port}/api/deployments/${depId}/bridge/ask`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const auth = (token = VALID_TOKEN) => ({ authorization: `Bearer ${token}` });

// ── Stop server in-between tests ────────────────────────────────────────────

import { afterEach } from "vitest";
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    server.close(() => finish());
    setTimeout(finish, 500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Input validation
// ════════════════════════════════════════════════════════════════════════════

describe("input validation", () => {
  it("400 when question is missing", async () => {
    seedDeployment();
    const r = await ask({}, auth());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringContaining("question") });
  });

  it("400 when question is not a string", async () => {
    seedDeployment();
    const r = await ask({ question: 42 }, auth());
    expect(r.status).toBe(400);
  });

  it("400 when question exceeds 500 characters", async () => {
    seedDeployment();
    const r = await ask({ question: "x".repeat(501) }, auth());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringContaining("500") });
  });

  it("accepts question of exactly 500 chars (boundary inclusive)", async () => {
    seedDeployment();
    const r = await ask({ question: "x".repeat(500) }, auth());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ answer: "answer-text" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Auth gate
// ════════════════════════════════════════════════════════════════════════════

describe("auth gate", () => {
  it("401 when authorization header is missing", async () => {
    const r = await ask({ question: "hi" });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: expect.stringContaining("Bearer") });
  });

  it("401 when authorization header doesn't start with Bearer", async () => {
    const r = await ask({ question: "hi" }, { authorization: "Basic abc" });
    expect(r.status).toBe(401);
  });

  it("401 when getUserFromToken returns null (user not in DB) in production", async () => {
    // The route only returns 401 on user-null when NODE_ENV is
    // production. In test mode the catch falls through, so we have
    // to flip NODE_ENV for this assertion.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      seedDeployment();
      mockGetUserFromToken.mockResolvedValueOnce(null);
      const r = await ask({ question: "hi" }, auth());
      expect(r.status).toBe(401);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("403 when deployment belongs to another user", async () => {
    seedDeployment({ ownerId: "user-2" });
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: expect.stringContaining("Not authorized") });
  });

  it("403 when deployment does not exist", async () => {
    // No seed → deployment lookup returns undefined.
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(403);
  });

  it("dev mode swallows verifyToken throw and continues to rate-limit + lifecycle gate", async () => {
    // In non-prod, the auth try/catch falls through silently. The
    // request then proceeds to the deployment-not-running gate.
    // Without a deployment seeded the second db.query.findFirst
    // also returns undefined → 400 "Deployment is not running".
    seedDeployment({ status: "stopped" });
    mockVerifyToken.mockRejectedValueOnce(new Error("jwt invalid"));
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringContaining("not running") });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Lifecycle gate
// ════════════════════════════════════════════════════════════════════════════

describe("deployment lifecycle gate", () => {
  it("400 when deployment status is not 'running'", async () => {
    seedDeployment({ status: "stopped" });
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringContaining("not running") });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Pod reachability gate
// ════════════════════════════════════════════════════════════════════════════

describe("pod reachability gate", () => {
  it("503 when findPodForDeployment returns null", async () => {
    seedDeployment();
    mockFindPodForDeployment.mockResolvedValueOnce(null);
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: expect.stringContaining("Pod not reachable") });
  });

  it("503 when readNamespacedPod returns no podIP", async () => {
    seedDeployment();
    mockReadNamespacedPod.mockResolvedValueOnce({ body: { status: {} } });
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(503);
  });

  it("503 when K8s lookup throws (caught silently → no podIp)", async () => {
    seedDeployment();
    mockFindPodForDeployment.mockRejectedValueOnce(new Error("k8s down"));
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(503);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Happy path
// ════════════════════════════════════════════════════════════════════════════

describe("happy path", () => {
  it("calls chatViaGateway with pod IP, gateway token, and an isolated sessionKey", async () => {
    seedDeployment();
    const r = await ask({ question: "what is up?", cardId: "card-7" }, auth());

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ answer: "answer-text" });
    expect(mockChatViaGateway).toHaveBeenCalledTimes(1);
    const [target, question] = mockChatViaGateway.mock.calls[0];
    expect(target).toMatchObject({
      ip: "10.0.0.1",
      port: 18789,
      gatewayToken: "t-token",
      sessionKey: expect.stringMatching(/^ask-card-7-\d+$/),
    });
    expect(question).toBe("what is up?");
  });

  it("uses 'unknown' cardId when none provided", async () => {
    seedDeployment();
    await ask({ question: "ping" }, auth());
    const target = mockChatViaGateway.mock.calls[0][0];
    expect(target.sessionKey).toMatch(/^ask-unknown-\d+$/);
  });

  it("falls back to empty gateway token when secret read returns null", async () => {
    seedDeployment();
    mockReadCurrentSecretData.mockResolvedValueOnce(null);
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(200);
    const target = mockChatViaGateway.mock.calls[0][0];
    expect(target.gatewayToken).toBe("");
  });

  it("returns 500 when chatViaGateway throws", async () => {
    seedDeployment();
    mockChatViaGateway.mockRejectedValueOnce(new Error("gateway timeout"));
    const r = await ask({ question: "hi" }, auth());
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: expect.stringContaining("gateway timeout") });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rate limiting
// ════════════════════════════════════════════════════════════════════════════

// Rate limiter state is module-level (Maps keyed by deploymentId)
// and persists across tests in this file. Use a unique deployment
// id per test to keep windows isolated.
describe("rate limiting", () => {
  it("429 when concurrent count is at MAX_CONCURRENT (3)", async () => {
    const id = "dep-conc";
    seedDeployment({ id });
    // Hold 3 in-flight asks by stalling the gateway.
    let resolveGateway: () => void = () => {};
    const stalled = new Promise<{ text: string }>((resolve) => {
      resolveGateway = () => resolve({ text: "later" });
    });
    mockChatViaGateway.mockReturnValue(stalled);

    const a = ask({ question: "1" }, auth(), id);
    const b = ask({ question: "2" }, auth(), id);
    const c = ask({ question: "3" }, auth(), id);
    // Give the three above time to enter the concurrent counter.
    await new Promise((r) => setTimeout(r, 50));

    // 4th must be rejected as concurrent-over-limit.
    const fourth = await ask({ question: "4" }, auth(), id);
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ error: expect.stringContaining("concurrent") });

    // Drain the stalled three.
    resolveGateway();
    await Promise.all([a, b, c]);
  });

  it("decrements concurrent counter even when gateway throws (finally branch)", async () => {
    const id = "dep-dec";
    seedDeployment({ id });
    // Three failing asks should each push concurrent up by 1 and
    // then back down by 1 in the finally. After the burst, a 4th
    // request must succeed.
    mockChatViaGateway.mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 3; i++) {
      const r = await ask({ question: `q${i}` }, auth(), id);
      expect(r.status).toBe(500);
    }
    mockChatViaGateway.mockResolvedValueOnce({ text: "ok-after" });
    const ok = await ask({ question: "after" }, auth(), id);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ answer: "ok-after" });
  });

  it("429 when 60-second window has 10 asks already", async () => {
    const id = "dep-window";
    seedDeployment({ id });
    // Fire 10 sequential asks (succeeds → window fills).
    for (let i = 0; i < 10; i++) {
      const r = await ask({ question: `q${i}` }, auth(), id);
      expect(r.status).toBe(200);
    }
    // 11th should hit per-minute window cap.
    const eleventh = await ask({ question: "over" }, auth(), id);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toMatchObject({ error: expect.stringMatching(/rate limit/i) });
  });

  it("rate-limit windows are per-deployment (different dep is unaffected)", async () => {
    seedDeployment({ id: "dep-perDepA" });
    seedDeployment({ id: "dep-perDepB" });
    for (let i = 0; i < 10; i++) {
      const r = await ask({ question: `qA${i}` }, auth(), "dep-perDepA");
      expect(r.status).toBe(200);
    }
    // dep-perDepA is now at cap.
    const overA = await ask({ question: "over-A" }, auth(), "dep-perDepA");
    expect(overA.status).toBe(429);
    // dep-perDepB should still pass.
    const okB = await ask({ question: "first-B" }, auth(), "dep-perDepB");
    expect(okB.status).toBe(200);
  });
});
