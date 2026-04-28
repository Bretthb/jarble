/**
 * REST integration tests for `src/routes/webhooks.ts`.
 *
 * Two M2M-authenticated webhook endpoints:
 *   POST /webhooks/auth0/email-verified — Auth0 Post Email
 *     Verification Action → updates `users.emailVerified`.
 *   POST /webhooks/config-changed — Pod-side file watcher →
 *     triggers `syncConfigsFromPvc` for the deployment.
 *
 * Three contracts pinned:
 *
 *   1. **Constant-time secret comparison** — both endpoints
 *      use `timingSafeEqual` (via `secureCompare`) to prevent
 *      timing attacks on the M2M secret. The `length !== length`
 *      short-circuit is the only fast path; equal-length wrong
 *      secrets MUST go through `timingSafeEqual`.
 *
 *   2. **Configured-secret precondition** — when the env var
 *      is missing, both endpoints return 503 (not 401).
 *      Distinguishing "we have no shared secret" from "your
 *      secret is wrong" prevents the caller from probing
 *      whether the integration is configured.
 *
 *   3. **404 vs 200-with-reason on user-not-found** — the
 *      Auth0 webhook deliberately returns 200 with
 *      `reason: "user_not_found"` (NOT 404) when the auth0Id
 *      doesn't match a DB row. The hook fires before the
 *      first JWT-claim-driven user provisioning, so a 404
 *      would make Auth0's retry policy spam us.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── DB mock (proxy pattern, same as podPlatformApi.test.ts) ─────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__webhooksTestDb;
      if (!ref) throw new Error("Test DB not initialized");
      return ref[prop];
    },
  });
  return { db: proxy, tables: schema, dbDate: () => new Date().toISOString() };
});

// Track configSync invocations.
const mockSyncConfigsFromPvc = vi.fn().mockResolvedValue(undefined);
const mockSafeFireAndForget = vi.fn();

vi.mock("../../services/configSync.js", () => ({
  syncConfigsFromPvc: (...args: any[]) => mockSyncConfigsFromPvc(...args),
}));

vi.mock("../../utils/safeAsync.js", () => ({
  safeFireAndForget: (...args: any[]) => mockSafeFireAndForget(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const M2M_SECRET = "auth0-m2m-shared-secret-1234567890";
const CONFIG_WEBHOOK_SECRET = "config-webhook-shared-secret-abcdef";

// Mutable env mock so per-test overrides are possible (some tests run
// with the secret unset to verify the 503 path).
const mockEnv = vi.hoisted(() => ({
  AUTH0_M2M_SECRET: undefined as string | undefined,
  CONFIG_WEBHOOK_SECRET: undefined as string | undefined,
  DATABASE_URL: "postgres://test",
  AUTH0_DOMAIN: "test.auth0.com",
  AUTH0_AUDIENCE: "https://api.jarble.ai",
  NODE_ENV: "test",
}));
vi.mock("../../utils/env.js", () => ({ env: mockEnv }));

import express from "express";
import { webhooksRouter } from "../../routes/webhooks.js";
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/webhooks", webhooksRouter);
  return app;
}

let server: Server;
let baseUrl: string;
let ctx: TestDbContext;

async function startServer(app: express.Express) {
  return new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

async function request(
  path: string,
  opts: { body?: any; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== undefined) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__webhooksTestDb = ctx.db;

  // Reset env to "configured with secrets" by default — tests that
  // exercise the unconfigured 503 path override per-case.
  mockEnv.AUTH0_M2M_SECRET = M2M_SECRET;
  mockEnv.CONFIG_WEBHOOK_SECRET = CONFIG_WEBHOOK_SECRET;

  vi.clearAllMocks();
  mockSyncConfigsFromPvc.mockResolvedValue(undefined);

  await stopServer();
  await startServer(createApp());
});

afterAll(async () => {
  await stopServer();
  ctx?.raw.close();
});

// ════════════════════════════════════════════════════════════════════════════
// POST /webhooks/auth0/email-verified
// ════════════════════════════════════════════════════════════════════════════

describe("POST /webhooks/auth0/email-verified — auth gate", () => {
  it("returns 503 when AUTH0_M2M_SECRET is not configured", async () => {
    mockEnv.AUTH0_M2M_SECRET = undefined;

    const r = await request("/webhooks/auth0/email-verified", {
      token: "anything",
      body: { auth0Id: "auth0|x" },
    });

    expect(r.status).toBe(503);
    expect(r.body.error).toContain("not configured");
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      body: { auth0Id: "auth0|x" },
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("Unauthorized");
  });

  it("returns 401 when the Bearer token does not match the secret", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      token: "wrong-secret-but-same-shape",
      body: { auth0Id: "auth0|x" },
    });
    expect(r.status).toBe(401);
  });

  it("returns 401 when the token has the right prefix but wrong content", async () => {
    // Same length as the real secret (timing-safe comparison only short-
    // circuits on different lengths). Pinning that secureCompare is
    // length-aware AND uses timingSafeEqual for equal-length comparisons.
    const wrongSameLen = "X".repeat(M2M_SECRET.length);
    const r = await request("/webhooks/auth0/email-verified", {
      token: wrongSameLen,
      body: { auth0Id: "auth0|x" },
    });
    expect(r.status).toBe(401);
  });

  it("returns 401 when the token is shorter than the secret (length-mismatch fast path)", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      token: "x", // 1 char
      body: { auth0Id: "auth0|x" },
    });
    expect(r.status).toBe(401);
  });
});

describe("POST /webhooks/auth0/email-verified — request validation", () => {
  it("returns 400 when auth0Id is missing from the body", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: { email: "alice@example.com" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("auth0Id");
  });

  it("returns 400 when body is empty (no auth0Id)", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: {},
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /webhooks/auth0/email-verified — happy path + state branches", () => {
  function seedUser(overrides: Partial<any> = {}) {
    ctx.raw.prepare(`
      INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(
      overrides.id ?? "u-1",
      overrides.email ?? "alice@example.com",
      overrides.name ?? "Alice",
      overrides.auth0Id ?? "auth0|alice",
      overrides.emailVerified ? 1 : 0,
    );
  }

  it("returns 200 with reason=user_not_found when auth0Id has no DB row (Auth0 fires before our provisioning)", async () => {
    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: { auth0Id: "auth0|never-seen" },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, updated: false, reason: "user_not_found" });
  });

  it("returns 200 with reason=already_verified when user already has emailVerified=true (idempotent)", async () => {
    seedUser({ id: "u-1", auth0Id: "auth0|alice", emailVerified: true });

    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: { auth0Id: "auth0|alice" },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, updated: false, reason: "already_verified" });

    // emailVerified stays true (no spurious update).
    const row = ctx.raw.prepare("SELECT email_verified FROM users WHERE id = 'u-1'").get() as any;
    expect(row.email_verified).toBe(1);
  });

  it("flips emailVerified to true when user exists and was unverified", async () => {
    seedUser({ id: "u-2", auth0Id: "auth0|bob", emailVerified: false });

    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: { auth0Id: "auth0|bob" },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, updated: true });

    const row = ctx.raw.prepare("SELECT email_verified FROM users WHERE id = 'u-2'").get() as any;
    expect(row.email_verified).toBe(1);
  });

  it("matches by auth0Id (NOT by email)", async () => {
    seedUser({ id: "u-3", auth0Id: "auth0|specific-user", email: "carol@example.com", emailVerified: false });

    // Send with the SAME email but a different auth0Id — should NOT update.
    const r = await request("/webhooks/auth0/email-verified", {
      token: M2M_SECRET,
      body: { auth0Id: "auth0|different-user", email: "carol@example.com" },
    });

    expect(r.status).toBe(200);
    expect(r.body.reason).toBe("user_not_found");

    // The actual user with matching email but different auth0Id stays unverified.
    const row = ctx.raw.prepare("SELECT email_verified FROM users WHERE id = 'u-3'").get() as any;
    expect(row.email_verified).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /webhooks/config-changed
// ════════════════════════════════════════════════════════════════════════════

describe("POST /webhooks/config-changed — auth gate", () => {
  it("returns 503 when CONFIG_WEBHOOK_SECRET is not configured", async () => {
    mockEnv.CONFIG_WEBHOOK_SECRET = undefined;

    const r = await request("/webhooks/config-changed", {
      token: "anything",
      body: { deploymentId: "dep-x" },
    });

    expect(r.status).toBe(503);
    expect(r.body.error).toContain("not configured");
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const r = await request("/webhooks/config-changed", {
      body: { deploymentId: "dep-x" },
    });
    expect(r.status).toBe(401);
  });

  it("returns 401 when token doesn't match (constant-time comparison)", async () => {
    const r = await request("/webhooks/config-changed", {
      token: "wrong-token",
      body: { deploymentId: "dep-x" },
    });
    expect(r.status).toBe(401);
  });

  it("uses a DIFFERENT secret than the Auth0 webhook (separate trust domains)", async () => {
    // Sending the Auth0 secret to the config webhook MUST fail — the
    // two M2M boundaries are separate trust domains. A regression that
    // collapsed them into one shared secret would let a compromised
    // Auth0 SDK trigger arbitrary configSync.
    const r = await request("/webhooks/config-changed", {
      token: M2M_SECRET, // Auth0's secret
      body: { deploymentId: "dep-x" },
    });
    expect(r.status).toBe(401);
  });
});

describe("POST /webhooks/config-changed — request validation", () => {
  it("returns 400 when deploymentId is missing", async () => {
    const r = await request("/webhooks/config-changed", {
      token: CONFIG_WEBHOOK_SECRET,
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("deploymentId");
  });

  it("returns 400 when deploymentId is not a string (defensive)", async () => {
    const r = await request("/webhooks/config-changed", {
      token: CONFIG_WEBHOOK_SECRET,
      body: { deploymentId: 12345 },
    });
    expect(r.status).toBe(400);
  });

  it("returns 404 when the deployment does not exist", async () => {
    const r = await request("/webhooks/config-changed", {
      token: CONFIG_WEBHOOK_SECRET,
      body: { deploymentId: "dep-ghost" },
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toContain("not found");
    // configSync MUST NOT fire for a non-existent deployment.
    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/config-changed — happy path", () => {
  function seedDeployment(id = "dep-x") {
    ctx.raw.prepare(`
      INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
      VALUES (?, ?, 'Test Bot', 'openclaw', 'running', 0, 0, 'byok', 'openrouter', 'legacy')
    `).run(id, ctx.testUserId);
  }

  it("returns 200 + ok:true on a valid request and triggers configSync fire-and-forget", async () => {
    seedDeployment("dep-x");

    const r = await request("/webhooks/config-changed", {
      token: CONFIG_WEBHOOK_SECRET,
      body: { deploymentId: "dep-x" },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    // configSync was triggered via safeFireAndForget with the right context.
    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
    expect(mockSafeFireAndForget.mock.calls[0][1]).toEqual({
      operation: "syncConfigsFromPvc",
      deploymentId: "dep-x",
    });
  });

  it("does NOT block the response on configSync completion (fire-and-forget)", async () => {
    // Make syncConfigsFromPvc never resolve — the response should still
    // come back quickly.
    mockSyncConfigsFromPvc.mockReturnValueOnce(new Promise(() => {}));

    seedDeployment("dep-y");

    const start = Date.now();
    const r = await request("/webhooks/config-changed", {
      token: CONFIG_WEBHOOK_SECRET,
      body: { deploymentId: "dep-y" },
    });
    const elapsedMs = Date.now() - start;

    expect(r.status).toBe(200);
    // Response within a few seconds (very loose because of HTTP server overhead),
    // and definitely NOT blocked on the never-resolving sync.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
