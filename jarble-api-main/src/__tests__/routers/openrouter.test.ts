/**
 * Integration tests for the openrouter tRPC router.
 *
 * Tests validateProviderKey (multi-provider), provisionKey,
 * getKeyUsage, updateKeyLimit, revokeKey, cancelManagedKey.
 * Uses real in-memory SQLite with mocked external APIs.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockProvisionOpenRouterKey = vi.fn().mockResolvedValue({ key: "sk-or-provisioned", hash: "hash-prov-123" });
const mockRevokeOpenRouterKey = vi.fn().mockResolvedValue(true);
const mockGetOpenRouterKeyUsage = vi.fn().mockResolvedValue({ usageDollars: 1.5, limitDollars: 5 });
const mockUpdateOpenRouterKeyLimit = vi.fn().mockResolvedValue(true);

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: (...args: any[]) => mockProvisionOpenRouterKey(...args),
  revokeOpenRouterKey: (...args: any[]) => mockRevokeOpenRouterKey(...args),
  getOpenRouterKeyUsage: (...args: any[]) => mockGetOpenRouterKeyUsage(...args),
  updateOpenRouterKeyLimit: (...args: any[]) => mockUpdateOpenRouterKeyLimit(...args),
}));

vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: vi.fn((plaintext: string) => `ENC:${plaintext}`),
  decryptApiKey: vi.fn((encrypted: string) => encrypted.replace("ENC:", "")),
}));

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

vi.mock("../../utils/env.js", () => ({
  env: {
    DB_PROVIDER: "postgres",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_MANAGEMENT_KEY: "mgmt-key-test",
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

// Mock global fetch for validation calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Setup ────────────────────────────────────────────────────────────────────
let ctx: TestDbContext;
const DEPLOYMENT_ID = "dep-or-001";

function seedDeployment(overrides: Record<string, any> = {}) {
  const defaults = {
    id: DEPLOYMENT_ID,
    userId: ctx.testUserId,
    name: "Test Bot",
    runtime: "openclaw",
    runtimeCatalogId: ctx.openclawCatalogId,
    status: "running",
    llmMode: "byok",
    llmProvider: "openrouter",
    llmApiKey: null,
    llmApiKeyId: null,
  };
  const vals = { ...defaults, ...overrides };
  ctx.raw.exec(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, llm_api_key, llm_api_key_id)
    VALUES ('${vals.id}', '${vals.userId}', '${vals.name}', '${vals.runtime}', ${vals.runtimeCatalogId}, '${vals.status}', '${vals.llmMode}', '${vals.llmProvider}', ${vals.llmApiKey ? `'${vals.llmApiKey}'` : "NULL"}, ${vals.llmApiKeyId ? `'${vals.llmApiKeyId}'` : "NULL"});
  `);
}

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  mockFetch.mockReset();
  seedDeployment();
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("openrouter router", () => {
  // ── validateProviderKey ───────────────────────────────────────────────────

  describe("validateProviderKey", () => {
    it("should accept dev-* keys in dev mode", async () => {
      const result = await caller().openrouter.validateProviderKey({
        provider: "openrouter",
        apiKey: "dev-test-key",
      });
      expect(result).toEqual({ valid: true });
      // Should NOT call fetch for dev keys
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should auto-accept Claude Max OAuth tokens (sk-ant-oat prefix)", async () => {
      const result = await caller().openrouter.validateProviderKey({
        provider: "anthropic",
        apiKey: "sk-ant-oat01-abcdef1234567890",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should validate openrouter key via API", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
      const result = await caller().openrouter.validateProviderKey({
        provider: "openrouter",
        apiKey: "sk-or-real-key",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer sk-or-real-key" }),
        })
      );
    });

    it("should return invalid for rejected openrouter key", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const result = await caller().openrouter.validateProviderKey({
        provider: "openrouter",
        apiKey: "sk-or-bad-key",
      });
      expect(result).toEqual({ valid: false });
    });

    it("should validate openai key via API", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await caller().openrouter.validateProviderKey({
        provider: "openai",
        apiKey: "sk-openai-test",
      });
      expect(result).toEqual({ valid: true });
    });

    it("should validate anthropic key via API (non-OAuth)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const result = await caller().openrouter.validateProviderKey({
        provider: "anthropic",
        apiKey: "sk-ant-api-12345",
      });
      expect(result).toEqual({ valid: true });
    });

    it("should return invalid for anthropic 401", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const result = await caller().openrouter.validateProviderKey({
        provider: "anthropic",
        apiKey: "sk-ant-api-bad",
      });
      expect(result).toEqual({ valid: false });
    });

    it("should return invalid for anthropic 403", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      const result = await caller().openrouter.validateProviderKey({
        provider: "anthropic",
        apiKey: "sk-ant-api-forbidden",
      });
      expect(result).toEqual({ valid: false });
    });

    it("should accept anthropic key with non-401/403 error (rate limit etc)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
      const result = await caller().openrouter.validateProviderKey({
        provider: "anthropic",
        apiKey: "sk-ant-api-ratelimited",
      });
      expect(result).toEqual({ valid: true });
    });

    it("should validate google key via API", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await caller().openrouter.validateProviderKey({
        provider: "google",
        apiKey: "AIza-test-google-key",
      });
      expect(result).toEqual({ valid: true });
    });

    it("should return invalid on fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      const result = await caller().openrouter.validateProviderKey({
        provider: "openai",
        apiKey: "sk-broken",
      });
      expect(result).toEqual({ valid: false });
    });

    it("should reject empty apiKey", async () => {
      await expect(
        caller().openrouter.validateProviderKey({
          provider: "openrouter",
          apiKey: "",
        })
      ).rejects.toThrow();
    });

    it("should reject unauthenticated calls", async () => {
      await expect(
        anonCaller().openrouter.validateProviderKey({
          provider: "openrouter",
          apiKey: "sk-test",
        })
      ).rejects.toThrow();
    });
  });

  // ── provisionKey ──────────────────────────────────────────────────────────

  describe("provisionKey", () => {
    it("should provision a key and store the hash", async () => {
      const result = await caller().openrouter.provisionKey({
        deploymentId: DEPLOYMENT_ID,
      });
      expect(result.success).toBe(true);
      expect(result.hash).toBe("hash-prov-123");
      expect(mockProvisionOpenRouterKey).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ctx.testUserId,
          deploymentId: DEPLOYMENT_ID,
          limitDollars: 5,
        })
      );
    });

    it("should reject non-owned deployment", async () => {
      ctx.raw.exec(`
        INSERT INTO users (id, email, name, auth0_id, email_verified)
        VALUES ('other-user', 'other@jarble.ai', 'Other', 'auth0|other', 1);
      `);
      const otherCaller = createTestCaller(ctx.db, {
        id: "other-user",
        email: "other@jarble.ai",
        name: "Other",
        auth0Id: "auth0|other",
        emailVerified: true,
      });
      await expect(
        otherCaller.openrouter.provisionKey({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("Deployment not found");
    });

    it("should accept custom limitDollars", async () => {
      await caller().openrouter.provisionKey({
        deploymentId: DEPLOYMENT_ID,
        limitDollars: 20,
      });
      expect(mockProvisionOpenRouterKey).toHaveBeenCalledWith(
        expect.objectContaining({ limitDollars: 20 })
      );
    });
  });

  // ── revokeKey ─────────────────────────────────────────────────────────────

  describe("revokeKey", () => {
    it("should reject if no key is associated", async () => {
      await expect(
        caller().openrouter.revokeKey({ deploymentId: DEPLOYMENT_ID })
      ).rejects.toThrow("No OpenRouter key associated");
    });

    it("should revoke key and clear from DB when key exists", async () => {
      // Set up deployment with a key
      ctx.raw.exec(`
        UPDATE deployments SET llm_api_key_id = 'key-hash-123', llm_mode = 'included'
        WHERE id = '${DEPLOYMENT_ID}';
      `);
      const result = await caller().openrouter.revokeKey({ deploymentId: DEPLOYMENT_ID });
      expect(result).toEqual({ success: true });
      expect(mockRevokeOpenRouterKey).toHaveBeenCalledWith("key-hash-123");
    });
  });

  // ── getKeyUsage ───────────────────────────────────────────────────────────

  describe("getKeyUsage", () => {
    it("should return null for byok deployment", async () => {
      const result = await caller().openrouter.getKeyUsage({ deploymentId: DEPLOYMENT_ID });
      expect(result).toBeNull();
    });

    it("should return usage for included-credits deployment", async () => {
      ctx.raw.exec(`
        UPDATE deployments SET llm_mode = 'included', llm_api_key_id = 'key-hash-456'
        WHERE id = '${DEPLOYMENT_ID}';
      `);
      const result = await caller().openrouter.getKeyUsage({ deploymentId: DEPLOYMENT_ID });
      expect(result).toEqual({ usageDollars: 1.5, limitDollars: 5 });
      expect(mockGetOpenRouterKeyUsage).toHaveBeenCalledWith("key-hash-456");
    });
  });

  // ── updateKeyLimit ────────────────────────────────────────────────────────

  describe("updateKeyLimit", () => {
    it("should reject for byok deployment", async () => {
      await expect(
        caller().openrouter.updateKeyLimit({ deploymentId: DEPLOYMENT_ID, limitDollars: 10 })
      ).rejects.toThrow("does not use included credits");
    });

    it("should update limit for included-credits deployment", async () => {
      ctx.raw.exec(`
        UPDATE deployments SET llm_mode = 'included', llm_api_key_id = 'key-hash-789'
        WHERE id = '${DEPLOYMENT_ID}';
      `);
      const result = await caller().openrouter.updateKeyLimit({
        deploymentId: DEPLOYMENT_ID,
        limitDollars: 25,
      });
      expect(result).toEqual({ success: true });
      expect(mockUpdateOpenRouterKeyLimit).toHaveBeenCalledWith("key-hash-789", 25);
    });
  });
});
