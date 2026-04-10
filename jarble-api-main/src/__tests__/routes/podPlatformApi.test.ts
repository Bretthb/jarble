/**
 * Tests for the Jarble-OpenClaw Bridge pod API platform routes:
 *   POST /api/pod/platform/register-agent
 *   GET  /api/pod/platform/team
 *   POST /api/pod/platform/log-action
 *
 * Uses in-memory SQLite via better-sqlite3, mocking the module-level `db` import
 * so that podApi.ts route handlers operate on the test database.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

// ── Shared mutable DB reference ─────────────────────────────────────────────
// podApi.ts imports `db` at module level. We mock db/index.js to expose a proxy
// object whose methods delegate to `currentDb`, which we swap per-test.
// The proxy must be created INSIDE the vi.mock factory because vi.mock is hoisted.

/** Set this before each test to point at the current test SQLite db. */
let currentDb: any = null;

vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const ref = (globalThis as any).__podTestDb;
        if (!ref) throw new Error("Test DB not initialized — set (globalThis as any).__podTestDb");
        return ref[prop];
      },
    },
  );
  return {
    db: proxy,
    tables: schema,
    dbDate: (date: Date = new Date()) => date.toISOString(),
    getRowsAffected: (result: any) => {
      if (result?.rowCount != null) return result.rowCount;
      if (result?.rowsAffected != null) return result.rowsAffected;
      if (result?.changes != null) return result.changes;
      return 0;
    },
  };
});

vi.mock("../../k8s/client.js", () => ({ coreApi: null }));
vi.mock("../../k8s/constants.js", () => ({ NAMESPACE: "jarble" }));
vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: vi.fn((v: string) => `enc_${v}`),
  decryptApiKey: vi.fn((v: string) => v.replace("enc_", "")),
}));
vi.mock("../../utils/hmac.js", () => ({
  generateSigningSecret: vi.fn(() => "test-signing-secret"),
}));
vi.mock("../../services/serviceHandshake.js", () => ({
  performInstallHandshake: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("../../utils/safeAsync.js", () => ({
  safeFireAndForget: vi.fn((fn: any) => fn?.()),
}));
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../utils/env.js", () => ({
  env: {
    DB_PROVIDER: "postgres",
    NODE_ENV: "test",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
  },
}));
vi.mock("@jarble/component-manifest", () => ({
  validateThemeConfig: vi.fn(() => ({ valid: true })),
}));
vi.mock("../../trpc/routers/deploymentSecrets.js", () => ({
  RESERVED_ENV_VARS: new Set(["LLM_API_KEY"]),
}));

// ── Express app setup ───────────────────────────────────────────────────────
import express from "express";
import { podApiRouter, authenticatePod } from "../../routes/podApi.js";

function createApp() {
  const app = express();
  app.use(express.json());
  // Mount the pod API under the same prefix as production
  app.use("/api/pod", podApiRouter);
  return app;
}

// ── Lightweight request helper (no supertest dependency) ────────────────────
import { createServer, type Server } from "http";
import { type AddressInfo } from "net";

let server: Server;
let baseUrl: string;

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
) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// ── Test context ────────────────────────────────────────────────────────────
let ctx: TestDbContext;
const DEPLOYMENT_ID = "dep-pod-test-001";
const GATEWAY_TOKEN = "test-gateway-token-abc123";

function seedDeployment(id = DEPLOYMENT_ID, userId?: string) {
  ctx.raw
    .prepare(
      `INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId || ctx.testUserId, "Test Bot", "openclaw", 1, "running", "byok", "openrouter", "kubero");
}

/** Standard auth headers for pod requests */
const authHeaders = {
  "X-Deployment-Id": DEPLOYMENT_ID,
  "X-Gateway-Token": GATEWAY_TOKEN,
};

// ── Lifecycle ───────────────────────────────────────────────────────────────
beforeEach(async () => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  currentDb = ctx.db;
  (globalThis as any).__podTestDb = ctx.db;
  vi.clearAllMocks();

  // Seed a deployment for auth to pass
  seedDeployment();

  const app = createApp();
  await stopServer();
  await startServer(app);
});

afterAll(async () => {
  await stopServer();
  ctx?.raw.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/pod/platform/register-agent
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/pod/platform/register-agent", () => {
  it("creates a new subagent with valid name/slug/description", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: {
        name: "Research Assistant",
        slug: "research-assistant",
        description: "Performs deep research",
        systemPrompt: "You are a research assistant.",
        model: "claude-3-opus",
      },
    });

    expect(res.status).toBe(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).agentId).toBeDefined();

    // Verify it was actually inserted
    const row = ctx.raw
      .prepare("SELECT * FROM deployment_subagents WHERE deployment_id = ? AND slug = ?")
      .get(DEPLOYMENT_ID, "research-assistant") as any;
    expect(row).toBeTruthy();
    expect(row.name).toBe("Research Assistant");
    expect(row.description).toBe("Performs deep research");
    expect(row.source).toBe("delegation");
  });

  it("upserts: calling twice with same slug updates instead of duplicating", async () => {
    // First call
    const res1 = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: {
        name: "Writer v1",
        slug: "writer",
        description: "Original writer",
        systemPrompt: "You write.",
      },
    });
    expect(res1.status).toBe(200);

    // Second call with same slug but different name/description
    const res2 = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: {
        name: "Writer v2",
        slug: "writer",
        description: "Updated writer",
        systemPrompt: "You write better.",
      },
    });
    expect(res2.status).toBe(200);

    // Should be exactly one row, not two
    const rows = ctx.raw
      .prepare("SELECT * FROM deployment_subagents WHERE deployment_id = ? AND slug = ?")
      .all(DEPLOYMENT_ID, "writer") as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Writer v2");
    expect(rows[0].description).toBe("Updated writer");
  });

  it("rejects slug starting with a digit", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: { name: "Bad Agent", slug: "1-bad-slug", systemPrompt: "nope" },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/Invalid slug/);
  });

  it("rejects slug that is too long (over 64 chars)", async () => {
    const longSlug = "a" + "b".repeat(64); // 65 chars total
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: { name: "Long Agent", slug: longSlug, systemPrompt: "nope" },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/Invalid slug/);
  });

  it("rejects slug with special characters", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: { name: "Special Agent", slug: "my_agent!", systemPrompt: "nope" },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/Invalid slug/);
  });

  it("rejects missing name", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: authHeaders,
      body: { slug: "valid-slug", systemPrompt: "ok" },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/name/i);
  });

  it("rejects request without gateway token (auth failure)", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: { "X-Deployment-Id": DEPLOYMENT_ID },
      body: { name: "Agent", slug: "agent", systemPrompt: "ok" },
    });
    expect(res.status).toBe(401);
    expect((res.body as any).error).toMatch(/Missing/);
  });

  it("rejects request without deployment ID (auth failure)", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: { "X-Gateway-Token": GATEWAY_TOKEN },
      body: { name: "Agent", slug: "agent", systemPrompt: "ok" },
    });
    expect(res.status).toBe(401);
    expect((res.body as any).error).toMatch(/Missing/);
  });

  it("rejects request for non-existent deployment", async () => {
    const res = await request("POST", "/api/pod/platform/register-agent", {
      headers: {
        "X-Deployment-Id": "non-existent-deployment",
        "X-Gateway-Token": GATEWAY_TOKEN,
      },
      body: { name: "Agent", slug: "agent", systemPrompt: "ok" },
    });
    expect(res.status).toBe(401);
    expect((res.body as any).error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/pod/platform/team
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/pod/platform/team", () => {
  it("returns empty team when deployment has no flow membership", async () => {
    const res = await request("GET", "/api/pod/platform/team", {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    expect((res.body as any).teamName).toBeNull();
    expect((res.body as any).role).toBeNull();
    expect((res.body as any).members).toEqual([]);
    expect((res.body as any).edges).toEqual([]);
  });

  it("returns correct members when deployment is in a flow", async () => {
    // Seed a second deployment
    const dep2Id = "dep-teammate-002";
    seedDeployment(dep2Id);

    // Create a flow
    const flowId = "flow-test-001";
    const definition = JSON.stringify({
      nodes: [
        {
          id: "node-1",
          type: "deployment",
          data: { deploymentId: DEPLOYMENT_ID, label: "Lead Bot" },
          position: { x: 0, y: 0 },
        },
        {
          id: "node-2",
          type: "deployment",
          data: { deploymentId: dep2Id, label: "Helper Bot", role: "assistant" },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { id: "e1-2", source: "node-1", target: "node-2", type: "default" },
      ],
    });

    ctx.raw
      .prepare(
        `INSERT INTO orchestration_flows (id, user_id, name, description, definition, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(flowId, ctx.testUserId, "Test Team", "A test team", definition, "active");

    // Add flow memberships
    ctx.raw
      .prepare(
        `INSERT INTO flow_deployment_memberships (id, flow_id, deployment_id, node_id, role, is_entry_point)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("fdm-1", flowId, DEPLOYMENT_ID, "node-1", "leader", 1);

    ctx.raw
      .prepare(
        `INSERT INTO flow_deployment_memberships (id, flow_id, deployment_id, node_id, role, is_entry_point)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("fdm-2", flowId, dep2Id, "node-2", "assistant", 0);

    const res = await request("GET", "/api/pod/platform/team", {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    expect((res.body as any).teamName).toBe("Test Team");
    expect((res.body as any).role).toBe("leader");
    expect((res.body as any).members).toHaveLength(2);

    // Verify member details
    const leadMember = (res.body as any).members.find(
      (m: any) => m.deploymentId === DEPLOYMENT_ID,
    );
    expect(leadMember).toBeTruthy();
    expect(leadMember.name).toBe("Test Bot");
    expect(leadMember.status).toBe("running");

    const helperMember = (res.body as any).members.find(
      (m: any) => m.deploymentId === dep2Id,
    );
    expect(helperMember).toBeTruthy();
    expect(helperMember.role).toBe("assistant");

    // Verify edges
    expect((res.body as any).edges).toHaveLength(1);
    expect((res.body as any).edges[0]).toEqual({
      from: "node-1",
      to: "node-2",
      type: "default",
    });
  });

  it("handles flow with malformed definition JSON gracefully", async () => {
    const flowId = "flow-bad-json";
    ctx.raw
      .prepare(
        `INSERT INTO orchestration_flows (id, user_id, name, description, definition, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(flowId, ctx.testUserId, "Bad Flow", "Broken", "NOT VALID JSON", "active");

    ctx.raw
      .prepare(
        `INSERT INTO flow_deployment_memberships (id, flow_id, deployment_id, node_id, role, is_entry_point)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("fdm-bad", flowId, DEPLOYMENT_ID, "node-x", null, 0);

    const res = await request("GET", "/api/pod/platform/team", {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    // Should degrade gracefully with empty members/edges
    expect((res.body as any).teamName).toBe("Bad Flow");
    expect((res.body as any).members).toEqual([]);
    expect((res.body as any).edges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/pod/platform/log-action
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/pod/platform/log-action", () => {
  it("creates an agent_calls row with kind=bot_action", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: {
        action: "search_web",
        details: "Searched for 'vitest testing'",
        status: "completed",
      },
    });

    expect(res.status).toBe(200);
    expect((res.body as any).success).toBe(true);

    // Verify the row in agent_calls
    const row = ctx.raw
      .prepare("SELECT * FROM agent_calls WHERE caller_deployment_id = ? AND kind = 'bot_action'")
      .get(DEPLOYMENT_ID) as any;
    expect(row).toBeTruthy();
    expect(row.skill_name).toBe("search_web");
    expect(row.request_body).toBe("Searched for 'vitest testing'");
    expect(row.status).toBe("completed");
    expect(row.credits_charged).toBe(0);
    expect(row.callee_deployment_id).toBe(DEPLOYMENT_ID); // self-action
  });

  it("rejects missing action", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { details: "some details" },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/action/i);
  });

  it("rejects empty string action", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: "   " },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toMatch(/empty/i);
  });

  it("truncates action over 100 chars", async () => {
    const longAction = "a".repeat(150);
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: longAction },
    });
    expect(res.status).toBe(200);

    const row = ctx.raw
      .prepare("SELECT skill_name FROM agent_calls WHERE caller_deployment_id = ? AND kind = 'bot_action'")
      .get(DEPLOYMENT_ID) as any;
    expect(row.skill_name).toHaveLength(100);
  });

  it("truncates details over 10KB", async () => {
    const bigDetails = "x".repeat(15_000);
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: "big-action", details: bigDetails },
    });
    expect(res.status).toBe(200);

    const row = ctx.raw
      .prepare("SELECT request_body FROM agent_calls WHERE caller_deployment_id = ? AND kind = 'bot_action'")
      .get(DEPLOYMENT_ID) as any;
    // 10000 chars + "... [truncated]" suffix
    expect(row.request_body.length).toBeLessThanOrEqual(10_000 + 20);
    expect(row.request_body).toContain("[truncated]");
  });

  it("accepts object details and JSON-stringifies them", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: "parsed-action", details: { key: "value", count: 42 } },
    });
    expect(res.status).toBe(200);

    const row = ctx.raw
      .prepare("SELECT request_body FROM agent_calls WHERE caller_deployment_id = ? AND skill_name = 'parsed-action'")
      .get(DEPLOYMENT_ID) as any;
    expect(JSON.parse(row.request_body)).toEqual({ key: "value", count: 42 });
  });

  it("defaults status to 'completed' when not provided", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: "default-status" },
    });
    expect(res.status).toBe(200);

    const row = ctx.raw
      .prepare("SELECT status FROM agent_calls WHERE caller_deployment_id = ? AND skill_name = 'default-status'")
      .get(DEPLOYMENT_ID) as any;
    expect(row.status).toBe("completed");
  });

  it("accepts custom status value", async () => {
    const res = await request("POST", "/api/pod/platform/log-action", {
      headers: authHeaders,
      body: { action: "custom-status", status: "failed" },
    });
    expect(res.status).toBe(200);

    const row = ctx.raw
      .prepare("SELECT status FROM agent_calls WHERE caller_deployment_id = ? AND skill_name = 'custom-status'")
      .get(DEPLOYMENT_ID) as any;
    expect(row.status).toBe("failed");
  });
});
