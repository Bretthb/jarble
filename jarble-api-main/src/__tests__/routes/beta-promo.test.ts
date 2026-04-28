/**
 * REST integration tests for two small public endpoints:
 *   POST /api/beta             — beta-tester signup form
 *   POST /api/promo/validate   — discount code validation
 *
 * Both are unauthenticated public endpoints with input validation.
 * The contracts pinned here are the input-validation gates and the
 * structured error responses the frontend depends on.
 *
 * Test approach: mount the route on a real Express app + fetch
 * over a real HTTP socket, mocking the db module. Same pattern as
 * src/__tests__/routes/podPlatformApi.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy({}, {
    get(_t, prop) {
      const ref = (globalThis as any).__betaPromoTestDb;
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

// routes/promo.ts imports promoCodes + promoRedemptions DIRECTLY from
// db/schema.pg.js. The DB mock above only handles the `tables` re-export
// surface; we have to redirect the schema-pg path to the SQLite mirror
// too so drizzle eq() / and() comparisons line up with the table objects
// our test DB knows about.
vi.mock("../../db/schema.pg.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return schema;
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

// promo's getUserFromRequest delegates to services/auth.ts. Mock to
// return null (anonymous) by default — tests that need an authed
// caller can override with mockGetUserFromRequest.
const mockGetUserFromRequest = vi.fn().mockResolvedValue(null);
vi.mock("../../helpers/auth.js", () => ({
  getUserFromRequest: (...args: any[]) => mockGetUserFromRequest(...args),
}));

import express from "express";
import { betaRouter } from "../../routes/beta.js";
import { promoRouter } from "../../routes/promo.js";
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/beta", betaRouter);
  app.use("/api/promo", promoRouter);
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
  method: "GET" | "POST",
  path: string,
  opts?: { body?: any; headers?: Record<string, string> },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  (globalThis as any).__betaPromoTestDb = ctx.db;
  vi.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(null);

  // promo + beta both need the schema. createTestDb already creates
  // the tables, but beta_signups + promo_codes + promo_redemptions
  // exist in the test schema mirror.

  await stopServer();
  await startServer(createApp());
});

afterAll(async () => {
  await stopServer();
  ctx?.raw.close();
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/beta — beta-tester signup
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/beta — input validation", () => {
  it("rejects 400 when name is missing", async () => {
    const r = await request("POST", "/api/beta", {
      body: { email: "alice@example.com" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Name and email are required");
  });

  it("rejects 400 when email is missing", async () => {
    const r = await request("POST", "/api/beta", {
      body: { name: "Alice" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Name and email are required");
  });

  it("rejects 400 when name is whitespace-only (.trim() check)", async () => {
    const r = await request("POST", "/api/beta", {
      body: { name: "   ", email: "alice@example.com" },
    });
    expect(r.status).toBe(400);
  });

  it("rejects 400 when email is whitespace-only", async () => {
    const r = await request("POST", "/api/beta", {
      body: { name: "Alice", email: "   " },
    });
    expect(r.status).toBe(400);
  });

  it("rejects 400 with 'Invalid email address' on malformed emails", async () => {
    for (const email of ["notanemail", "missing@tld", "@example.com", "spaces in@email.com", "no-at-sign"]) {
      const r = await request("POST", "/api/beta", { body: { name: "x", email } });
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("Invalid email");
    }
  });

  it("accepts valid input and returns success=true", async () => {
    const r = await request("POST", "/api/beta", {
      body: { name: "Alice", email: "alice@example.com" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true });
  });

  it("LOWERCASES the stored email and TRIMS whitespace from name + email", async () => {
    await request("POST", "/api/beta", {
      body: { name: "  Alice  ", email: "  ALICE@Example.COM  ", useCase: "  building stuff  " },
    });

    const rows = ctx.raw.prepare("SELECT * FROM beta_signups").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("alice@example.com");
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].use_case).toBe("building stuff");
  });

  it("stores null for missing optional fields (useCase, experience)", async () => {
    await request("POST", "/api/beta", {
      body: { name: "Bob", email: "bob@example.com" },
    });

    const rows = ctx.raw.prepare("SELECT * FROM beta_signups").all() as any[];
    expect(rows[0].experience).toBeNull();
    expect(rows[0].use_case).toBeNull();
  });

  it("preserves experience field when provided", async () => {
    await request("POST", "/api/beta", {
      body: { name: "Bob", email: "b@b.com", experience: "10y backend" },
    });

    const rows = ctx.raw.prepare("SELECT * FROM beta_signups").all() as any[];
    expect(rows[0].experience).toBe("10y backend");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/promo/validate — discount code validation
// ════════════════════════════════════════════════════════════════════════════

function seedPromo(overrides: Partial<any> = {}) {
  const code = overrides.code ?? "WELCOME10";
  const row = {
    id: overrides.id ?? "promo-1",
    code,
    discount_type: overrides.discount_type ?? "percent",
    discount_amount: overrides.discount_amount ?? 10,
    active: overrides.active ?? 1,
    max_uses: overrides.max_uses ?? null,
    current_uses: overrides.current_uses ?? 0,
    max_uses_per_user: overrides.max_uses_per_user ?? 1,
    expires_at: overrides.expires_at ?? null,
  };
  // Use a flexible insert that handles missing columns gracefully
  // (the test schema may not have every promo_codes column).
  try {
    ctx.raw
      .prepare(
        `INSERT INTO promo_codes (id, code, discount_type, discount_amount, active, max_uses, current_uses, max_uses_per_user, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id, row.code, row.discount_type, row.discount_amount,
        row.active, row.max_uses, row.current_uses, row.max_uses_per_user,
        row.expires_at,
      );
  } catch (err) {
    // If promo_codes isn't in the test schema mirror, surface a clear message.
    console.warn("[promo-test] promo_codes table missing from test schema:", (err as Error).message);
    throw err;
  }
  return row;
}

describe("POST /api/promo/validate — input validation", () => {
  it("rejects empty code with valid:false + 'required' message", async () => {
    const r = await request("POST", "/api/promo/validate", { body: { code: "" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ valid: false, message: expect.stringContaining("required") });
  });

  it("rejects whitespace-only code (.trim().length check)", async () => {
    const r = await request("POST", "/api/promo/validate", { body: { code: "   " } });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
  });

  it("rejects non-string code (number, null, etc.)", async () => {
    const r = await request("POST", "/api/promo/validate", { body: { code: 12345 } });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
  });

  it("rejects missing code field", async () => {
    const r = await request("POST", "/api/promo/validate", { body: {} });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
  });
});

describe("POST /api/promo/validate — code lookup", () => {
  it("returns 'Invalid promo code' when code does not exist", async () => {
    const r = await request("POST", "/api/promo/validate", { body: { code: "GHOST" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ valid: false, message: expect.stringContaining("Invalid promo code") });
  });

  it("UPPERCASES the input code before DB lookup (so 'welcome10' matches 'WELCOME10')", async () => {
    seedPromo({ code: "WELCOME10" });
    const r = await request("POST", "/api/promo/validate", { body: { code: "welcome10" } });
    expect(r.body).toMatchObject({ valid: true, discountType: "percent", discountAmount: 10 });
  });

  it("TRIMS whitespace from the input code before lookup", async () => {
    seedPromo({ code: "WELCOME10" });
    const r = await request("POST", "/api/promo/validate", { body: { code: "  welcome10  " } });
    expect(r.body.valid).toBe(true);
  });

  it("does NOT match an inactive promo code (active=0)", async () => {
    seedPromo({ code: "DISABLED", active: 0 });
    const r = await request("POST", "/api/promo/validate", { body: { code: "DISABLED" } });
    expect(r.body).toMatchObject({ valid: false, message: expect.stringContaining("Invalid") });
  });
});

describe("POST /api/promo/validate — expiration + usage caps", () => {
  it("rejects 'expired' message for a promo with expires_at in the past", async () => {
    seedPromo({ code: "OLDPROMO", expires_at: "2020-01-01T00:00:00.000Z" });
    const r = await request("POST", "/api/promo/validate", { body: { code: "OLDPROMO" } });
    expect(r.body).toMatchObject({ valid: false, message: expect.stringContaining("expired") });
  });

  it("accepts a promo with expires_at in the future", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    seedPromo({ code: "VALID", expires_at: future });
    const r = await request("POST", "/api/promo/validate", { body: { code: "VALID" } });
    expect(r.body.valid).toBe(true);
  });

  it("accepts a promo with no expires_at (null = never expires)", async () => {
    seedPromo({ code: "FOREVER", expires_at: null });
    const r = await request("POST", "/api/promo/validate", { body: { code: "FOREVER" } });
    expect(r.body.valid).toBe(true);
  });

  it("rejects 'usage limit' when current_uses >= max_uses", async () => {
    seedPromo({ code: "MAXED", max_uses: 100, current_uses: 100 });
    const r = await request("POST", "/api/promo/validate", { body: { code: "MAXED" } });
    expect(r.body).toMatchObject({ valid: false, message: expect.stringContaining("usage limit") });
  });

  it("accepts a promo with max_uses=null (unlimited usage)", async () => {
    seedPromo({ code: "UNLIM", max_uses: null, current_uses: 9999 });
    const r = await request("POST", "/api/promo/validate", { body: { code: "UNLIM" } });
    expect(r.body.valid).toBe(true);
  });
});

describe("POST /api/promo/validate — success response shape", () => {
  it("returns valid:true + discountType + discountAmount on a clean validation", async () => {
    seedPromo({ code: "GETSAVED", discount_type: "fixed", discount_amount: 500 });

    const r = await request("POST", "/api/promo/validate", { body: { code: "GETSAVED" } });

    expect(r.body).toEqual({
      valid: true,
      discountType: "fixed",
      discountAmount: 500,
    });
  });
});
