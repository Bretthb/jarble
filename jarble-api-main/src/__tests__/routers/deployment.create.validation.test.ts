/**
 * Wave 4 Layer A — pre-flight PVC size validation in deployment.create.
 *
 * The largest Hetzner autoscaler tier (cpx51) has a 360 GiB root disk
 * but only ~345 GiB is usable for Longhorn replicas after overhead.
 * Requesting more storage than that would otherwise hang the deploy
 * forever on Longhorn LocalReplicaSchedulingFailure with no actionable
 * error. These tests verify that deployment.create rejects oversize
 * storageMb values upfront with a clear TRPCError BAD_REQUEST.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

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

function authedCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

// Pulled from SERVER_TYPES so this stays in sync with the tier table
// (deployment.ts now imports SERVER_TYPES.at(-1)!.usableLonghornGb instead
// of hardcoding the number — this test mirrors that approach).
import { SERVER_TYPES } from "../../k8s/nodeManager.js";
const LARGEST_TIER_USABLE_GB = SERVER_TYPES[SERVER_TYPES.length - 1]!.usableLonghornGb;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deployment.create — PVC size pre-flight validation", () => {
  it("ACCEPTS storageMb within budget (20 GiB default)", async () => {
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "Within Budget Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key",
      storageMb: 20,
    });

    expect(result).toBeTruthy();
    expect(result!.name).toBe("Within Budget Bot");
    expect(result!.status).toBe("pending");
  });

  it("ACCEPTS storageMb exactly at the largest-tier usable limit", async () => {
    // Boundary: requestedGb === LARGEST_TIER_USABLE_GB must pass.
    const caller = authedCaller();
    const result = await caller.deployment.create({
      name: "Edge Bot",
      runtimeCatalogId: ctx.openclawCatalogId,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmApiKey: "sk-or-key",
      storageMb: LARGEST_TIER_USABLE_GB,
    });

    expect(result).toBeTruthy();
    expect(result!.storageMb).toBe(LARGEST_TIER_USABLE_GB);
  });

  it("REJECTS storageMb above the largest-tier usable limit with BAD_REQUEST", async () => {
    const caller = authedCaller();
    // Must be > LARGEST_TIER_USABLE_GB (~349) but <= 500 so that the router's
    // PVC pre-flight validation fires instead of Zod's hard max(500) cap.
    const oversize = LARGEST_TIER_USABLE_GB + 1;

    await expect(
      caller.deployment.create({
        name: "Oversize Bot",
        runtimeCatalogId: ctx.openclawCatalogId,
        llmMode: "byok",
        llmProvider: "openrouter",
        llmApiKey: "sk-or-key",
        storageMb: oversize,
      })
    ).rejects.toMatchObject({
      // tRPC wraps thrown TRPCError; both message + code are surfaced
      message: expect.stringContaining(`${oversize} GiB`),
    });

    // Re-run to assert the message also contains the max number, since
    // matchObject only checks one substring at a time.
    await expect(
      caller.deployment.create({
        name: "Oversize Bot 2",
        runtimeCatalogId: ctx.openclawCatalogId,
        llmMode: "byok",
        llmProvider: "openrouter",
        llmApiKey: "sk-or-key",
        storageMb: oversize,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(`${LARGEST_TIER_USABLE_GB} GiB`),
    });

    // And the BAD_REQUEST code.
    await expect(
      caller.deployment.create({
        name: "Oversize Bot 3",
        runtimeCatalogId: ctx.openclawCatalogId,
        llmMode: "byok",
        llmProvider: "openrouter",
        llmApiKey: "sk-or-key",
        storageMb: oversize,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("REJECTS storageMb just one above the largest-tier usable limit", async () => {
    // Off-by-one boundary: LARGEST_TIER_USABLE_GB + 1 must fail.
    const caller = authedCaller();
    await expect(
      caller.deployment.create({
        name: "Off By One Bot",
        runtimeCatalogId: ctx.openclawCatalogId,
        llmMode: "byok",
        llmProvider: "openrouter",
        llmApiKey: "sk-or-key",
        storageMb: LARGEST_TIER_USABLE_GB + 1,
      })
    ).rejects.toThrow(/exceeds the maximum available/i);
  });
});
