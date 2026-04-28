/**
 * Tests for `src/routes/openWebUiProxy.ts`
 *
 * The Open WebUI proxy reverse-proxies *all* HTTP methods on
 * /api/deployments/:id/webui/* to the OpenWebUI sidecar inside the
 * deployment pod. Contracts pinned here:
 *
 *   1. Auth: header bearer OR ?token= query param OR session cookie
 *      from a prior authenticated load. 401 only when none works.
 *   2. Cross-user / missing deployment → 404 (intentional — leaks
 *      neither existence nor ownership).
 *   3. Pod address unresolvable → 503.
 *   4. Query-param forwarding: `?token=` is intentionally STRIPPED
 *      so the upstream never sees the API's auth token, but other
 *      query params are forwarded verbatim.
 *   5. HTML at the proxy root gets a `<base href="…/webui/">`
 *      injected so the SPA's absolute asset paths resolve through
 *      the proxy. Non-HTML / nested paths pass through unchanged.
 *   6. Initial JWT-authenticated request sets an HttpOnly session
 *      cookie scoped to the deployment's webui prefix.
 *   7. Upstream fetch throw → 502 "not reachable".
 *
 * Approach: mount the router on Express, real http.Server on a
 * random port. Mock global fetch so calls to the upstream pod IP
 * are intercepted while calls back to the test server (the test
 * client) pass through to the real fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__webUiTestDb;
      if (!ref) throw new Error("Test DB not initialized");
      return ref[prop];
    },
  });
  return { db: proxy, tables: schema, dbDate: () => new Date().toISOString() };
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

const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();
vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

const mockGetPodAddress = vi.fn();
vi.mock("../../k8s/index.js", () => ({
  getPodAddress: (...args: any[]) => mockGetPodAddress(...args),
}));

vi.mock("../../k8s/constants.js", () => ({
  OPEN_WEBUI_PORT: 8080,
  NAMESPACE: "jarble-test",
}));

// ── Harness setup ───────────────────────────────────────────────────────────

import express from "express";
import { openWebUiProxyRouter } from "../../routes/openWebUiProxy.js";
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deployments", openWebUiProxyRouter);
  return app;
}

let ctx: TestDbContext;
let server: Server;
let port: number;

const VALID_TOKEN = "valid.jwt";
const USER = { id: "user-1", auth0Id: "auth0|user-1", email: "u@e.com" };

// fetch interception state — refreshed every test
const realFetch = globalThis.fetch;
type UpstreamResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
};
let upstreamResponse: UpstreamResponse | null = null;
let upstreamThrow: Error | null = null;
let upstreamCalls: { url: string; method: string; body?: any; headers?: any }[] = [];

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__webUiTestDb = ctx.db;
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-1', 'u@e.com', 'User', 'auth0|user-1', 1, 0);
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-2', 'other@e.com', 'Other', 'auth0|user-2', 1, 0);
  `);

  vi.clearAllMocks();
  mockVerifyToken.mockResolvedValue({ sub: "auth0|user-1" });
  mockGetUserFromToken.mockResolvedValue(USER);
  mockGetPodAddress.mockResolvedValue({ ip: "10.0.0.1", port: 8080, gatewayToken: null });

  upstreamResponse = { status: 200, headers: { "content-type": "text/plain" }, body: "ok" };
  upstreamThrow = null;
  upstreamCalls = [];

  // Selectively intercept fetch: only intercept calls to the
  // upstream pod IP. Fall through to realFetch for everything else
  // (including the test client hitting the local 127.0.0.1 server).
  globalThis.fetch = (async (url: any, opts: any) => {
    const urlStr = typeof url === "string" ? url : url?.toString?.() ?? "";
    if (urlStr.startsWith("http://10.0.0.1")) {
      upstreamCalls.push({
        url: urlStr,
        method: opts?.method ?? "GET",
        body: opts?.body,
        headers: opts?.headers,
      });
      if (upstreamThrow) throw upstreamThrow;
      const r = upstreamResponse ?? { status: 502, body: "" };
      const headers = new Headers(r.headers || {});
      const body = typeof r.body === "string" ? Buffer.from(r.body) : (r.body ?? Buffer.alloc(0));
      return new Response(body, { status: r.status ?? 200, headers });
    }
    return realFetch(url, opts);
  }) as typeof fetch;

  await new Promise<void>((resolve) => {
    server = createServer(buildApp());
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterEach(async () => {
  globalThis.fetch = realFetch;
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

afterAll(() => {
  if (ctx) ctx.raw.close();
});

function seedDeployment(opts: { id?: string; ownerId?: string } = {}) {
  const { id = "dep-mine", ownerId = "user-1" } = opts;
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, 'Test Bot', 'openclaw', 'running', 0, 0, 'byok', 'openrouter', 'legacy')
  `).run(id, ownerId);
}

async function proxy(opts: {
  path?: string; // suffix after /webui/, default ""
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  depId?: string;
} = {}) {
  const { path = "", method = "GET", headers = {}, body, query = {}, depId = "dep-mine" } = opts;
  const qs = new URLSearchParams(query).toString();
  const url = `http://127.0.0.1:${port}/api/deployments/${depId}/webui/${path}${qs ? `?${qs}` : ""}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as any)["content-type"] = (init.headers as any)["content-type"] || "application/json";
  }
  const res = await realFetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const auth = (token = VALID_TOKEN) => ({ authorization: `Bearer ${token}` });

// ════════════════════════════════════════════════════════════════════════════
// Auth gate
// ════════════════════════════════════════════════════════════════════════════

describe("auth gate", () => {
  it("401 when no bearer / no ?token / no cookie", async () => {
    seedDeployment();
    const r = await proxy({});
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "Unauthorized" });
  });

  it("accepts authentication via ?token= query param (iframe path)", async () => {
    seedDeployment();
    const r = await proxy({ query: { token: VALID_TOKEN } });
    expect(r.status).toBe(200);
    // The auth token must be stripped before forwarding to upstream.
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].url).not.toContain("token=");
  });

  it("accepts authentication via Authorization: Bearer header", async () => {
    seedDeployment();
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(200);
  });

  it("401 when verifyToken throws (resolveUser returns null)", async () => {
    seedDeployment();
    mockVerifyToken.mockRejectedValueOnce(new Error("jwt expired"));
    const r = await proxy({ headers: auth("bad-token") });
    expect(r.status).toBe(401);
  });

  it("401 when getUserFromToken returns null (resolveUser returns null)", async () => {
    seedDeployment();
    mockGetUserFromToken.mockResolvedValueOnce(null);
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Ownership / lifecycle / pod
// ════════════════════════════════════════════════════════════════════════════

describe("ownership + lifecycle", () => {
  it("404 when deployment is owned by another user (does NOT 401, intentionally)", async () => {
    seedDeployment({ ownerId: "user-2" });
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(404);
  });

  it("404 when deployment does not exist", async () => {
    const r = await proxy({ headers: auth(), depId: "dep-ghost" });
    expect(r.status).toBe(404);
  });

  it("503 when getPodAddress returns null (pod not running)", async () => {
    seedDeployment();
    mockGetPodAddress.mockResolvedValueOnce(null);
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: "Pod not reachable" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cookie issuance + reuse
// ════════════════════════════════════════════════════════════════════════════

describe("session cookie", () => {
  it("first JWT-authenticated request sets an HttpOnly session cookie", async () => {
    seedDeployment();
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(200);

    const setCookie = r.headers.get("set-cookie") || "";
    expect(setCookie).toContain("jarble_webui_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).toContain("Path=/api/deployments/dep-mine/webui");
  });

  it("subsequent request with only the cookie still authenticates (no JWT needed)", async () => {
    seedDeployment();
    const first = await proxy({ headers: auth() });
    expect(first.status).toBe(200);
    const setCookie = first.headers.get("set-cookie") || "";
    const m = setCookie.match(/jarble_webui_session=([^;]+)/);
    expect(m).not.toBeNull();
    const cookieVal = m![1];

    // Second request — no Authorization header, no ?token, just the cookie.
    const second = await proxy({
      headers: { cookie: `jarble_webui_session=${cookieVal}` },
    });
    expect(second.status).toBe(200);
    // No new cookie should be set on cookie-only flow.
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("cookie issued for deployment A does NOT authenticate against deployment B", async () => {
    seedDeployment({ id: "dep-A" });
    seedDeployment({ id: "dep-B" });
    const first = await proxy({ headers: auth(), depId: "dep-A" });
    const cookieVal = first.headers.get("set-cookie")!.match(/jarble_webui_session=([^;]+)/)![1];

    const r = await proxy({
      depId: "dep-B",
      headers: { cookie: `jarble_webui_session=${cookieVal}` },
    });
    expect(r.status).toBe(401);
  });

  it("ignores cookie with the wrong number of segments", async () => {
    seedDeployment();
    const r = await proxy({ headers: { cookie: "jarble_webui_session=tooshort" } });
    expect(r.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Upstream proxying
// ════════════════════════════════════════════════════════════════════════════

describe("upstream proxying", () => {
  it("forwards GET to upstream pod IP + port + path", async () => {
    seedDeployment();
    await proxy({ headers: auth(), path: "static/main.js" });
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].method).toBe("GET");
    expect(upstreamCalls[0].url).toBe("http://10.0.0.1:8080/static/main.js");
  });

  it("forwards POST request body when present", async () => {
    seedDeployment();
    await proxy({
      headers: auth(),
      method: "POST",
      path: "api/v1/foo",
      body: { hello: "world" },
    });
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].method).toBe("POST");
    expect(upstreamCalls[0].body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("forwards non-token query params and strips ?token", async () => {
    seedDeployment();
    await proxy({
      headers: auth(),
      query: { foo: "bar", baz: "qux" },
    });
    expect(upstreamCalls).toHaveLength(1);
    const url = new URL(upstreamCalls[0].url);
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("baz")).toBe("qux");
    expect(url.searchParams.has("token")).toBe(false);
  });

  it("forwards upstream status code unchanged", async () => {
    seedDeployment();
    upstreamResponse = { status: 418, headers: { "content-type": "text/plain" }, body: "teapot" };
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(418);
  });

  it("forwards upstream content-type header", async () => {
    seedDeployment();
    upstreamResponse = { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' };
    const r = await proxy({ headers: auth(), path: "api/v1/foo" });
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("502 when upstream fetch throws", async () => {
    seedDeployment();
    upstreamThrow = new Error("ECONNREFUSED");
    const r = await proxy({ headers: auth() });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "Open WebUI not reachable" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HTML <base> tag injection
// ════════════════════════════════════════════════════════════════════════════

describe("HTML root <base> tag injection", () => {
  it("injects <base href=\"…/webui/\"> on root HTML response", async () => {
    seedDeployment();
    upstreamResponse = {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><head><title>WebUI</title></head><body>hello</body></html>",
    };
    // Path "" → suffix "" → triggers HTML rewrite branch.
    const r = await proxy({ headers: auth(), path: "" });
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe("string");
    expect(r.body as string).toContain('<base href="/api/deployments/dep-mine/webui/">');
  });

  it("does NOT inject <base> on nested HTML paths (only root)", async () => {
    seedDeployment();
    upstreamResponse = {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><head></head><body>nested</body></html>",
    };
    const r = await proxy({ headers: auth(), path: "deep/page.html" });
    expect(r.status).toBe(200);
    expect(r.body as string).not.toContain("<base href");
  });

  it("does NOT inject <base> on non-HTML responses", async () => {
    seedDeployment();
    upstreamResponse = {
      status: 200,
      headers: { "content-type": "application/javascript" },
      body: "console.log('hi')",
    };
    const r = await proxy({ headers: auth(), path: "static/app.js" });
    expect(r.status).toBe(200);
    expect(r.body as string).not.toContain("<base href");
  });
});
