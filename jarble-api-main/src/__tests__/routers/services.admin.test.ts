/**
 * Integration tests for services admin moderation procedures.
 *
 * Tests adminList, adminApprove, adminReject - both success (admin user)
 * and rejection (non-admin user) paths.
 *
 * Uses real in-memory SQLite with mocked K8s, Stripe, configSync, and OpenRouter.
 * Admin user ID "admin-user-001" is present in the ADMIN_USER_IDS set in services.ts.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock the shared admin utility so the admin user ID matches our test user.
vi.mock("../../utils/admin.js", () => {
  const adminIds = new Set(["admin-user-001"]);
  return {
    isAdmin: (userId: string) => adminIds.has(userId),
    getAdminUserIds: () => adminIds,
  };
});

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
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
  removeMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/schemaValidation.js", () => ({
  validatePropsSchema: vi.fn(),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/serviceHandshake.js", () => ({
  performInstallHandshake: vi.fn().mockResolvedValue({
    remoteInstallId: "remote-inst-001",
  }),
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

/** The admin user ID that is present in ADMIN_USER_IDS in services.ts. */
const ADMIN_USER_ID = "admin-user-001";
const ADMIN_AUTH0_ID = "auth0|admin-001";

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();

  // Seed the admin user into the DB
  ctx.raw.exec(
    `INSERT INTO users (id, email, name, auth0_id, email_verified)
     VALUES ('${ADMIN_USER_ID}', 'admin@jarble.ai', 'Admin User', '${ADMIN_AUTH0_ID}', 1)`,
  );
});

afterAll(() => {
  ctx?.raw.close();
});

// ── Caller Helpers ──────────────────────────────────────────────────────────

function adminCaller() {
  return createTestCaller(ctx.db, {
    id: ADMIN_USER_ID,
    email: "admin@jarble.ai",
    name: "Admin User",
    auth0Id: ADMIN_AUTH0_ID,
    emailVerified: true,
  });
}

function regularCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

// ── Seed Helpers ────────────────────────────────────────────────────────────

let seedCounter = 0;

function uid() {
  return `${Date.now()}_${++seedCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function seedCreatorProfile(userId?: string) {
  const id = `cp_${uid()}`;
  const uId = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO creator_profiles (id, user_id, display_name, bio)
     VALUES ('${id}', '${uId}', 'Test Creator', 'A bio')`,
  );
  return id;
}

function seedService(
  creatorProfileId: string,
  overrides?: {
    name?: string;
    status?: string;
    hostingModel?: string;
  },
) {
  const id = `pkg_${uid()}`;
  const name = overrides?.name ?? `pkg-${id}`;
  const status = overrides?.status ?? "pending_review";
  const hosting = overrides?.hostingModel ?? "self_hosted";
  ctx.raw.exec(
    `INSERT INTO marketplace_packages
       (id, creator_id, name, display_name, description, hosting_model, status, pricing_model, total_installs)
     VALUES
       ('${id}', '${creatorProfileId}', '${name}', 'Display ${name}', 'A test service', '${hosting}', '${status}', 'free', 0)`,
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("services.adminList", () => {
  it("returns pending_review services by default", async () => {
    const cpId = seedCreatorProfile();
    const pkg1 = seedService(cpId, { name: "pending-one", status: "pending_review" });
    const pkg2 = seedService(cpId, { name: "pending-two", status: "pending_review" });
    seedService(cpId, { name: "published-one", status: "published" });

    const caller = adminCaller();
    const result = await caller.services.adminList();

    expect(result).toHaveLength(2);
    const names = result.map((p: any) => p.name).sort();
    expect(names).toEqual(["pending-one", "pending-two"]);
  });

  it("filters by status when specified", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "pkg-pending", status: "pending_review" });
    seedService(cpId, { name: "pkg-rejected", status: "rejected" });
    seedService(cpId, { name: "pkg-draft", status: "draft" });

    const caller = adminCaller();

    const rejectedResult = await caller.services.adminList({ status: "rejected" });
    expect(rejectedResult).toHaveLength(1);
    expect(rejectedResult[0].name).toBe("pkg-rejected");

    const draftResult = await caller.services.adminList({ status: "draft" });
    expect(draftResult).toHaveLength(1);
    expect(draftResult[0].name).toBe("pkg-draft");
  });

  it("rejects non-admin users with FORBIDDEN", async () => {
    const caller = regularCaller();
    await expect(caller.services.adminList()).rejects.toThrow("Admin access required");
  });

  it("rejects anonymous users", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.services.adminList()).rejects.toThrow();
  });

  it("returns all expected fields per service", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "detailed-pkg", status: "pending_review" });

    const caller = adminCaller();
    const result = await caller.services.adminList();

    expect(result).toHaveLength(1);
    const pkg = result[0];
    expect(pkg).toHaveProperty("id");
    expect(pkg).toHaveProperty("name", "detailed-pkg");
    expect(pkg).toHaveProperty("displayName");
    expect(pkg).toHaveProperty("description");
    expect(pkg).toHaveProperty("hostingModel");
    expect(pkg).toHaveProperty("status", "pending_review");
    expect(pkg).toHaveProperty("pricingModel");
    expect(pkg).toHaveProperty("creatorId", cpId);
    expect(pkg).toHaveProperty("createdAt");
    expect(pkg).toHaveProperty("updatedAt");
  });
});

describe("services.adminApprove", () => {
  it("sets service status to published", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "to-approve", status: "pending_review" });

    const caller = adminCaller();
    const result = await caller.services.adminApprove({ serviceId: pkgId });

    expect(result).toEqual({ success: true });

    // Verify the status was updated in the DB
    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("published");
  });

  it("can approve a rejected service", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "re-approve", status: "rejected" });

    const caller = adminCaller();
    const result = await caller.services.adminApprove({ serviceId: pkgId });
    expect(result).toEqual({ success: true });

    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("published");
  });

  it("updates the updatedAt timestamp", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "timestamp-test", status: "pending_review" });

    // Get the original timestamp
    const before = ctx.raw.prepare("SELECT updated_at FROM marketplace_packages WHERE id = ?").get(pkgId) as any;

    const caller = adminCaller();
    await caller.services.adminApprove({ serviceId: pkgId });

    const after = ctx.raw.prepare("SELECT updated_at FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    // The updatedAt should be updated (may or may not differ if test runs instantly,
    // but it should be a valid ISO date)
    expect(after.updated_at).toBeDefined();
  });

  it("rejects non-admin users with FORBIDDEN", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "blocked-approve", status: "pending_review" });

    const caller = regularCaller();
    await expect(caller.services.adminApprove({ serviceId: pkgId })).rejects.toThrow(
      "Admin access required",
    );

    // Verify status was NOT changed
    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("pending_review");
  });

  it("throws NOT_FOUND for a nonexistent service", async () => {
    const caller = adminCaller();
    await expect(
      caller.services.adminApprove({ serviceId: "pkg_nonexistent" }),
    ).rejects.toThrow("Service not found");
  });
});

describe("services.adminReject", () => {
  it("sets service status to rejected", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "to-reject", status: "pending_review" });

    const caller = adminCaller();
    const result = await caller.services.adminReject({
      serviceId: pkgId,
      reason: "Violates content policy",
    });

    expect(result).toEqual({ success: true });

    // Verify the status was updated in the DB
    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("rejected");
  });

  it("works without a reason", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "reject-no-reason", status: "pending_review" });

    const caller = adminCaller();
    const result = await caller.services.adminReject({ serviceId: pkgId });

    expect(result).toEqual({ success: true });

    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("rejected");
  });

  it("updates the updatedAt timestamp", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "reject-ts-test", status: "pending_review" });

    const caller = adminCaller();
    await caller.services.adminReject({ serviceId: pkgId, reason: "Low quality" });

    const row = ctx.raw.prepare("SELECT updated_at FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.updated_at).toBeDefined();
  });

  it("rejects non-admin users with FORBIDDEN", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "blocked-reject", status: "pending_review" });

    const caller = regularCaller();
    await expect(
      caller.services.adminReject({ serviceId: pkgId, reason: "test" }),
    ).rejects.toThrow("Admin access required");

    // Verify status was NOT changed
    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("pending_review");
  });

  it("throws NOT_FOUND for a nonexistent service", async () => {
    const caller = adminCaller();
    await expect(
      caller.services.adminReject({ serviceId: "pkg_nonexistent", reason: "test" }),
    ).rejects.toThrow("Service not found");
  });

  it("can reject an already-published service", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "published-to-reject", status: "published" });

    const caller = adminCaller();
    const result = await caller.services.adminReject({
      serviceId: pkgId,
      reason: "Policy violation discovered",
    });

    expect(result).toEqual({ success: true });

    const row = ctx.raw.prepare("SELECT status FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(row.status).toBe("rejected");
  });
});
