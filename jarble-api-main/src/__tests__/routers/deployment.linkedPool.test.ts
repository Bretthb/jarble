/**
 * Integration tests for `deployment.linkToPool`, `unlinkFromPool`, `getPoolChildren`.
 *
 * Tests credit pool linking, ownership, chain prevention, round-trip.
 * Uses real in-memory SQLite with mocked K8s, Stripe, and OpenRouter.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn(),
  deleteDeployment: vi.fn(),
  stopDeployment: vi.fn(),
  startDeployment: vi.fn(),
  restartDeployment: vi.fn(),
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

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn(),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
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
// The  export must carry real Drizzle column definitions so routers
// can build  expressions.
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

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterAll(() => {
  ctx?.raw.close();
});

function authedCaller(overrides?: { userId?: string; auth0Id?: string; email?: string }) {
  return createTestCaller(ctx.db, {
    id: overrides?.userId ?? ctx.testUserId,
    email: overrides?.email ?? "test@jarble.ai",
    name: "Test User",
    auth0Id: overrides?.auth0Id ?? ctx.testAuth0Id,
    emailVerified: true,
  });
}

function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-test-001";
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, llm_api_key_source_deployment_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || ctx.testUserId,
    overrides.name || "Test Deployment",
    overrides.runtime || "openclaw",
    overrides.runtimeCatalogId || ctx.openclawCatalogId,
    overrides.status || "running",
    overrides.llmMode || "byok",
    overrides.llmProvider || "openrouter",
    overrides.managedBy || "legacy",
    overrides.llmApiKeySourceDeploymentId || null,
  );
  return id;
}

// ── Tests: linkToPool ────────────────────────────────────────────────────────

describe("deployment.linkToPool", () => {
  it("links a BYOK deployment to an included-mode deployment", async () => {
    seedDeployment({ id: "dep-pool", llmMode: "included" });
    seedDeployment({ id: "dep-child", llmMode: "byok" });

    const caller = authedCaller();
    const result = await caller.deployment.linkToPool({
      deploymentId: "dep-child",
      sourceDeploymentId: "dep-pool",
    });

    expect(result.success).toBe(true);

    // Verify DB state
    const child = ctx.raw.prepare("SELECT llm_mode, llm_api_key_source_deployment_id FROM deployments WHERE id = ?").get("dep-child") as any;
    expect(child.llm_mode).toBe("included");
    expect(child.llm_api_key_source_deployment_id).toBe("dep-pool");
  });

  it("fails if target is not 'included' mode", async () => {
    seedDeployment({ id: "dep-byok-owner", llmMode: "byok" });
    seedDeployment({ id: "dep-child2", llmMode: "byok" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-child2",
        sourceDeploymentId: "dep-byok-owner",
      })
    ).rejects.toThrow("does not use included credits");
  });

  it("fails if target is itself linked (chain prevention)", async () => {
    seedDeployment({ id: "dep-root", llmMode: "included" });
    seedDeployment({ id: "dep-mid", llmMode: "included", llmApiKeySourceDeploymentId: "dep-root" });
    seedDeployment({ id: "dep-leaf", llmMode: "byok" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-leaf",
        sourceDeploymentId: "dep-mid",
      })
    ).rejects.toThrow("cannot chain pools");
  });

  it("fails if child is already linked", async () => {
    seedDeployment({ id: "dep-pool-a", llmMode: "included" });
    seedDeployment({ id: "dep-pool-b", llmMode: "included" });
    seedDeployment({ id: "dep-already-linked", llmMode: "included", llmApiKeySourceDeploymentId: "dep-pool-a" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-already-linked",
        sourceDeploymentId: "dep-pool-b",
      })
    ).rejects.toThrow("already linked");
  });

  it("fails if linking to self", async () => {
    seedDeployment({ id: "dep-self", llmMode: "included" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-self",
        sourceDeploymentId: "dep-self",
      })
    ).rejects.toThrow("Cannot link a deployment to itself");
  });

  it("fails if target belongs to another user", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-other-pool", userId: "user2", llmMode: "included" });
    seedDeployment({ id: "dep-my-child", llmMode: "byok" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-my-child",
        sourceDeploymentId: "dep-other-pool",
      })
    ).rejects.toThrow("Pool owner not found");
  });

  it("fails if child doesn't exist", async () => {
    seedDeployment({ id: "dep-pool-exists", llmMode: "included" });

    const caller = authedCaller();
    await expect(
      caller.deployment.linkToPool({
        deploymentId: "dep-nonexistent",
        sourceDeploymentId: "dep-pool-exists",
      })
    ).rejects.toThrow("Deployment not found");
  });
});

// ── Tests: unlinkFromPool ────────────────────────────────────────────────────

describe("deployment.unlinkFromPool", () => {
  it("unlinks a linked deployment and clears source ID", async () => {
    seedDeployment({ id: "dep-pool-ul", llmMode: "included" });
    seedDeployment({ id: "dep-linked", llmMode: "included", llmApiKeySourceDeploymentId: "dep-pool-ul" });

    const caller = authedCaller();
    const result = await caller.deployment.unlinkFromPool({ deploymentId: "dep-linked" });

    expect(result.success).toBe(true);

    const dep = ctx.raw.prepare("SELECT llm_mode, llm_api_key_source_deployment_id FROM deployments WHERE id = ?").get("dep-linked") as any;
    expect(dep.llm_mode).toBe("byok");
    expect(dep.llm_api_key_source_deployment_id).toBeNull();
  });

  it("fails if deployment is not linked", async () => {
    seedDeployment({ id: "dep-not-linked", llmMode: "byok" });

    const caller = authedCaller();
    await expect(
      caller.deployment.unlinkFromPool({ deploymentId: "dep-not-linked" })
    ).rejects.toThrow("Not linked to a pool");
  });

  it("fails if deployment doesn't exist", async () => {
    const caller = authedCaller();
    await expect(
      caller.deployment.unlinkFromPool({ deploymentId: "dep-nope" })
    ).rejects.toThrow("not found");
  });
});

// ── Tests: getPoolChildren ───────────────────────────────────────────────────

describe("deployment.getPoolChildren", () => {
  it("returns linked children for a pool owner", async () => {
    seedDeployment({ id: "dep-pool-gc", llmMode: "included" });
    seedDeployment({ id: "dep-child-1", name: "Child One", llmMode: "included", llmApiKeySourceDeploymentId: "dep-pool-gc" });
    seedDeployment({ id: "dep-child-2", name: "Child Two", llmMode: "included", llmApiKeySourceDeploymentId: "dep-pool-gc" });

    const caller = authedCaller();
    const children = await caller.deployment.getPoolChildren({ deploymentId: "dep-pool-gc" });

    expect(children).toHaveLength(2);
    expect(children.map((c: any) => c.id).sort()).toEqual(["dep-child-1", "dep-child-2"]);
    expect(children[0]).toHaveProperty("name");
    expect(children[0]).toHaveProperty("runtime");
    expect(children[0]).toHaveProperty("status");
  });

  it("returns empty array when no children linked", async () => {
    seedDeployment({ id: "dep-solo", llmMode: "included" });

    const caller = authedCaller();
    const children = await caller.deployment.getPoolChildren({ deploymentId: "dep-solo" });

    expect(children).toEqual([]);
  });

  it("only returns caller's deployments, not other users'", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-shared-pool", llmMode: "included" });
    seedDeployment({ id: "dep-my-linked", llmMode: "included", llmApiKeySourceDeploymentId: "dep-shared-pool" });
    // This deployment belongs to user2 but references the same pool
    seedDeployment({ id: "dep-their-linked", userId: "user2", llmMode: "included", llmApiKeySourceDeploymentId: "dep-shared-pool" });

    const caller = authedCaller();
    const children = await caller.deployment.getPoolChildren({ deploymentId: "dep-shared-pool" });

    expect(children).toHaveLength(1);
    expect(children[0].id).toBe("dep-my-linked");
  });
});

// ── Integration: round-trip ──────────────────────────────────────────────────

describe("deployment pool: link then unlink round-trip", () => {
  it("link then unlink round-trip restores original state", async () => {
    seedDeployment({ id: "dep-pool-rt", llmMode: "included" });
    seedDeployment({ id: "dep-child-rt", llmMode: "byok" });

    const caller = authedCaller();

    // Step 1: Link
    await caller.deployment.linkToPool({
      deploymentId: "dep-child-rt",
      sourceDeploymentId: "dep-pool-rt",
    });

    // Verify linked state
    let dep = ctx.raw.prepare("SELECT llm_mode, llm_api_key_source_deployment_id FROM deployments WHERE id = ?").get("dep-child-rt") as any;
    expect(dep.llm_mode).toBe("included");
    expect(dep.llm_api_key_source_deployment_id).toBe("dep-pool-rt");

    // Step 2: Verify it shows up in pool children
    const children = await caller.deployment.getPoolChildren({ deploymentId: "dep-pool-rt" });
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe("dep-child-rt");

    // Step 3: Unlink
    await caller.deployment.unlinkFromPool({ deploymentId: "dep-child-rt" });

    // Verify unlinked state
    dep = ctx.raw.prepare("SELECT llm_mode, llm_api_key_source_deployment_id FROM deployments WHERE id = ?").get("dep-child-rt") as any;
    expect(dep.llm_mode).toBe("byok");
    expect(dep.llm_api_key_source_deployment_id).toBeNull();

    // Step 4: Verify no children remain
    const afterChildren = await caller.deployment.getPoolChildren({ deploymentId: "dep-pool-rt" });
    expect(afterChildren).toEqual([]);
  });
});
