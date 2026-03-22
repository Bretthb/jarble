/**
 * Integration tests for the platformCredentials tRPC router.
 *
 * Tests credential save, get (masked), delete, testConnection, and WhatsApp status.
 * Uses real in-memory SQLite with mocked K8s and configSync.
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
  getDeploymentPodStatus: vi.fn(),
  getDeploymentStorageUsage: vi.fn(),
  exportDeploymentConfigs: vi.fn(),
  getDeploymentLogs: vi.fn(),
  getCustomComponentsWithDefinitions: vi.fn(),
  writeComponentToPvc: vi.fn(),
  deleteComponentFromPvc: vi.fn(),
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

const mockSyncConfigs = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: (...args: any[]) => mockSyncConfigs(...args),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn(),
  revokeOpenRouterKey: vi.fn(),
  getOpenRouterKeyUsage: vi.fn(),
  updateOpenRouterKeyLimit: vi.fn(),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    DB_PROVIDER: "sqlite",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    API_KEY_ENCRYPTION_KEY: undefined,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));

// ── Setup ────────────────────────────────────────────────────────────────────
let ctx: TestDbContext;

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  // Seed a running deployment for cred tests
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
    VALUES ('dep-cred', '${ctx.testUserId}', 'Cred Bot', 'openclaw', ${ctx.openclawCatalogId}, 'running', 'byok', 'openrouter', 'legacy')
  `);
});

afterAll(() => {
  ctx?.raw.close();
});

function authedCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("platformCredentials.save", () => {
  it("saves new Telegram credentials (encrypted)", async () => {
    const caller = authedCaller();
    const result = await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "telegram",
      credentials: { botToken: "123456:ABC-token" },
    });

    expect(result.success).toBe(true);

    // Check DB has an encrypted row
    const row = ctx.raw.prepare(
      "SELECT * FROM platform_credentials WHERE deployment_id = 'dep-cred' AND platform_id = 'telegram'"
    ).get() as any;
    expect(row).toBeTruthy();
    // In dev mode (no encryption key), stored as "plain:{json}"
    expect(row.credentials).toContain("123456:ABC-token");
  });

  it("triggers configSync after save", async () => {
    const caller = authedCaller();
    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "telegram",
      credentials: { botToken: "token" },
    });

    expect(mockSyncConfigs).toHaveBeenCalledWith("dep-cred");
  });

  it("updates existing credentials (upsert)", async () => {
    const caller = authedCaller();

    // First save
    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "discord",
      credentials: { botToken: "old-token" },
    });

    // Update
    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "discord",
      credentials: { botToken: "new-token" },
    });

    // Should only have 1 row
    const rows = ctx.raw.prepare(
      "SELECT * FROM platform_credentials WHERE deployment_id = 'dep-cred' AND platform_id = 'discord'"
    ).all();
    expect(rows).toHaveLength(1);

    const row = rows[0] as any;
    expect(row.credentials).toContain("new-token");
    expect(row.credentials).not.toContain("old-token");
  });

  it("rejects unknown platform", async () => {
    const caller = authedCaller();
    await expect(
      caller.platformCredentials.save({
        deploymentId: "dep-cred",
        platformId: "fakechat",
        credentials: { botToken: "token" },
      })
    ).rejects.toThrow("Unknown platform");
  });

  it("rejects if deployment not found", async () => {
    const caller = authedCaller();
    await expect(
      caller.platformCredentials.save({
        deploymentId: "nonexistent",
        platformId: "telegram",
        credentials: { botToken: "token" },
      })
    ).rejects.toThrow("not found");
  });
});

describe("platformCredentials.getByDeployment", () => {
  it("returns masked credentials", async () => {
    const caller = authedCaller();

    // Save a credential first
    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "telegram",
      credentials: { botToken: "1234567890:ABCdefGHI-token-value" },
    });

    const result = await caller.platformCredentials.getByDeployment({
      deploymentId: "dep-cred",
    });

    expect(result).toHaveLength(1);
    expect(result[0].platformId).toBe("telegram");

    // Credentials should be masked (first 4, last 4 visible)
    const masked = result[0].maskedCredentials.botToken;
    expect(masked).toMatch(/^1234.*alue$/);
    expect(masked).toContain("*");
  });

  it("returns empty array when no credentials saved", async () => {
    const caller = authedCaller();
    const result = await caller.platformCredentials.getByDeployment({
      deploymentId: "dep-cred",
    });
    expect(result).toEqual([]);
  });

  it("rejects for non-owned deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    ctx.raw.exec(`INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by) VALUES ('dep-other', 'user2', 'Other Bot', 'openclaw', 1, 'running', 'byok', 'openrouter', 'legacy')`);

    const caller = authedCaller();
    await expect(
      caller.platformCredentials.getByDeployment({ deploymentId: "dep-other" })
    ).rejects.toThrow("not found");
  });
});

describe("platformCredentials.delete", () => {
  it("deletes credentials by platform", async () => {
    const caller = authedCaller();

    // Save first
    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "slack",
      credentials: { botToken: "xoxb-token", appToken: "xapp-token" },
    });

    // Delete
    const result = await caller.platformCredentials.delete({
      deploymentId: "dep-cred",
      platformId: "slack",
    });
    expect(result.success).toBe(true);

    // Verify gone from DB
    const row = ctx.raw.prepare(
      "SELECT * FROM platform_credentials WHERE deployment_id = 'dep-cred' AND platform_id = 'slack'"
    ).get();
    expect(row).toBeUndefined();
  });

  it("triggers configSync after delete for running deployment", async () => {
    const caller = authedCaller();

    await caller.platformCredentials.save({
      deploymentId: "dep-cred",
      platformId: "telegram",
      credentials: { botToken: "token" },
    });

    vi.clearAllMocks();

    await caller.platformCredentials.delete({
      deploymentId: "dep-cred",
      platformId: "telegram",
    });

    expect(mockSyncConfigs).toHaveBeenCalledWith("dep-cred");
  });

  it("does NOT trigger configSync for stopped deployment", async () => {
    // Change deployment status to stopped
    ctx.raw.exec(`UPDATE deployments SET status = 'stopped' WHERE id = 'dep-cred'`);

    const caller = authedCaller();
    await caller.platformCredentials.delete({
      deploymentId: "dep-cred",
      platformId: "telegram",
    });

    expect(mockSyncConfigs).not.toHaveBeenCalled();
  });
});

describe("platformCredentials.testConnection", () => {
  it("returns success for complete credentials", async () => {
    const caller = authedCaller();
    const result = await caller.platformCredentials.testConnection({
      deploymentId: "dep-cred",
      platformId: "telegram",
      credentials: { botToken: "123456:ABC-test-token" },
    });

    expect(result.success).toBe(true);
  });

  it("returns failure for missing required fields", async () => {
    const caller = authedCaller();
    const result = await caller.platformCredentials.testConnection({
      deploymentId: "dep-cred",
      platformId: "slack",
      credentials: { botToken: "xoxb-token", appToken: "" },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("appToken");
  });

  it("rejects unknown platform", async () => {
    const caller = authedCaller();
    await expect(
      caller.platformCredentials.testConnection({
        deploymentId: "dep-cred",
        platformId: "unknown",
        credentials: {},
      })
    ).rejects.toThrow("Unknown platform");
  });
});

describe("platformCredentials.checkWhatsAppStatus", () => {
  it("returns connected=false when no WhatsApp credentials", async () => {
    const caller = authedCaller();
    const result = await caller.platformCredentials.checkWhatsAppStatus({
      deploymentId: "dep-cred",
    });
    expect(result.connected).toBe(false);
  });

  it("returns connected=true after markWhatsAppConnected", async () => {
    const caller = authedCaller();

    await caller.platformCredentials.markWhatsAppConnected({
      deploymentId: "dep-cred",
    });

    const result = await caller.platformCredentials.checkWhatsAppStatus({
      deploymentId: "dep-cred",
    });
    expect(result.connected).toBe(true);
  });
});
