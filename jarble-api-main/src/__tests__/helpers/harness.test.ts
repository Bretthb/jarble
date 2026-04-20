/**
 * Smoke test: verify the test harness (in-memory DB + tRPC caller) works.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { createTestDb } from "./testDb.js";
import { createTestCaller, createAnonymousCaller } from "./testCaller.js";

// Mock external deps that the routers import
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

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn().mockResolvedValue(undefined),
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
  const schema = await import("./testSchema.sqlite.js");
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

const { db, raw, testUserId, testAuth0Id } = createTestDb();

afterAll(() => {
  raw.close();
});

describe("test harness", () => {
  it("creates an in-memory database with tables", () => {
    // Check that the runtime_catalog table was seeded
    const runtimes = raw.prepare("SELECT * FROM runtime_catalog").all();
    expect(runtimes).toHaveLength(2);
  });

  it("creates a test user", () => {
    const users = raw.prepare("SELECT * FROM users").all();
    expect(users).toHaveLength(1);
  });

  it("creates an authenticated tRPC caller", async () => {
    const caller = createTestCaller(db, {
      id: testUserId,
      email: "test@jarble.ai",
      name: "Test User",
      auth0Id: testAuth0Id,
      emailVerified: true,
    });

    // user.me should return the mock user context
    const me = await caller.user.me();
    expect(me).toBeTruthy();
    expect(me!.id).toBe(testUserId);
  });

  it("creates an anonymous caller that rejects protected procedures", async () => {
    const caller = createAnonymousCaller(db);

    // user.me is now a protectedProcedure (JAR-33) - should throw
    await expect(caller.user.me()).rejects.toThrow("You must be logged in");

    // deployment.list is a protectedProcedure - should throw
    await expect(caller.deployment.list()).rejects.toThrow("You must be logged in");
  });
});
