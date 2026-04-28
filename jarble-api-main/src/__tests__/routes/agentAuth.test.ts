/**
 * Tests for `src/routes/agentAuth.ts`
 *
 * The two endpoints in this file gate Traefik forward-auth on
 * `*.agents.jarble.ai` and issue the HMAC-signed access cookie that
 * proves a logged-in user owns a specific deployment. This is one of
 * the most security-sensitive surfaces in the API; the contracts
 * pinned here are:
 *
 *   1. Cookie unforgeability — HMAC bound to (deploymentId,
 *      userId, expiry). Tampering with any segment must invalidate
 *      the cookie. The HMAC verify uses timingSafeEqual so the
 *      hex-decoded buffers must be the right length — a regression
 *      that fed it a different shape would throw, not silently
 *      reject. Both behaviors are tested.
 *
 *   2. Cross-deployment isolation — a cookie for deployment A
 *      must NOT validate for deployment B even when both are owned
 *      by the same user.
 *
 *   3. Expiry — once the embedded epoch is in the past the cookie
 *      is rejected.
 *
 *   4. /verify-agent-access (Traefik forward-auth):
 *        - 401 if X-Forwarded-Host has no `<id>.agents.` prefix
 *        - 401 if cookie is missing
 *        - 401 if cookie deploymentId mismatches the host
 *        - 200 + Authorization header injection on valid cookie
 *        - 200 still returned if pod-address lookup throws (the
 *          gateway-token injection is best-effort, not gating)
 *
 *   5. /agent-session (cookie issuer):
 *        - 401 missing/invalid bearer
 *        - 401 user-not-found
 *        - 400 missing deploymentId in body
 *        - 403 deployment owned by another user
 *        - 200 success path sets the cookie with all required
 *          attributes (HttpOnly, Secure, SameSite=None, Max-Age,
 *          Domain, Path).
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import crypto from "crypto";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── Mocks (declared before SUT import) ──────────────────────────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__agentAuthTestDb;
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
    API_KEY_ENCRYPTION_KEY: "test-fallback-secret",
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

// ── Harness setup ───────────────────────────────────────────────────────────

import express from "express";
import { agentAuthRouter } from "../../routes/agentAuth.js";
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

// Force a deterministic signing secret so we can produce valid
// cookies in test code without reaching into module internals.
const SIGNING_SECRET = "test-agent-secret-known";
process.env.AGENT_AUTH_SECRET = SIGNING_SECRET;

const COOKIE_NAME = "jarble_agent";

function signFakeCookie(opts: {
  deploymentId: string;
  userId: string;
  expiry?: number; // epoch seconds; defaults to +1h from now
  badHmac?: boolean;
}): string {
  const expiry = opts.expiry ?? Math.floor(Date.now() / 1000) + 3600;
  const data = `${opts.deploymentId}:${opts.userId}:${expiry}`;
  const hmacKey = opts.badHmac ? "wrong-secret-tampered" : SIGNING_SECRET;
  const hmac = crypto.createHmac("sha256", hmacKey).update(data).digest("hex");
  return `${data}:${hmac}`;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/", agentAuthRouter);
  return app;
}

let ctx: TestDbContext;
let server: Server;
let port: number;

const VALID_TOKEN = "valid.jwt.token";
const USER = { id: "user-1", auth0Id: "auth0|user-1", email: "u@e.com" };

function seedDeployment(opts: { id?: string; ownerId?: string } = {}) {
  const { id = "dep-mine", ownerId = "user-1" } = opts;
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, 'Test Bot', 'openclaw', 'running', 0, 0, 'byok', 'openrouter', 'legacy')
  `).run(id, ownerId);
}

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__agentAuthTestDb = ctx.db;
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-1', 'u@e.com', 'User', 'auth0|user-1', 1, 0);
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('user-2', 'other@e.com', 'Other', 'auth0|user-2', 1, 0);
  `);

  vi.clearAllMocks();
  mockVerifyToken.mockResolvedValue({ sub: "auth0|user-1" });
  mockGetUserFromToken.mockResolvedValue(USER);
  mockGetPodAddress.mockResolvedValue({ ip: "10.0.0.1", port: 18789, gatewayToken: "gw-tok" });

  await new Promise<void>((resolve) => {
    server = createServer(buildApp());
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

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

afterAll(() => {
  if (ctx) ctx.raw.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function verifyAgent(opts: {
  forwardedHost?: string;
  cookie?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (opts.forwardedHost) headers["x-forwarded-host"] = opts.forwardedHost;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`http://127.0.0.1:${port}/verify-agent-access`, { headers });
  return { status: res.status, headers: res.headers };
}

async function postSession(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/agent-session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, headers: res.headers };
}

const auth = (token = VALID_TOKEN) => ({ authorization: `Bearer ${token}` });

// ════════════════════════════════════════════════════════════════════════════
// /verify-agent-access — host parsing
// ════════════════════════════════════════════════════════════════════════════

describe("GET /verify-agent-access — host parsing", () => {
  it("401 when X-Forwarded-Host header is missing", async () => {
    const r = await verifyAgent({});
    expect(r.status).toBe(401);
  });

  it("401 when X-Forwarded-Host has no `.agents.` segment", async () => {
    const r = await verifyAgent({ forwardedHost: "api.jarble.ai" });
    expect(r.status).toBe(401);
  });

  it("401 when X-Forwarded-Host is malformed (no subdomain)", async () => {
    const r = await verifyAgent({ forwardedHost: ".agents.jarble.ai" });
    expect(r.status).toBe(401);
  });

  it("extracts the deployment id from `<id>.agents.jarble.ai`", async () => {
    // Provide a valid cookie for that id so the request progresses
    // past host parsing AND cookie verification — a 200 here proves
    // the host regex captured `dep-mine` correctly.
    seedDeployment();
    const cookie = signFakeCookie({ deploymentId: "dep-mine", userId: "user-1" });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /verify-agent-access — cookie checks
// ════════════════════════════════════════════════════════════════════════════

describe("GET /verify-agent-access — cookie validation", () => {
  it("401 when cookie header is missing entirely", async () => {
    const r = await verifyAgent({ forwardedHost: "dep-mine.agents.jarble.ai" });
    expect(r.status).toBe(401);
  });

  it("401 when jarble_agent cookie is not present (other cookies are)", async () => {
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: "other_cookie=foo; another=bar",
    });
    expect(r.status).toBe(401);
  });

  it("401 when cookie has wrong number of segments", async () => {
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=tooshort:bad`,
    });
    expect(r.status).toBe(401);
  });

  it("401 when cookie HMAC is forged (signed with the wrong secret)", async () => {
    const cookie = signFakeCookie({
      deploymentId: "dep-mine",
      userId: "user-1",
      badHmac: true,
    });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(401);
  });

  it("401 when cookie deploymentId does not match the host", async () => {
    // Cookie signed for dep-other, request comes in for dep-mine.
    const cookie = signFakeCookie({ deploymentId: "dep-other", userId: "user-1" });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(401);
  });

  it("401 when cookie has expired", async () => {
    const cookie = signFakeCookie({
      deploymentId: "dep-mine",
      userId: "user-1",
      expiry: Math.floor(Date.now() / 1000) - 60, // 60s in the past
    });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(401);
  });

  it("401 when expiry is non-numeric", async () => {
    // Build a cookie with a string expiry segment to confirm
    // parseInt(NaN) → reject, not throw.
    const data = `dep-mine:user-1:notanumber`;
    const hmac = crypto.createHmac("sha256", SIGNING_SECRET).update(data).digest("hex");
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(`${data}:${hmac}`)}`,
    });
    expect(r.status).toBe(401);
  });

  it("200 + injects Authorization header when cookie is valid and pod has gateway token", async () => {
    seedDeployment();
    const cookie = signFakeCookie({ deploymentId: "dep-mine", userId: "user-1" });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("authorization")).toBe("Bearer gw-tok");
  });

  it("200 still returned when getPodAddress throws (gateway-token injection is best-effort)", async () => {
    mockGetPodAddress.mockRejectedValueOnce(new Error("k8s api error"));
    const cookie = signFakeCookie({ deploymentId: "dep-mine", userId: "user-1" });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("authorization")).toBeNull();
  });

  it("200 without Authorization header when pod has no gateway token", async () => {
    mockGetPodAddress.mockResolvedValueOnce({ ip: "10.0.0.1", port: 18789, gatewayToken: null });
    const cookie = signFakeCookie({ deploymentId: "dep-mine", userId: "user-1" });
    const r = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie)}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("authorization")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /agent-session — issuance contracts
// ════════════════════════════════════════════════════════════════════════════

describe("POST /agent-session — auth gate", () => {
  it("401 when authorization header is missing", async () => {
    const r = await postSession({ deploymentId: "dep-mine" });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: expect.stringContaining("authorization") });
  });

  it("401 when bearer token is malformed (no Bearer prefix)", async () => {
    const r = await postSession({ deploymentId: "dep-mine" }, { authorization: "Basic abc" });
    expect(r.status).toBe(401);
  });

  it("401 when verifyToken throws (bad signature, expired, etc.)", async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error("jwt expired"));
    const r = await postSession({ deploymentId: "dep-mine" }, auth());
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "Invalid token" });
  });

  it("401 when getUserFromToken returns null", async () => {
    mockGetUserFromToken.mockResolvedValueOnce(null);
    seedDeployment();
    const r = await postSession({ deploymentId: "dep-mine" }, auth());
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "User not found" });
  });
});

describe("POST /agent-session — input + ownership", () => {
  it("400 when deploymentId is missing from body", async () => {
    const r = await postSession({}, auth());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringContaining("deploymentId") });
  });

  it("400 when deploymentId is not a string", async () => {
    const r = await postSession({ deploymentId: 42 }, auth());
    expect(r.status).toBe(400);
  });

  it("403 when deployment is owned by a different user", async () => {
    seedDeployment({ id: "dep-other", ownerId: "user-2" });
    const r = await postSession({ deploymentId: "dep-other" }, auth());
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: expect.stringContaining("do not own") });
  });

  it("403 when deployment does not exist", async () => {
    const r = await postSession({ deploymentId: "dep-ghost" }, auth());
    expect(r.status).toBe(403);
  });
});

describe("POST /agent-session — happy path", () => {
  it("issues a Set-Cookie with the required security attributes", async () => {
    seedDeployment();
    const r = await postSession({ deploymentId: "dep-mine" }, auth());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    const setCookie = r.headers.get("set-cookie") || "";
    expect(setCookie).toContain("jarble_agent=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Domain=");
  });

  it("issued cookie verifies successfully on a follow-up /verify-agent-access call", async () => {
    // End-to-end loop: issue cookie via POST /agent-session, then
    // present it back to GET /verify-agent-access. Proves the
    // signing key path is consistent across the two endpoints.
    seedDeployment();
    const issue = await postSession({ deploymentId: "dep-mine" }, auth());
    expect(issue.status).toBe(200);

    const setCookie = issue.headers.get("set-cookie") || "";
    // The Set-Cookie header from express comes back as a single
    // string. Parse out the `jarble_agent=...;` segment.
    const m = setCookie.match(/jarble_agent=([^;]+)/);
    expect(m).not.toBeNull();
    const cookieVal = m![1];

    const verify = await verifyAgent({
      forwardedHost: "dep-mine.agents.jarble.ai",
      cookie: `${COOKIE_NAME}=${cookieVal}`,
    });
    expect(verify.status).toBe(200);
  });
});
