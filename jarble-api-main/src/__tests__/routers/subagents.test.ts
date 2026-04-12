/**
 * Integration tests for the subagents tRPC router.
 *
 * Tests list, getById, create, update, delete, reorder, fork,
 * togglePublic, and listPublic procedures.
 * Uses real in-memory SQLite with seeded deployment data.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "", podName: null }),
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

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: vi.fn().mockReturnValue(false),
  getSubscriptionDetails: vi.fn(),
  listInvoices: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({ baseCents: 0, managedKeyCents: 0, totalCents: 0 }),
  findManagedKeyItem: vi.fn().mockResolvedValue(null),
  updateManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  removeManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
  addManagedKeyLineItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    DB_PROVIDER: "postgres",
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

// Mock db/index.js to prevent Postgres connection at import time.
// Tests pass the in-memory SQLite db through the tRPC caller context.
vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return {
    db: {},
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

// ── Setup ────────────────────────────────────────────────────────────────────
let ctx: TestDbContext;
const DEPLOYMENT_ID = "dep-subagent-001";

function seedData() {
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
    VALUES ('${DEPLOYMENT_ID}', '${ctx.testUserId}', 'Subagent Bot', 'openclaw', ${ctx.openclawCatalogId}, 'running');
  `);
}

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  seedData();
});

afterAll(() => {
  if (ctx) ctx.raw.close();
});

function caller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

function anonCaller() {
  return createAnonymousCaller(ctx.db);
}

/** Helper to create a subagent with sensible defaults. */
async function createSubagent(overrides?: Partial<{
  name: string;
  systemPrompt: string;
  description: string;
  deploymentId: string;
}>) {
  return caller().subagents.create({
    deploymentId: overrides?.deploymentId ?? DEPLOYMENT_ID,
    name: overrides?.name ?? "Test Agent",
    systemPrompt: overrides?.systemPrompt ?? "You are a test agent.",
    description: overrides?.description,
  });
}

/** Create a second user and their caller for ownership tests. */
function createOtherUser() {
  ctx.raw.exec(`
    INSERT OR IGNORE INTO users (id, email, name, auth0_id, email_verified)
    VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
  `);
  return createTestCaller(ctx.db, {
    id: "other-user",
    email: "other@jarble.ai",
    name: "Other",
    auth0Id: "auth0|other",
    emailVerified: true,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("subagents router", () => {
  // ── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("should return empty array for deployment with no subagents", async () => {
      const result = await caller().subagents.list({ deploymentId: DEPLOYMENT_ID });
      expect(result).toEqual([]);
    });

    it("should return subagents ordered by sortOrder", async () => {
      await createSubagent({ name: "Alpha Agent" });
      await createSubagent({ name: "Beta Agent" });
      await createSubagent({ name: "Gamma Agent" });

      const result = await caller().subagents.list({ deploymentId: DEPLOYMENT_ID });
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Alpha Agent");
      expect(result[1].name).toBe("Beta Agent");
      expect(result[2].name).toBe("Gamma Agent");
      expect(result[0].sortOrder).toBe(0);
      expect(result[1].sortOrder).toBe(1);
      expect(result[2].sortOrder).toBe(2);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().subagents.list({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow();
    });

    it("should reject listing for non-owned deployment", async () => {
      const other = createOtherUser();
      await expect(
        other.subagents.list({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── getById ──────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("should return a single subagent by ID", async () => {
      const { id } = await createSubagent({ name: "Lookup Agent" });
      const result = await caller().subagents.getById({ id });

      expect(result.id).toBe(id);
      expect(result.name).toBe("Lookup Agent");
      expect(result.systemPrompt).toBe("You are a test agent.");
    });

    it("should throw NOT_FOUND for non-existent ID", async () => {
      await expect(
        caller().subagents.getById({ id: "nonexistent-id" })
      ).rejects.toThrow("Subagent not found");
    });

    it("should reject if caller does not own parent deployment", async () => {
      const { id } = await createSubagent();
      const other = createOtherUser();

      await expect(
        other.subagents.getById({ id })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("should create subagent with valid input and return id and slug", async () => {
      const result = await createSubagent({ name: "My Cool Agent" });

      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(12);
      expect(result.slug).toBe("my_cool_agent");
    });

    it("should generate correct slug from name", async () => {
      const cases = [
        { name: "Simple", expectedSlug: "simple" },
        { name: "Two Words", expectedSlug: "two_words" },
        { name: "Special!@#Chars$%^", expectedSlug: "special_chars" },
        { name: "  Leading Trailing  ", expectedSlug: "leading_trailing" },
        { name: "UPPERCASE NAME", expectedSlug: "uppercase_name" },
      ];

      for (const { name, expectedSlug } of cases) {
        const result = await createSubagent({ name });
        expect(result.slug).toBe(expectedSlug);
      }
    });

    it("should reject creation on non-owned deployment", async () => {
      const other = createOtherUser();
      await expect(
        other.subagents.create({
          deploymentId: DEPLOYMENT_ID,
          name: "Rogue Agent",
          systemPrompt: "I should not exist.",
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject when 10 subagents already exist", async () => {
      for (let i = 0; i < 10; i++) {
        await createSubagent({ name: `Agent ${i}` });
      }

      await expect(
        createSubagent({ name: "Agent 11" })
      ).rejects.toThrow("Maximum of 10 subagents per deployment");
    });

    it("should reject duplicate slugs within same deployment", async () => {
      await createSubagent({ name: "Duplicate Agent" });

      await expect(
        createSubagent({ name: "Duplicate Agent" })
      ).rejects.toThrow('A subagent with slug "duplicate_agent" already exists on this deployment');
    });

    it("should reject HTML in name", async () => {
      await expect(
        createSubagent({ name: "<script>alert('xss')</script>" })
      ).rejects.toThrow();
    });

    it("should reject empty name", async () => {
      await expect(
        caller().subagents.create({
          deploymentId: DEPLOYMENT_ID,
          name: "",
          systemPrompt: "You are an agent.",
        })
      ).rejects.toThrow();
    });

    it("should reject empty systemPrompt", async () => {
      await expect(
        caller().subagents.create({
          deploymentId: DEPLOYMENT_ID,
          name: "Agent No Prompt",
          systemPrompt: "",
        })
      ).rejects.toThrow();
    });

    it("should store optional fields correctly", async () => {
      const { id } = await caller().subagents.create({
        deploymentId: DEPLOYMENT_ID,
        name: "Full Agent",
        systemPrompt: "You are a full agent.",
        description: "A fully configured agent.",
        model: "gpt-4o",
        triggerType: "auto",
        triggerConfig: '{"pattern": ".*"}',
        tools: '["web_search"]',
        enabled: false,
      });

      const agent = await caller().subagents.getById({ id });
      expect(agent.description).toBe("A fully configured agent.");
      expect(agent.model).toBe("gpt-4o");
      expect(agent.triggerType).toBe("auto");
      expect(agent.triggerConfig).toBe('{"pattern": ".*"}');
      expect(agent.tools).toBe('["web_search"]');
      expect(agent.enabled).toBeFalsy();
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe("update", () => {
    it("should update name and recompute slug", async () => {
      const { id } = await createSubagent({ name: "Original Name" });

      const result = await caller().subagents.update({
        id,
        name: "Updated Name",
      });
      expect(result).toEqual({ success: true });

      const updated = await caller().subagents.getById({ id });
      expect(updated.name).toBe("Updated Name");
      expect(updated.slug).toBe("updated_name");
    });

    it("should update systemPrompt only", async () => {
      const { id, slug } = await createSubagent();

      await caller().subagents.update({
        id,
        systemPrompt: "You are an updated agent.",
      });

      const updated = await caller().subagents.getById({ id });
      expect(updated.systemPrompt).toBe("You are an updated agent.");
      expect(updated.slug).toBe(slug); // slug unchanged
    });

    it("should update enabled flag", async () => {
      const { id } = await createSubagent();

      await caller().subagents.update({ id, enabled: false });

      const updated = await caller().subagents.getById({ id });
      expect(updated.enabled).toBeFalsy();
    });

    it("should reject updating non-existent subagent", async () => {
      await expect(
        caller().subagents.update({ id: "nonexistent-id", name: "Nope" })
      ).rejects.toThrow("Subagent not found");
    });

    it("should reject if caller does not own parent deployment", async () => {
      const { id } = await createSubagent();
      const other = createOtherUser();

      await expect(
        other.subagents.update({ id, name: "Hijacked" })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject slug conflict on rename", async () => {
      await createSubagent({ name: "Agent Alpha" });
      const { id } = await createSubagent({ name: "Agent Beta" });

      await expect(
        caller().subagents.update({ id, name: "Agent Alpha" })
      ).rejects.toThrow('A subagent with slug "agent_alpha" already exists on this deployment');
    });

    it("should allow renaming to the same slug (self)", async () => {
      const { id } = await createSubagent({ name: "Same Name" });

      // Rename to a different casing that produces the same slug
      const result = await caller().subagents.update({ id, name: "SAME NAME" });
      expect(result).toEqual({ success: true });
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("should delete an existing subagent", async () => {
      const { id } = await createSubagent();

      const result = await caller().subagents.delete({ id });
      expect(result).toEqual({ success: true });

      // Verify it no longer appears in list
      const remaining = await caller().subagents.list({ deploymentId: DEPLOYMENT_ID });
      expect(remaining).toHaveLength(0);
    });

    it("should throw NOT_FOUND for non-existent ID", async () => {
      await expect(
        caller().subagents.delete({ id: "nonexistent-id" })
      ).rejects.toThrow("Subagent not found");
    });

    it("should reject if caller does not own parent deployment", async () => {
      const { id } = await createSubagent();
      const other = createOtherUser();

      await expect(
        other.subagents.delete({ id })
      ).rejects.toThrow("Deployment not found");
    });

    it("should only delete the specified subagent", async () => {
      const { id: id1 } = await createSubagent({ name: "Keep Me" });
      const { id: id2 } = await createSubagent({ name: "Delete Me" });

      await caller().subagents.delete({ id: id2 });

      const remaining = await caller().subagents.list({ deploymentId: DEPLOYMENT_ID });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });
  });

  // ── reorder ──────────────────────────────────────────────────────────────

  describe("reorder", () => {
    it("should update sortOrder for all subagents in given order", async () => {
      const { id: id1 } = await createSubagent({ name: "First" });
      const { id: id2 } = await createSubagent({ name: "Second" });
      const { id: id3 } = await createSubagent({ name: "Third" });

      // Reverse the order
      await caller().subagents.reorder({
        deploymentId: DEPLOYMENT_ID,
        orderedIds: [id3, id2, id1],
      });

      const result = await caller().subagents.list({ deploymentId: DEPLOYMENT_ID });
      expect(result[0].id).toBe(id3);
      expect(result[0].sortOrder).toBe(0);
      expect(result[1].id).toBe(id2);
      expect(result[1].sortOrder).toBe(1);
      expect(result[2].id).toBe(id1);
      expect(result[2].sortOrder).toBe(2);
    });

    it("should reject reordering for non-owned deployment", async () => {
      const other = createOtherUser();

      await expect(
        other.subagents.reorder({
          deploymentId: DEPLOYMENT_ID,
          orderedIds: [],
        })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── fork ─────────────────────────────────────────────────────────────────

  describe("fork", () => {
    const OTHER_DEPLOYMENT_ID = "dep-fork-target";

    /** Set up a second user with their own deployment for fork target tests. */
    function setupForkTarget() {
      const other = createOtherUser();
      ctx.raw.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status)
        VALUES ('${OTHER_DEPLOYMENT_ID}', 'other-user', 'Fork Target', 'openclaw', ${ctx.openclawCatalogId}, 'running');
      `);
      return other;
    }

    it("should fork a public subagent to target deployment", async () => {
      // Create a public subagent on the test user's deployment
      const { id: sourceId } = await createSubagent({ name: "Public Agent" });
      await caller().subagents.togglePublic({ id: sourceId, isPublic: true });

      // Fork it to the other user's deployment
      const other = setupForkTarget();
      const forked = await other.subagents.fork({
        sourceSubagentId: sourceId,
        targetDeploymentId: OTHER_DEPLOYMENT_ID,
      });

      expect(forked.id).toBeDefined();
      expect(forked.slug).toBe("public_agent");

      // Verify the forked subagent exists on the target deployment
      const result = await other.subagents.getById({ id: forked.id });
      expect(result.name).toBe("Public Agent");
      expect(result.systemPrompt).toBe("You are a test agent.");
      expect(result.deploymentId).toBe(OTHER_DEPLOYMENT_ID);
      expect(result.forkedFromId).toBe(sourceId);
      expect(result.isPublic).toBeFalsy(); // forked copy is private
    });

    it("should reject forking a non-public subagent", async () => {
      const { id: sourceId } = await createSubagent({ name: "Private Agent" });
      const other = setupForkTarget();

      await expect(
        other.subagents.fork({
          sourceSubagentId: sourceId,
          targetDeploymentId: OTHER_DEPLOYMENT_ID,
        })
      ).rejects.toThrow("Source subagent is not public");
    });

    it("should reject forking to non-owned target deployment", async () => {
      const { id: sourceId } = await createSubagent({ name: "Public Agent" });
      await caller().subagents.togglePublic({ id: sourceId, isPublic: true });

      // Try to fork to someone else's deployment using the original caller
      const other = setupForkTarget();
      await expect(
        caller().subagents.fork({
          sourceSubagentId: sourceId,
          targetDeploymentId: OTHER_DEPLOYMENT_ID,
        })
      ).rejects.toThrow("Deployment not found");
    });

    it("should reject forking a non-existent source subagent", async () => {
      const other = setupForkTarget();

      await expect(
        other.subagents.fork({
          sourceSubagentId: "nonexistent-id",
          targetDeploymentId: OTHER_DEPLOYMENT_ID,
        })
      ).rejects.toThrow("Source subagent not found");
    });

    it("should handle slug conflicts by appending suffix", async () => {
      // Create a public subagent
      const { id: sourceId } = await createSubagent({ name: "Shared Agent" });
      await caller().subagents.togglePublic({ id: sourceId, isPublic: true });

      const other = setupForkTarget();

      // Create an existing subagent on target with the same slug
      await other.subagents.create({
        deploymentId: OTHER_DEPLOYMENT_ID,
        name: "Shared Agent",
        systemPrompt: "Already here.",
      });

      // Fork should create with a suffixed slug
      const forked = await other.subagents.fork({
        sourceSubagentId: sourceId,
        targetDeploymentId: OTHER_DEPLOYMENT_ID,
      });

      expect(forked.slug).toBe("shared_agent_2");
    });

    it("should increment forkCount on source", async () => {
      const { id: sourceId } = await createSubagent({ name: "Popular Agent" });
      await caller().subagents.togglePublic({ id: sourceId, isPublic: true });

      const other = setupForkTarget();

      await other.subagents.fork({
        sourceSubagentId: sourceId,
        targetDeploymentId: OTHER_DEPLOYMENT_ID,
      });

      // Check source forkCount
      const source = await caller().subagents.getById({ id: sourceId });
      expect(source.forkCount).toBe(1);
    });
  });

  // ── togglePublic ─────────────────────────────────────────────────────────

  describe("togglePublic", () => {
    it("should toggle isPublic flag to true", async () => {
      const { id } = await createSubagent();

      const result = await caller().subagents.togglePublic({ id, isPublic: true });
      expect(result).toEqual({ success: true });

      const updated = await caller().subagents.getById({ id });
      expect(updated.isPublic).toBeTruthy();
    });

    it("should toggle isPublic flag back to false", async () => {
      const { id } = await createSubagent();
      await caller().subagents.togglePublic({ id, isPublic: true });

      await caller().subagents.togglePublic({ id, isPublic: false });

      const updated = await caller().subagents.getById({ id });
      expect(updated.isPublic).toBeFalsy();
    });

    it("should reject for non-existent subagent", async () => {
      await expect(
        caller().subagents.togglePublic({ id: "nonexistent-id", isPublic: true })
      ).rejects.toThrow("Subagent not found");
    });

    it("should reject for non-owned deployment", async () => {
      const { id } = await createSubagent();
      const other = createOtherUser();

      await expect(
        other.subagents.togglePublic({ id, isPublic: true })
      ).rejects.toThrow("Deployment not found");
    });
  });

  // ── listPublic ───────────────────────────────────────────────────────────

  describe("listPublic", () => {
    it("should return only public subagents", async () => {
      const { id: publicId } = await createSubagent({ name: "Public One" });
      await createSubagent({ name: "Private One" });
      await caller().subagents.togglePublic({ id: publicId, isPublic: true });

      const result = await caller().subagents.listPublic();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Public One");
    });

    it("should return empty when no subagents are public", async () => {
      await createSubagent({ name: "Private Only" });

      const result = await caller().subagents.listPublic();
      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it("should support pagination with limit and offset", async () => {
      // Create 5 public subagents
      for (let i = 0; i < 5; i++) {
        const { id } = await createSubagent({ name: `Public Agent ${String.fromCharCode(65 + i)}` });
        await caller().subagents.togglePublic({ id, isPublic: true });
      }

      const page1 = await caller().subagents.listPublic({ limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await caller().subagents.listPublic({ limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await caller().subagents.listPublic({ limit: 2, offset: 4 });
      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it("should return hasMore false when exactly at limit", async () => {
      // Create exactly 3 public subagents
      for (let i = 0; i < 3; i++) {
        const { id } = await createSubagent({ name: `Agent ${i}` });
        await caller().subagents.togglePublic({ id, isPublic: true });
      }

      const result = await caller().subagents.listPublic({ limit: 3, offset: 0 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(false);
    });

    it("should reject unauthenticated calls", async () => {
      await expect(anonCaller().subagents.listPublic()).rejects.toThrow();
    });
  });
});
