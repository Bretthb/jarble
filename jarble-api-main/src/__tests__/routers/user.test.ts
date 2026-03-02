/**
 * Integration tests for the user tRPC router.
 *
 * Tests user.me, user.getProfile, user.updateProfile, user.completeProfile
 * against a real in-memory SQLite database.
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
  // Fresh DB for each test
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
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

describe("user.me", () => {
  it("returns the authenticated user context", async () => {
    const caller = authedCaller();
    const me = await caller.user.me();
    expect(me).toBeTruthy();
    expect(me!.id).toBe(ctx.testUserId);
    expect(me!.email).toBe("test@jarble.ai");
  });

  it("returns null for anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    const me = await caller.user.me();
    expect(me).toBeNull();
  });
});

describe("user.getProfile", () => {
  it("returns the full profile from DB", async () => {
    const caller = authedCaller();
    const profile = await caller.user.getProfile();
    expect(profile).toBeTruthy();
    expect(profile!.id).toBe(ctx.testUserId);
    expect(profile!.email).toBe("test@jarble.ai");
    expect(profile!.name).toBe("Test User");
    expect(profile!.emailVerified).toBe(true);
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.user.getProfile()).rejects.toThrow("You must be logged in");
  });
});

describe("user.updateProfile", () => {
  it("updates the user name", async () => {
    const caller = authedCaller();
    const updated = await caller.user.updateProfile({ name: "Updated Name" });
    expect(updated!.name).toBe("Updated Name");

    // Verify persisted in DB
    const profile = await caller.user.getProfile();
    expect(profile!.name).toBe("Updated Name");
  });

  it("rejects empty name", async () => {
    const caller = authedCaller();
    await expect(caller.user.updateProfile({ name: "" })).rejects.toThrow();
  });

  it("throws when called with no fields (Drizzle rejects empty updates)", async () => {
    const caller = authedCaller();
    await expect(caller.user.updateProfile({})).rejects.toThrow("No values to set");
  });
});

describe("user.completeProfile", () => {
  it("sets full name from first + last", async () => {
    const caller = authedCaller();
    const result = await caller.user.completeProfile({
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result!.name).toBe("Jane Doe");
  });

  it("rejects empty firstName", async () => {
    const caller = authedCaller();
    await expect(
      caller.user.completeProfile({ firstName: "", lastName: "Doe" })
    ).rejects.toThrow();
  });

  it("rejects empty lastName", async () => {
    const caller = authedCaller();
    await expect(
      caller.user.completeProfile({ firstName: "Jane", lastName: "" })
    ).rejects.toThrow();
  });
});
