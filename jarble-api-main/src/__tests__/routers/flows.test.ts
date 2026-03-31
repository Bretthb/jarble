/**
 * Integration tests for the flows tRPC router.
 *
 * Tests CRUD operations, forking, and execution listing for orchestration flows.
 * Uses real in-memory SQLite with the db/index.js module mocked to use the test DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema.sqlite.js";

// ── Test DB (inline pattern - mirrors stripe.test.ts) ────────────────────────

// Reuse the full CREATE_TABLES_SQL from testDb helper
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";

let ctx: TestDbContext;

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    DB_PROVIDER: "sqlite",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_MANAGEMENT_KEY: undefined,
    API_KEY_ENCRYPTION_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));

// Mock db/index.js to use our test DB (getter so beforeEach can swap it)
vi.mock("../../db/index.js", () => ({
  get db() {
    return ctx.db;
  },
  tables: sqliteSchema,
  dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
}));

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: vi.fn().mockReturnValue(false),
  getSubscriptionDetails: vi.fn(),
  listInvoices: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({
    baseCents: 0,
    managedKeyCents: 0,
    totalCents: 0,
  }),
}));

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi
    .fn()
    .mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi
    .fn()
    .mockResolvedValue({ logs: "", podName: null }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
  syncMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi
    .fn()
    .mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

// Import appRouter AFTER mocks are set up (vi.mock is hoisted)
import { appRouter } from "../../trpc/index.js";
import type { Context } from "../../trpc/context.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: "test-user-001",
  email: "test@jarble.ai",
  name: "Test User",
  auth0Id: "auth0|test-integration-001",
  emailVerified: true,
  freeDeploymentUsed: false,
};

const VALID_DEFINITION = {
  nodes: [
    {
      id: "n1",
      type: "deployment" as const,
      label: "Step 1",
      position: { x: 0, y: 0 },
      serviceId: "svc_test",
    },
    {
      id: "n2",
      type: "output" as const,
      label: "Output",
      position: { x: 200, y: 0 },
    },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

function makeCaller(user: any = TEST_USER) {
  const c: Context = {
    user: user as any,
    db: ctx.db as any,
    requestId: "test-request",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

function makeAnonCaller() {
  const c: Context = {
    user: null,
    db: ctx.db as any,
    requestId: "test-request",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => {
  if (ctx) ctx.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("flows router", () => {
  // ── create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a flow and returns its id", async () => {
      const result = await makeCaller().flows.create({
        name: "Test Flow",
        definition: VALID_DEFINITION,
      });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^flw_/);
    });

    it("stores the flow in the database with correct fields", async () => {
      const result = await makeCaller().flows.create({
        name: "My Flow",
        description: "A description",
        definition: VALID_DEFINITION,
        status: "published",
      });

      const flow = await makeCaller().flows.getById({ id: result.id });
      expect(flow.name).toBe("My Flow");
      expect(flow.description).toBe("A description");
      expect(flow.status).toBe("published");
      expect(JSON.parse(flow.definition as string)).toEqual(VALID_DEFINITION);
    });

    it("rejects invalid definition (missing nodes array)", async () => {
      await expect(
        makeCaller().flows.create({
          name: "Bad Flow",
          definition: { edges: [] } as any,
        })
      ).rejects.toThrow();
    });

    it("rejects empty name", async () => {
      await expect(
        makeCaller().flows.create({
          name: "",
          definition: VALID_DEFINITION,
        })
      ).rejects.toThrow();
    });

    it("defaults status to draft", async () => {
      const result = await makeCaller().flows.create({
        name: "Draft Flow",
        definition: VALID_DEFINITION,
      });

      const flow = await makeCaller().flows.getById({ id: result.id });
      expect(flow.status).toBe("draft");
    });
  });

  // ── list ────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns only the current user's flows", async () => {
      await makeCaller().flows.create({
        name: "User Flow",
        definition: VALID_DEFINITION,
      });

      // Create another user and their flow directly in DB
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user', 'other@test.com', 'Other', 'auth0|other', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_other', 'other-user', 'Other Flow', '${JSON.stringify(VALID_DEFINITION)}', 'draft', 0, 0, datetime('now'), datetime('now'));
      `);

      const flows = await makeCaller().flows.list();
      expect(flows.length).toBe(1);
      expect(flows[0].name).toBe("User Flow");
    });

    it("supports status filter", async () => {
      await makeCaller().flows.create({
        name: "Draft",
        definition: VALID_DEFINITION,
        status: "draft",
      });
      await makeCaller().flows.create({
        name: "Published",
        definition: VALID_DEFINITION,
        status: "published",
      });

      const drafts = await makeCaller().flows.list({ status: "draft" });
      expect(drafts.length).toBe(1);
      expect(drafts[0].name).toBe("Draft");

      const published = await makeCaller().flows.list({ status: "published" });
      expect(published.length).toBe(1);
      expect(published[0].name).toBe("Published");
    });

    it("supports pagination with limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await makeCaller().flows.create({
          name: `Flow ${i}`,
          definition: VALID_DEFINITION,
        });
      }

      const page1 = await makeCaller().flows.list({ limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = await makeCaller().flows.list({ limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      const page3 = await makeCaller().flows.list({ limit: 2, offset: 4 });
      expect(page3.length).toBe(1);
    });

    it("returns empty array when no flows exist", async () => {
      const flows = await makeCaller().flows.list();
      expect(flows).toEqual([]);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns flow with executions array", async () => {
      const { id } = await makeCaller().flows.create({
        name: "Get Test",
        definition: VALID_DEFINITION,
      });

      const flow = await makeCaller().flows.getById({ id });
      expect(flow.id).toBe(id);
      expect(flow.name).toBe("Get Test");
      expect(flow.executions).toEqual([]);
    });

    it("throws NOT_FOUND for nonexistent flow", async () => {
      await expect(
        makeCaller().flows.getById({ id: "flw_nonexistent" })
      ).rejects.toThrow(/not found/i);
    });

    it("throws NOT_FOUND for another user's flow", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user-2', 'other2@test.com', 'Other', 'auth0|other2', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_private', 'other-user-2', 'Private', '${JSON.stringify(VALID_DEFINITION)}', 'draft', 0, 0, datetime('now'), datetime('now'));
      `);

      await expect(
        makeCaller().flows.getById({ id: "flw_private" })
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates name and description", async () => {
      const { id } = await makeCaller().flows.create({
        name: "Original",
        definition: VALID_DEFINITION,
      });

      await makeCaller().flows.update({
        id,
        name: "Updated",
        description: "New description",
      });

      const flow = await makeCaller().flows.getById({ id });
      expect(flow.name).toBe("Updated");
      expect(flow.description).toBe("New description");
    });

    it("supports partial update (only status)", async () => {
      const { id } = await makeCaller().flows.create({
        name: "Partial",
        definition: VALID_DEFINITION,
      });

      await makeCaller().flows.update({ id, status: "published" });

      const flow = await makeCaller().flows.getById({ id });
      expect(flow.name).toBe("Partial"); // unchanged
      expect(flow.status).toBe("published");
    });

    it("throws NOT_FOUND for another user's flow (ownership check)", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user-3', 'other3@test.com', 'Other', 'auth0|other3', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_other3', 'other-user-3', 'Not Mine', '${JSON.stringify(VALID_DEFINITION)}', 'draft', 0, 0, datetime('now'), datetime('now'));
      `);

      await expect(
        makeCaller().flows.update({ id: "flw_other3", name: "Hacked" })
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("soft deletes (archives) by default", async () => {
      const { id } = await makeCaller().flows.create({
        name: "To Archive",
        definition: VALID_DEFINITION,
      });

      await makeCaller().flows.delete({ id });

      const flow = await makeCaller().flows.getById({ id });
      expect(flow.status).toBe("archived");
    });

    it("hard deletes when hard=true", async () => {
      const { id } = await makeCaller().flows.create({
        name: "To Delete",
        definition: VALID_DEFINITION,
      });

      await makeCaller().flows.delete({ id, hard: true });

      await expect(
        makeCaller().flows.getById({ id })
      ).rejects.toThrow(/not found/i);
    });

    it("throws NOT_FOUND for nonexistent flow", async () => {
      await expect(
        makeCaller().flows.delete({ id: "flw_ghost" })
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── duplicate ───────────────────────────────────────────────────────────

  describe("duplicate", () => {
    it("creates a copy with forkedFromId set", async () => {
      const { id: sourceId } = await makeCaller().flows.create({
        name: "Original",
        definition: VALID_DEFINITION,
      });

      const { id: forkId } = await makeCaller().flows.duplicate({
        sourceFlowId: sourceId,
      });

      expect(forkId).toMatch(/^flw_/);
      expect(forkId).not.toBe(sourceId);

      const fork = await makeCaller().flows.getById({ id: forkId });
      expect(fork.name).toBe("Original (copy)");
      expect(fork.status).toBe("draft");
      expect(fork.forkedFromId).toBe(sourceId);
    });

    it("uses custom name when provided", async () => {
      const { id: sourceId } = await makeCaller().flows.create({
        name: "Source",
        definition: VALID_DEFINITION,
      });

      const { id: forkId } = await makeCaller().flows.duplicate({
        sourceFlowId: sourceId,
        name: "My Custom Fork",
      });

      const fork = await makeCaller().flows.getById({ id: forkId });
      expect(fork.name).toBe("My Custom Fork");
    });

    it("increments forkCount on the source flow", async () => {
      const { id: sourceId } = await makeCaller().flows.create({
        name: "Forkable",
        definition: VALID_DEFINITION,
      });

      await makeCaller().flows.duplicate({ sourceFlowId: sourceId });
      await makeCaller().flows.duplicate({ sourceFlowId: sourceId });

      const source = await makeCaller().flows.getById({ id: sourceId });
      expect(source.forkCount).toBe(2);
    });

    it("throws NOT_FOUND for nonexistent source", async () => {
      await expect(
        makeCaller().flows.duplicate({ sourceFlowId: "flw_ghost" })
      ).rejects.toThrow(/not found/i);
    });

    it("throws FORBIDDEN for private flow of another user", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user-4', 'other4@test.com', 'Other', 'auth0|other4', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_priv4', 'other-user-4', 'Private', '${JSON.stringify(VALID_DEFINITION)}', 'draft', 0, 0, datetime('now'), datetime('now'));
      `);

      await expect(
        makeCaller().flows.duplicate({ sourceFlowId: "flw_priv4" })
      ).rejects.toThrow(/private flow/i);
    });

    it("allows forking a public flow from another user", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user-5', 'other5@test.com', 'Other', 'auth0|other5', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_pub5', 'other-user-5', 'Public Flow', '${JSON.stringify(VALID_DEFINITION)}', 'published', 1, 0, datetime('now'), datetime('now'));
      `);

      const { id } = await makeCaller().flows.duplicate({
        sourceFlowId: "flw_pub5",
      });
      expect(id).toMatch(/^flw_/);
    });
  });

  // ── listExecutions ──────────────────────────────────────────────────────

  describe("listExecutions", () => {
    it("returns executions for a flow", async () => {
      const { id: flowId } = await makeCaller().flows.create({
        name: "Exec Flow",
        definition: VALID_DEFINITION,
      });

      // Insert test executions
      ctx.raw.exec(`
        INSERT INTO flow_executions (id, flow_id, user_id, status, total_credits_charged, created_at)
        VALUES
          ('fex_1', '${flowId}', '${TEST_USER.id}', 'completed', 5, datetime('now')),
          ('fex_2', '${flowId}', '${TEST_USER.id}', 'failed', 0, datetime('now'));
      `);

      const executions = await makeCaller().flows.listExecutions({ flowId });
      expect(executions.length).toBe(2);
    });

    it("throws NOT_FOUND for another user's flow", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
        VALUES ('other-user-6', 'other6@test.com', 'Other', 'auth0|other6', 1, 0);
      `);
      ctx.raw.exec(`
        INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
        VALUES ('flw_other6', 'other-user-6', 'Not Mine', '${JSON.stringify(VALID_DEFINITION)}', 'draft', 0, 0, datetime('now'), datetime('now'));
      `);

      await expect(
        makeCaller().flows.listExecutions({ flowId: "flw_other6" })
      ).rejects.toThrow(/not found/i);
    });

    it("returns empty array when no executions exist", async () => {
      const { id: flowId } = await makeCaller().flows.create({
        name: "Empty",
        definition: VALID_DEFINITION,
      });

      const executions = await makeCaller().flows.listExecutions({ flowId });
      expect(executions).toEqual([]);
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────

  describe("auth", () => {
    it("rejects unauthenticated calls", async () => {
      await expect(makeAnonCaller().flows.list()).rejects.toThrow();
    });
  });
});
