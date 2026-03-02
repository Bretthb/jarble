/**
 * Integration tests for the openrouter tRPC router.
 *
 * Tests validateProviderKey (multi-provider), provisionKey, getKeyUsage, updateKeyLimit, revokeKey.
 * Uses real in-memory SQLite with mocked HTTP fetch and OpenRouter utils.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

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
  findPodForDeployment: vi.fn(),
  execInPod: vi.fn(),
}));

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn(),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn(),
}));

const mockProvisionKey = vi.fn().mockResolvedValue({ key: "sk-or-provisioned", hash: "hash-001" });
const mockRevokeKey = vi.fn().mockResolvedValue(true);
const mockGetUsage = vi.fn().mockResolvedValue({ used: 1.5, limit: 5 });
const mockUpdateLimit = vi.fn().mockResolvedValue(true);

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: (...args: any[]) => mockProvisionKey(...args),
  revokeOpenRouterKey: (...args: any[]) => mockRevokeKey(...args),
  getOpenRouterKeyUsage: (...args: any[]) => mockGetUsage(...args),
  updateOpenRouterKeyLimit: (...args: any[]) => mockUpdateLimit(...args),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    DB_PROVIDER: "sqlite",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_MANAGEMENT_KEY: "mgmt-key-123",
    API_KEY_ENCRYPTION_KEY: undefined,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));

// Mock global fetch for API key validation
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

function authedCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-or-001";
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, llm_api_key_id, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || ctx.testUserId,
    overrides.name || "OR Bot",
    "openclaw",
    ctx.openclawCatalogId,
    overrides.status || "running",
    overrides.llmMode || "included",
    overrides.llmProvider || "openrouter",
    overrides.llmApiKeyId || "key-hash-001",
    "legacy",
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("openrouter.validateProviderKey", () => {
  it("validates OpenRouter key via API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "openrouter",
      apiKey: "sk-or-v1-real-key",
    });

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-or-v1-real-key" },
      })
    );
  });

  it("validates OpenAI key via API", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "openai",
      apiKey: "sk-openai-test",
    });

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-openai-test" },
      })
    );
  });

  it("validates Anthropic key with x-api-key header", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "anthropic",
      apiKey: "sk-ant-api03-regular-key",
    });

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-api03-regular-key",
          "anthropic-version": "2023-06-01",
        }),
      })
    );
  });

  it("auto-passes Claude Max OAuth tokens (sk-ant-oat*)", async () => {
    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "anthropic",
      apiKey: "sk-ant-oat-some-oauth-token",
    });

    expect(result.valid).toBe(true);
    // Should NOT call fetch — auto-passed by prefix
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("validates Google key", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "google",
      apiKey: "AIza-google-key",
    });

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/models",
      expect.objectContaining({
        headers: { "x-goog-api-key": "AIza-google-key" },
      })
    );
  });

  it("returns invalid for failed API check", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "openrouter",
      apiKey: "sk-or-invalid",
    });

    expect(result.valid).toBe(false);
  });

  it("returns invalid on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "openai",
      apiKey: "sk-openai-test",
    });

    expect(result.valid).toBe(false);
  });

  it("auto-passes dev-* keys in dev mode", async () => {
    const caller = authedCaller();
    const result = await caller.openrouter.validateProviderKey({
      provider: "openrouter",
      apiKey: "dev-test-key",
    });

    expect(result.valid).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("openrouter.provisionKey", () => {
  it("provisions an OpenRouter key and stores it", async () => {
    seedDeployment({ id: "dep-provision", llmMode: "byok" });

    const caller = authedCaller();
    const result = await caller.openrouter.provisionKey({
      deploymentId: "dep-provision",
      limitDollars: 10,
    });

    expect(result.success).toBe(true);
    expect(result.hash).toBe("hash-001");
    expect(mockProvisionKey).toHaveBeenCalledWith(expect.objectContaining({
      userId: ctx.testUserId,
      deploymentId: "dep-provision",
      limitDollars: 10,
    }));

    // Verify DB was updated
    const dep = ctx.raw.prepare("SELECT llm_mode, llm_provider, llm_api_key_id FROM deployments WHERE id = ?").get("dep-provision") as any;
    expect(dep.llm_mode).toBe("included");
    expect(dep.llm_provider).toBe("openrouter");
    expect(dep.llm_api_key_id).toBe("hash-001");
  });

  it("rejects provisioning for non-owned deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-other", userId: "user2" });

    const caller = authedCaller();
    await expect(
      caller.openrouter.provisionKey({ deploymentId: "dep-other" })
    ).rejects.toThrow("not found");
  });
});

describe("openrouter.revokeKey", () => {
  it("revokes key and clears DB fields", async () => {
    seedDeployment({ id: "dep-revoke", llmApiKeyId: "hash-to-revoke" });

    const caller = authedCaller();
    const result = await caller.openrouter.revokeKey({ deploymentId: "dep-revoke" });
    expect(result.success).toBe(true);
    expect(mockRevokeKey).toHaveBeenCalledWith("hash-to-revoke");

    // DB should be cleared
    const dep = ctx.raw.prepare("SELECT llm_mode, llm_api_key, llm_api_key_id FROM deployments WHERE id = ?").get("dep-revoke") as any;
    expect(dep.llm_mode).toBe("byok");
    expect(dep.llm_api_key).toBeNull();
    expect(dep.llm_api_key_id).toBeNull();
  });

  it("rejects revoke when no key is associated", async () => {
    // Insert deployment with no keyId directly (seedDeployment defaults to a hash)
    ctx.raw.prepare(`
      INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("dep-no-key", ctx.testUserId, "No Key Bot", "openclaw", ctx.openclawCatalogId, "running", "included", "openrouter", "legacy");

    const caller = authedCaller();
    await expect(
      caller.openrouter.revokeKey({ deploymentId: "dep-no-key" })
    ).rejects.toThrow("No OpenRouter key");
  });
});

describe("openrouter.updateKeyLimit", () => {
  it("updates the credit limit", async () => {
    seedDeployment({ id: "dep-limit", llmApiKeyId: "key-hash-limit" });

    const caller = authedCaller();
    const result = await caller.openrouter.updateKeyLimit({
      deploymentId: "dep-limit",
      limitDollars: 25,
    });

    expect(result.success).toBe(true);
    expect(mockUpdateLimit).toHaveBeenCalledWith("key-hash-limit", 25);

    // DB should be updated
    const dep = ctx.raw.prepare("SELECT llm_credit_limit_dollars FROM deployments WHERE id = ?").get("dep-limit") as any;
    expect(dep.llm_credit_limit_dollars).toBe(25);
  });

  it("rejects update for linked deployment", async () => {
    seedDeployment({ id: "dep-linked" });
    // Set it as linked
    ctx.raw.exec(`UPDATE deployments SET llm_api_key_source_deployment_id = 'dep-owner' WHERE id = 'dep-linked'`);

    const caller = authedCaller();
    await expect(
      caller.openrouter.updateKeyLimit({ deploymentId: "dep-linked", limitDollars: 10 })
    ).rejects.toThrow("linked to a credit pool");
  });
});
