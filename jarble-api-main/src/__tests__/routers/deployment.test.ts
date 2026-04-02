/**
 * Integration tests for the deployment tRPC router.
 *
 * Tests CRUD, free trial logic, lifecycle ops, ownership checks.
 * Uses real in-memory SQLite with mocked K8s, Stripe, and OpenRouter.
 */
import { describe, it, expect, afterAll, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockDeleteDeployment = vi.fn().mockResolvedValue(undefined);
const mockStopDeployment = vi.fn().mockResolvedValue(undefined);
const mockStartDeployment = vi.fn().mockResolvedValue(undefined);
const mockCreateDeployment = vi.fn().mockResolvedValue(undefined);
const mockRestartDeployment = vi.fn().mockResolvedValue(undefined);
const mockGetDeploymentPodStatus = vi.fn().mockResolvedValue({ status: "running" });

vi.mock("../../k8s/index.js", () => ({
  createDeployment: (...args: any[]) => mockCreateDeployment(...args),
  deleteDeployment: (...args: any[]) => mockDeleteDeployment(...args),
  stopDeployment: (...args: any[]) => mockStopDeployment(...args),
  startDeployment: (...args: any[]) => mockStartDeployment(...args),
  restartDeployment: (...args: any[]) => mockRestartDeployment(...args),
  getDeploymentPodStatus: (...args: any[]) => mockGetDeploymentPodStatus(...args),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "", podName: null }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
}));

const mockCancelSubImmediately = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: (...args: any[]) => mockCancelSubImmediately(...args),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

const mockProvisionKey = vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" });
const mockRevokeKey = vi.fn().mockResolvedValue(true);

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: (...args: any[]) => mockProvisionKey(...args),
  revokeOpenRouterKey: (...args: any[]) => mockRevokeKey(...args),
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

function authedCaller(opts?: { emailVerified?: boolean }) {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: opts?.emailVerified ?? true,
  });
}

// Helper: insert a deployment directly in DB for lifecycle tests
function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-test-001";
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deployment.list", () => {
  it("returns empty array for user with no deployments", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.list();
    expect(result).toEqual([]);
  });

  it("returns deployments owned by the user", async () => {
    seedDeployment({ id: "dep-1", name: "Bot One" });
    seedDeployment({ id: "dep-2", name: "Bot Two" });

    const caller = authedCaller();
    const result = await caller.deployment.list();
    expect(result).toHaveLength(2);
    expect(result.map((d: any) => d.name).sort()).toEqual(["Bot One", "Bot Two"]);
  });

  it("does not return other users' deployments", async () => {
    // Create another user
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-mine" });
    seedDeployment({ id: "dep-theirs", userId: "user2", name: "Their Bot" });

    const caller = authedCaller();
    const result = await caller.deployment.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dep-mine");
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.deployment.list()).rejects.toThrow("You must be logged in");
  });
});

describe("deployment.create", () => {
  it("creates a BYOK deployment with encrypted API key", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "My Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-my-real-key",
    });

    expect(result).toBeTruthy();
    expect(result!.name).toBe("My Bot");
    expect(result!.runtime).toBe("openclaw");
    expect(result!.status).toBe("pending");
    expect(result!.llmMode).toBe("byok");
    // API key should be encrypted (plain: prefix since no ENCRYPTION_KEY)
    expect(result!.llmApiKey).toBe("plain:sk-or-my-real-key");
  });

  it("claims free deployment for first-time user", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "Free Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key",
    });

    expect(result!.isFree).toBe(true);
    expect(result!.freeExpiresAt).toBeTruthy();
    expect(result!.monthlyPriceCents).toBe(0);

    // User should now have freeDeploymentUsed = true
    const user = ctx.raw.prepare("SELECT free_deployment_used FROM users WHERE id = ?").get(ctx.testUserId) as any;
    expect(user.free_deployment_used).toBe(1);
  });

  it("second deployment is not free", async () => {
    const caller = authedCaller();

    // First deployment claims free slot
    await caller.deployment.create({
      name: "First Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key1",
    });

    // Second deployment should NOT be free
    const second = await caller.deployment.create({
      name: "Second Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key2",
    });

    expect(second!.isFree).toBe(false);
    expect(second!.monthlyPriceCents).toBeGreaterThan(0);
  });

  it("rejects invalid runtimeCatalogId", async () => {
    const caller = authedCaller();
    await expect(
      caller.deployment.create({
        name: "Bad Bot",
        runtimeCatalogId: 999,
        llmMode: "byok",
        llmProvider: "openrouter",
        llmApiKey: "sk-or-key",
      })
    ).rejects.toThrow("Runtime not found in catalog");
  });

  it("saves system prompt", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "Prompted Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key",
      systemPrompt: "You are a helpful bot.",
    });

    expect(result!.systemPrompt).toBe("You are a helpful bot.");
  });

  it("saves Telegram bot token as platform credential during create", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "Telegram Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key",
      telegramBotToken: "123456:ABC-test-token",
    });

    // Check platform_credentials table
    const creds = ctx.raw.prepare(
      "SELECT * FROM platform_credentials WHERE deployment_id = ? AND platform_id = 'telegram'"
    ).get(result!.id) as any;

    expect(creds).toBeTruthy();
    expect(creds.credentials).toContain("123456:ABC-test-token");
  });
});

describe("deployment.getById", () => {
  it("returns a deployment owned by the user", async () => {
    seedDeployment({ id: "dep-get-test", name: "My Bot" });

    const caller = authedCaller();
    const result = await caller.deployment.getById({ id: "dep-get-test" });
    expect(result).toBeTruthy();
    expect(result!.name).toBe("My Bot");
  });

  it("returns undefined for non-existent deployment", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.getById({ id: "nonexistent" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for another user's deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-theirs", userId: "user2" });

    const caller = authedCaller();
    const result = await caller.deployment.getById({ id: "dep-theirs" });
    expect(result).toBeUndefined();
  });
});

describe("deployment.deploy", () => {
  it("rejects unverified email", async () => {
    seedDeployment({ id: "dep-deploy", status: "pending" });
    const caller = authedCaller({ emailVerified: false });

    await expect(
      caller.deployment.deploy("dep-deploy")
    ).rejects.toThrow("verify your email");
  });

  it("transitions from pending and starts K8s deployment", async () => {
    seedDeployment({ id: "dep-deploy", status: "pending" });
    const caller = authedCaller();

    const result = await caller.deployment.deploy("dep-deploy");
    expect(result.success).toBe(true);

    // K8s runs as fire-and-forget - with mocks it resolves instantly,
    // so status may already be "running". Either "creating" or "running" is valid.
    const dep = ctx.raw.prepare("SELECT status FROM deployments WHERE id = ?").get("dep-deploy") as any;
    expect(["creating", "running"]).toContain(dep.status);
  });

  it("rejects deploying an already running deployment", async () => {
    seedDeployment({ id: "dep-running", status: "running" });
    const caller = authedCaller();

    await expect(
      caller.deployment.deploy("dep-running")
    ).rejects.toThrow("Cannot deploy: deployment is already running");
  });
});

describe("deployment.stop", () => {
  it("stops a running deployment", async () => {
    seedDeployment({ id: "dep-stop", status: "running" });
    const caller = authedCaller();

    const result = await caller.deployment.stop({ id: "dep-stop" });
    expect(result.success).toBe(true);
    expect(mockStopDeployment).toHaveBeenCalledWith("dep-stop", "legacy");

    const dep = ctx.raw.prepare("SELECT status FROM deployments WHERE id = ?").get("dep-stop") as any;
    expect(dep.status).toBe("stopped");
  });

  it("rejects stopping a non-running deployment", async () => {
    seedDeployment({ id: "dep-stopped", status: "stopped" });
    const caller = authedCaller();

    await expect(caller.deployment.stop({ id: "dep-stopped" })).rejects.toThrow(
      "Cannot stop a deployment that is stopped"
    );
  });

  it("rejects stopping a non-existent deployment", async () => {
    const caller = authedCaller();
    await expect(caller.deployment.stop({ id: "nonexistent" })).rejects.toThrow("not found");
  });

  it("rolls back status on K8s failure", async () => {
    seedDeployment({ id: "dep-stop-fail", status: "running" });
    mockStopDeployment.mockRejectedValueOnce(new Error("K8s error"));

    const caller = authedCaller();
    await expect(caller.deployment.stop({ id: "dep-stop-fail" })).rejects.toThrow("Failed to stop");

    // Status should be rolled back to running
    const dep = ctx.raw.prepare("SELECT status FROM deployments WHERE id = ?").get("dep-stop-fail") as any;
    expect(dep.status).toBe("running");
  });
});

describe("deployment.restart", () => {
  it("sets status to restarting for a running deployment", async () => {
    seedDeployment({ id: "dep-restart", status: "running" });
    const caller = authedCaller();

    const result = await caller.deployment.restart({ id: "dep-restart" });
    expect(result.success).toBe(true);

    const dep = ctx.raw.prepare("SELECT status FROM deployments WHERE id = ?").get("dep-restart") as any;
    expect(dep.status).toBe("restarting");
  });

  it("rejects restarting a stopped deployment", async () => {
    seedDeployment({ id: "dep-restart-stopped", status: "stopped" });
    const caller = authedCaller();

    await expect(
      caller.deployment.restart({ id: "dep-restart-stopped" })
    ).rejects.toThrow("Cannot restart");
  });
});

describe("deployment.delete", () => {
  it("deletes a deployment and its child records", async () => {
    seedDeployment({ id: "dep-del" });

    // Add a platform credential
    ctx.raw.exec(`INSERT INTO platform_credentials (id, deployment_id, platform_id, credentials) VALUES ('cred1', 'dep-del', 'telegram', 'encrypted')`);

    const caller = authedCaller();
    const result = await caller.deployment.delete({ id: "dep-del" });
    expect(result.success).toBe(true);

    expect(mockDeleteDeployment).toHaveBeenCalledWith("dep-del", "legacy");

    // Verify DB cleanup
    const dep = ctx.raw.prepare("SELECT * FROM deployments WHERE id = ?").get("dep-del");
    expect(dep).toBeUndefined();

    const creds = ctx.raw.prepare("SELECT * FROM platform_credentials WHERE deployment_id = ?").all("dep-del");
    expect(creds).toHaveLength(0);
  });

  it("rejects deleting another user's deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-other", userId: "user2" });

    const caller = authedCaller();
    await expect(caller.deployment.delete({ id: "dep-other" })).rejects.toThrow("not found");
  });

  it("rejects deleting a non-existent deployment", async () => {
    const caller = authedCaller();
    await expect(caller.deployment.delete({ id: "nonexistent" })).rejects.toThrow("not found");
  });
});

describe("deployment.update", () => {
  it("updates deployment name", async () => {
    seedDeployment({ id: "dep-upd", name: "Old Name" });
    const caller = authedCaller();

    const result = await caller.deployment.update({ id: "dep-upd", name: "New Name" });
    expect(result!.name).toBe("New Name");
  });

  it("updates system prompt", async () => {
    seedDeployment({ id: "dep-upd-prompt" });
    const caller = authedCaller();

    const result = await caller.deployment.update({
      id: "dep-upd-prompt",
      systemPrompt: "New prompt",
    });
    expect(result!.systemPrompt).toBe("New prompt");
  });

  it("rejects updating non-existent deployment", async () => {
    const caller = authedCaller();
    await expect(
      caller.deployment.update({ id: "nonexistent", name: "X" })
    ).rejects.toThrow("not found");
  });
});
