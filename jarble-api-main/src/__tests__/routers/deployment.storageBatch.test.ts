/**
 * Integration tests for `deployment.getStorageUsageBatch` tRPC procedure.
 *
 * Tests batch storage usage fetching, ownership filtering, error handling.
 * Uses real in-memory SQLite with mocked K8s, Stripe, and OpenRouter.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockGetDeploymentStorageUsage = vi.fn();

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn(),
  deleteDeployment: vi.fn(),
  stopDeployment: vi.fn(),
  startDeployment: vi.fn(),
  restartDeployment: vi.fn(),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: (...args: any[]) => mockGetDeploymentStorageUsage(...args),
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

describe("deployment.getStorageUsageBatch", () => {
  it("returns storage for running deployments", async () => {
    seedDeployment({ id: "dep-s1" });
    seedDeployment({ id: "dep-s2" });
    mockGetDeploymentStorageUsage.mockResolvedValue({
      usedBytes: 1073741824,
      totalBytes: 21474836480,
      usedGb: 1,
      totalGb: 20,
      percentUsed: 5,
    });

    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: ["dep-s1", "dep-s2"] });

    expect(result["dep-s1"]).toEqual({ usedGb: 1, totalGb: 20, percentUsed: 5 });
    expect(result["dep-s2"]).toEqual({ usedGb: 1, totalGb: 20, percentUsed: 5 });
    expect(mockGetDeploymentStorageUsage).toHaveBeenCalledTimes(2);
  });

  it("returns null for deployments where storage fetch fails", async () => {
    seedDeployment({ id: "dep-fail" });
    mockGetDeploymentStorageUsage.mockResolvedValue(null);

    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: ["dep-fail"] });

    expect(result["dep-fail"]).toBeNull();
  });

  it("only returns data for deployments owned by the caller", async () => {
    // Create second user
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-mine" });
    seedDeployment({ id: "dep-theirs", userId: "user2" });

    mockGetDeploymentStorageUsage.mockResolvedValue({
      usedBytes: 1073741824,
      totalBytes: 21474836480,
      usedGb: 1,
      totalGb: 20,
      percentUsed: 5,
    });

    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: ["dep-mine", "dep-theirs"] });

    // Should only contain own deployment
    expect(result["dep-mine"]).toEqual({ usedGb: 1, totalGb: 20, percentUsed: 5 });
    expect(result["dep-theirs"]).toBeUndefined();
    // getDeploymentStorageUsage should only be called for owned deployment
    expect(mockGetDeploymentStorageUsage).toHaveBeenCalledTimes(1);
  });

  it("returns empty object for empty input array", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: [] });

    expect(result).toEqual({});
    expect(mockGetDeploymentStorageUsage).not.toHaveBeenCalled();
  });

  it("filters out non-existent deployment IDs", async () => {
    seedDeployment({ id: "dep-real" });
    mockGetDeploymentStorageUsage.mockResolvedValue({
      usedBytes: 0,
      totalBytes: 21474836480,
      usedGb: 0,
      totalGb: 20,
      percentUsed: 0,
    });

    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: ["dep-real", "dep-ghost", "dep-phantom"] });

    expect(result["dep-real"]).toBeTruthy();
    expect(result["dep-ghost"]).toBeUndefined();
    expect(result["dep-phantom"]).toBeUndefined();
    expect(mockGetDeploymentStorageUsage).toHaveBeenCalledTimes(1);
  });

  it("handles getDeploymentStorageUsage throwing an error gracefully", async () => {
    seedDeployment({ id: "dep-err" });
    mockGetDeploymentStorageUsage.mockRejectedValue(new Error("K8s exec failed"));

    const caller = authedCaller();
    const result = await caller.deployment.getStorageUsageBatch({ ids: ["dep-err"] });

    // Should set result to null on error, not throw
    expect(result["dep-err"]).toBeNull();
  });

  it("respects the max 50 IDs limit", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `dep-${i}`);

    const caller = authedCaller();
    await expect(
      caller.deployment.getStorageUsageBatch({ ids })
    ).rejects.toThrow();
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.deployment.getStorageUsageBatch({ ids: ["dep-1"] })
    ).rejects.toThrow("You must be logged in");
  });
});
