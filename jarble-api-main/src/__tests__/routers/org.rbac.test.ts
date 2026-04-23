/**
 * RBAC tests for the organization system (JAR-58, subsection 1).
 *
 * Exhaustive role x action matrix covering Owner, Admin, Member, and
 * Non-member. Verifies BOTH the returned error code AND that the underlying
 * DB did or did not mutate — a silent-noop 200 is worse than a 403.
 *
 * Matrix (see JAR-58 description):
 *
 *   action                       Owner  Admin  Member  Non-member
 *   ---------------------------- -----  -----  ------  ----------
 *   deployment.getById           200    200    200     404
 *   deployment.create (in org)   200    200    403     403
 *   deployment.start             200    200    403     403
 *   deployment.stop              200    200    403     403
 *   deployment.delete            200    200    403     403
 *   deployment.list (all)        shown  shown  shown   hidden
 *   deployment.list (admin)      shown  shown  hidden  hidden
 *   org.update                   200    200    403     403
 *   org.delete                   200    403    403     403
 *   org.invite                   200    200    403     403
 *   org.removeMember             200    200    403     403
 *   org.updateMemberRole         200    403    403     403
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mirrors the mock set used by deployment.access.test.ts and deployment.test.ts
// so routers that import K8s/Stripe/OpenRouter/configSync resolve cleanly.

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20, percentUsed: 5 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "hello", podName: "pod-1" }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
  appsApi: {},
  NAMESPACE: "jarble-test",
}));

vi.mock("../../k8s/nodeManager.js", () => ({
  ensureCapacityForDeployment: vi.fn().mockResolvedValue(undefined),
  checkScaleDown: vi.fn().mockResolvedValue(undefined),
  getCapacityStatus: vi.fn().mockResolvedValue({ totalNodes: 0, managedNodes: 0, maxManagedNodes: 0, availableSlots: 0, nodes: [] }),
  CapacityError: class CapacityError extends Error {},
  SERVER_TYPES: [{ usableLonghornGb: 500 }],
}));

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/lifecycleJobs.js", () => ({
  enqueueLifecycleJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/email.js", () => ({
  sendOrgInviteEmail: vi.fn().mockResolvedValue(true),
  sendBetaWelcomeEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash" }),
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

// Re-point the db/index.js module at the test SQLite schema so Drizzle
// column references resolve to the in-memory schema rather than the real
// Postgres one. Same pattern as deployment.access.test.ts.
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

// The org router dynamically imports `../../db/schema.pg.js` at runtime to
// pick up Drizzle table refs. Point that import at the sqlite mirror so the
// role helpers (requireOrgMembership, requireOrgRole) query the correct
// in-memory tables.
vi.mock("../../db/schema.pg.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return schema;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

let ctx: TestDbContext;

const ORG_ID = "org-rbac";
const OWNER_ID = "user-owner";
const OWNER_AUTH0 = "auth0|owner";
const OWNER_EMAIL = "owner@test.com";
const ADMIN_ID = "user-admin";
const ADMIN_AUTH0 = "auth0|admin";
const ADMIN_EMAIL = "admin@test.com";
const MEMBER_ID = "user-member";
const MEMBER_AUTH0 = "auth0|member";
const MEMBER_EMAIL = "member@test.com";
const OUTSIDER_ID = "user-outsider";
const OUTSIDER_AUTH0 = "auth0|outsider";
const OUTSIDER_EMAIL = "outsider@test.com";

const ORG_DEPLOYMENT_ID = "dep-rbac-org";
const ADMIN_VISIBLE_DEP_ID = "dep-rbac-admin-only";

/** Seed a full org scenario: 3 users in the org (owner/admin/member), 1 outsider, 1 org-owned deployment. */
function seedOrg() {
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES
      ('${OWNER_ID}', '${OWNER_EMAIL}', 'Owner', '${OWNER_AUTH0}', 1),
      ('${ADMIN_ID}', '${ADMIN_EMAIL}', 'Admin', '${ADMIN_AUTH0}', 1),
      ('${MEMBER_ID}', '${MEMBER_EMAIL}', 'Member', '${MEMBER_AUTH0}', 1),
      ('${OUTSIDER_ID}', '${OUTSIDER_EMAIL}', 'Outsider', '${OUTSIDER_AUTH0}', 1);
  `);

  ctx.raw.exec(`
    INSERT INTO organizations (id, name, slug, owner_id) VALUES
      ('${ORG_ID}', 'RBAC Test Org', 'rbac-test-org', '${OWNER_ID}');
    INSERT INTO org_members (id, org_id, user_id, role) VALUES
      ('m-owner',  '${ORG_ID}', '${OWNER_ID}',  'owner'),
      ('m-admin',  '${ORG_ID}', '${ADMIN_ID}',  'admin'),
      ('m-member', '${ORG_ID}', '${MEMBER_ID}', 'member');
  `);

  // One org-owned deployment with default visibility=all (created by owner).
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ORG_DEPLOYMENT_ID,
    OWNER_ID,
    "Shared Bot",
    "openclaw",
    ctx.openclawCatalogId,
    "running",
    "byok",
    "openrouter",
    "legacy",
    ORG_ID,
    "all",
  );

  // Second org deployment with visibility=admin (for visibility matrix).
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ADMIN_VISIBLE_DEP_ID,
    OWNER_ID,
    "Admin-Only Bot",
    "openclaw",
    ctx.openclawCatalogId,
    "running",
    "byok",
    "openrouter",
    "legacy",
    ORG_ID,
    "admin",
  );
}

function callerFor(userId: string, auth0Id: string, email: string) {
  return createTestCaller(ctx.db, {
    id: userId,
    email,
    name: userId,
    auth0Id,
    emailVerified: true,
  });
}

const ownerCaller    = () => callerFor(OWNER_ID,    OWNER_AUTH0,    OWNER_EMAIL);
const adminCaller    = () => callerFor(ADMIN_ID,    ADMIN_AUTH0,    ADMIN_EMAIL);
const memberCaller   = () => callerFor(MEMBER_ID,   MEMBER_AUTH0,   MEMBER_EMAIL);
const outsiderCaller = () => callerFor(OUTSIDER_ID, OUTSIDER_AUTH0, OUTSIDER_EMAIL);

// ── DB introspection helpers ──────────────────────────────────────────────
// These read raw SQL so they're independent of the code under test — a
// silent-noop 200 in the router will be caught because the DB row didn't
// actually change.

function getDeployment(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id);
}

function getOrg(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id);
}

function getMember(orgId: string, userId: string): any {
  return ctx.raw.prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId);
}

function countInvites(orgId: string): number {
  return (ctx.raw.prepare(`SELECT COUNT(*) as c FROM org_invites WHERE org_id = ?`).get(orgId) as any).c;
}

function countMembers(orgId: string): number {
  return (ctx.raw.prepare(`SELECT COUNT(*) as c FROM org_members WHERE org_id = ?`).get(orgId) as any).c;
}

function countDeployments(orgId: string): number {
  return (ctx.raw.prepare(`SELECT COUNT(*) as c FROM deployments WHERE org_id = ?`).get(orgId) as any).c;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  seedOrg();
});

afterAll(() => {
  ctx?.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("JAR-58 RBAC: deployment.getById", () => {
  it("owner: 200", async () => {
    const result = await ownerCaller().deployment.getById({ id: ORG_DEPLOYMENT_ID });
    expect(result).toBeTruthy();
    expect(result!.id).toBe(ORG_DEPLOYMENT_ID);
  });

  it("admin: 200", async () => {
    const result = await adminCaller().deployment.getById({ id: ORG_DEPLOYMENT_ID });
    expect(result).toBeTruthy();
    expect(result!.id).toBe(ORG_DEPLOYMENT_ID);
  });

  it("member: 200", async () => {
    const result = await memberCaller().deployment.getById({ id: ORG_DEPLOYMENT_ID });
    expect(result).toBeTruthy();
    expect(result!.id).toBe(ORG_DEPLOYMENT_ID);
  });

  it("non-member: NOT_FOUND (not FORBIDDEN — must not leak existence)", async () => {
    await expect(
      outsiderCaller().deployment.getById({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("JAR-58 RBAC: deployment.create (assigned to org)", () => {
  const makePayload = () => ({
    name: "New Org Bot",
    runtimeCatalogId: ctx.openclawCatalogId,
    llmMode: "byok" as const,
    llmProvider: "openrouter" as const,
    llmApiKey: "sk-or-test",
    orgId: ORG_ID,
  });

  it("owner: 200 and row persisted with orgId", async () => {
    const before = countDeployments(ORG_ID);
    const result = await ownerCaller().deployment.create(makePayload());
    expect(result).toBeTruthy();
    expect(result!.orgId).toBe(ORG_ID);
    expect(countDeployments(ORG_ID)).toBe(before + 1);
  });

  it("admin: 200 and row persisted with orgId", async () => {
    const before = countDeployments(ORG_ID);
    const result = await adminCaller().deployment.create(makePayload());
    expect(result).toBeTruthy();
    expect(result!.orgId).toBe(ORG_ID);
    expect(countDeployments(ORG_ID)).toBe(before + 1);
  });

  it("member: FORBIDDEN and DB unchanged", async () => {
    const before = countDeployments(ORG_ID);
    await expect(
      memberCaller().deployment.create(makePayload()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(countDeployments(ORG_ID)).toBe(before);
  });

  it("non-member: FORBIDDEN and DB unchanged", async () => {
    const before = countDeployments(ORG_ID);
    await expect(
      outsiderCaller().deployment.create(makePayload()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(countDeployments(ORG_ID)).toBe(before);
  });
});

describe("JAR-58 RBAC: deployment.start", () => {
  // start() requires status == "stopped" or "failed" — set up accordingly.
  beforeEach(() => {
    ctx.raw.prepare(`UPDATE deployments SET status = 'stopped' WHERE id = ?`).run(ORG_DEPLOYMENT_ID);
  });

  it("owner: 200 and status transitions to creating", async () => {
    const result = await ownerCaller().deployment.start({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("creating");
  });

  it("admin: 200 and status transitions to creating", async () => {
    const result = await adminCaller().deployment.start({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("creating");
  });

  it("member: FORBIDDEN and status unchanged", async () => {
    await expect(
      memberCaller().deployment.start({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("stopped");
  });

  it("non-member: NOT_FOUND (via findDeploymentWithAccess) and status unchanged", async () => {
    // Non-member gets NOT_FOUND before the role check runs — verify no mutation either way.
    await expect(
      outsiderCaller().deployment.start({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("stopped");
  });
});

describe("JAR-58 RBAC: deployment.stop", () => {
  // stop() requires status == "running" — the seed already sets it there.

  it("owner: 200 and status transitions to stopped", async () => {
    const result = await ownerCaller().deployment.stop({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("stopped");
  });

  it("admin: 200 and status transitions to stopped", async () => {
    const result = await adminCaller().deployment.stop({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("stopped");
  });

  it("member: FORBIDDEN and status unchanged (still running)", async () => {
    await expect(
      memberCaller().deployment.stop({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("running");
  });

  it("non-member: NOT_FOUND and status unchanged", async () => {
    await expect(
      outsiderCaller().deployment.stop({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getDeployment(ORG_DEPLOYMENT_ID).status).toBe("running");
  });
});

describe("JAR-58 RBAC: deployment.delete", () => {
  it("owner: 200 and row removed", async () => {
    const result = await ownerCaller().deployment.delete({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID)).toBeUndefined();
  });

  it("admin: 200 and row removed", async () => {
    const result = await adminCaller().deployment.delete({ id: ORG_DEPLOYMENT_ID });
    expect(result).toEqual({ success: true });
    expect(getDeployment(ORG_DEPLOYMENT_ID)).toBeUndefined();
  });

  it("member: FORBIDDEN and row still exists", async () => {
    await expect(
      memberCaller().deployment.delete({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDeployment(ORG_DEPLOYMENT_ID)).toBeTruthy();
  });

  it("non-member: NOT_FOUND and row still exists", async () => {
    await expect(
      outsiderCaller().deployment.delete({ id: ORG_DEPLOYMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getDeployment(ORG_DEPLOYMENT_ID)).toBeTruthy();
  });
});

describe("JAR-58 RBAC: deployment.list visibility", () => {
  // The seed includes two org deployments:
  //   ORG_DEPLOYMENT_ID        — visibility=all
  //   ADMIN_VISIBLE_DEP_ID     — visibility=admin
  // Owner/admin should see both. Member sees only "all". Non-member sees neither.

  it("owner: sees visibility=all AND visibility=admin", async () => {
    const list = await ownerCaller().deployment.list();
    const ids = list.map((d: any) => d.id);
    expect(ids).toContain(ORG_DEPLOYMENT_ID);
    expect(ids).toContain(ADMIN_VISIBLE_DEP_ID);
  });

  it("admin: sees visibility=all AND visibility=admin", async () => {
    const list = await adminCaller().deployment.list();
    const ids = list.map((d: any) => d.id);
    expect(ids).toContain(ORG_DEPLOYMENT_ID);
    expect(ids).toContain(ADMIN_VISIBLE_DEP_ID);
  });

  it("member: sees visibility=all, does NOT see visibility=admin", async () => {
    const list = await memberCaller().deployment.list();
    const ids = list.map((d: any) => d.id);
    expect(ids).toContain(ORG_DEPLOYMENT_ID);
    expect(ids).not.toContain(ADMIN_VISIBLE_DEP_ID);
  });

  it("non-member: sees NEITHER org deployment", async () => {
    const list = await outsiderCaller().deployment.list();
    const ids = list.map((d: any) => d.id);
    expect(ids).not.toContain(ORG_DEPLOYMENT_ID);
    expect(ids).not.toContain(ADMIN_VISIBLE_DEP_ID);
  });
});

describe("JAR-58 RBAC: org.update", () => {
  const NEW_NAME = "Renamed RBAC Org";

  it("owner: 200 and name persisted", async () => {
    const result = await ownerCaller().org.update({ orgId: ORG_ID, name: NEW_NAME });
    expect(result).toEqual({ success: true });
    expect(getOrg(ORG_ID).name).toBe(NEW_NAME);
  });

  it("admin: 200 and name persisted", async () => {
    const result = await adminCaller().org.update({ orgId: ORG_ID, name: NEW_NAME });
    expect(result).toEqual({ success: true });
    expect(getOrg(ORG_ID).name).toBe(NEW_NAME);
  });

  it("member: FORBIDDEN and name unchanged", async () => {
    const before = getOrg(ORG_ID).name;
    await expect(
      memberCaller().org.update({ orgId: ORG_ID, name: NEW_NAME }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrg(ORG_ID).name).toBe(before);
  });

  it("non-member: FORBIDDEN and name unchanged", async () => {
    const before = getOrg(ORG_ID).name;
    await expect(
      outsiderCaller().org.update({ orgId: ORG_ID, name: NEW_NAME }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrg(ORG_ID).name).toBe(before);
  });
});

describe("JAR-58 RBAC: org.delete", () => {
  it("owner: 200 and org row removed", async () => {
    const result = await ownerCaller().org.delete({ orgId: ORG_ID });
    expect(result).toEqual({ success: true });
    expect(getOrg(ORG_ID)).toBeUndefined();
  });

  it("admin: FORBIDDEN and org row still exists", async () => {
    await expect(
      adminCaller().org.delete({ orgId: ORG_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrg(ORG_ID)).toBeTruthy();
  });

  it("member: FORBIDDEN and org row still exists", async () => {
    await expect(
      memberCaller().org.delete({ orgId: ORG_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrg(ORG_ID)).toBeTruthy();
  });

  it("non-member: FORBIDDEN and org row still exists", async () => {
    await expect(
      outsiderCaller().org.delete({ orgId: ORG_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrg(ORG_ID)).toBeTruthy();
  });
});

describe("JAR-58 RBAC: org.invite", () => {
  const INVITE_EMAIL = "invitee@test.com";

  it("owner: 200 and invite row created", async () => {
    const before = countInvites(ORG_ID);
    const result = await ownerCaller().org.invite({ orgId: ORG_ID, email: INVITE_EMAIL });
    expect(result).toMatchObject({ inviteId: expect.any(String), token: expect.any(String) });
    expect(countInvites(ORG_ID)).toBe(before + 1);
  });

  it("admin: 200 and invite row created", async () => {
    const before = countInvites(ORG_ID);
    const result = await adminCaller().org.invite({ orgId: ORG_ID, email: INVITE_EMAIL });
    expect(result).toMatchObject({ inviteId: expect.any(String), token: expect.any(String) });
    expect(countInvites(ORG_ID)).toBe(before + 1);
  });

  it("member: FORBIDDEN and no invite created", async () => {
    const before = countInvites(ORG_ID);
    await expect(
      memberCaller().org.invite({ orgId: ORG_ID, email: INVITE_EMAIL }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(countInvites(ORG_ID)).toBe(before);
  });

  it("non-member: FORBIDDEN and no invite created", async () => {
    const before = countInvites(ORG_ID);
    await expect(
      outsiderCaller().org.invite({ orgId: ORG_ID, email: INVITE_EMAIL }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(countInvites(ORG_ID)).toBe(before);
  });
});

describe("JAR-58 RBAC: org.removeMember", () => {
  // Owners and admins should be able to remove the member; others should be blocked.

  it("owner: 200 and membership row removed", async () => {
    const before = countMembers(ORG_ID);
    const result = await ownerCaller().org.removeMember({ orgId: ORG_ID, userId: MEMBER_ID });
    expect(result).toEqual({ success: true });
    expect(getMember(ORG_ID, MEMBER_ID)).toBeUndefined();
    expect(countMembers(ORG_ID)).toBe(before - 1);
  });

  it("admin: 200 and membership row removed", async () => {
    const before = countMembers(ORG_ID);
    const result = await adminCaller().org.removeMember({ orgId: ORG_ID, userId: MEMBER_ID });
    expect(result).toEqual({ success: true });
    expect(getMember(ORG_ID, MEMBER_ID)).toBeUndefined();
    expect(countMembers(ORG_ID)).toBe(before - 1);
  });

  it("member: FORBIDDEN when attempting to remove another member; membership untouched", async () => {
    // Add a second member (target) so "member removes another member" is the operation under test.
    ctx.raw.exec(`
      INSERT INTO users (id, email, name, auth0_id, email_verified)
      VALUES ('user-member2', 'member2@test.com', 'Member2', 'auth0|member2', 1);
      INSERT INTO org_members (id, org_id, user_id, role)
      VALUES ('m-member2', '${ORG_ID}', 'user-member2', 'member');
    `);
    const before = countMembers(ORG_ID);

    await expect(
      memberCaller().org.removeMember({ orgId: ORG_ID, userId: "user-member2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getMember(ORG_ID, "user-member2")).toBeTruthy();
    expect(countMembers(ORG_ID)).toBe(before);
  });

  it("non-member: FORBIDDEN and membership untouched", async () => {
    const before = countMembers(ORG_ID);
    await expect(
      outsiderCaller().org.removeMember({ orgId: ORG_ID, userId: MEMBER_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMember(ORG_ID, MEMBER_ID)).toBeTruthy();
    expect(countMembers(ORG_ID)).toBe(before);
  });
});

describe("JAR-58 RBAC: org.updateMemberRole", () => {
  it("owner: 200 and member's role persisted", async () => {
    const result = await ownerCaller().org.updateMemberRole({ orgId: ORG_ID, userId: MEMBER_ID, role: "admin" });
    expect(result).toEqual({ success: true });
    expect(getMember(ORG_ID, MEMBER_ID).role).toBe("admin");
  });

  it("admin: FORBIDDEN and role unchanged (owner-only)", async () => {
    await expect(
      adminCaller().org.updateMemberRole({ orgId: ORG_ID, userId: MEMBER_ID, role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMember(ORG_ID, MEMBER_ID).role).toBe("member");
  });

  it("member: FORBIDDEN and role unchanged", async () => {
    // Seed a second member so we have a distinct target.
    ctx.raw.exec(`
      INSERT INTO users (id, email, name, auth0_id, email_verified)
      VALUES ('user-member2', 'member2@test.com', 'Member2', 'auth0|member2', 1);
      INSERT INTO org_members (id, org_id, user_id, role)
      VALUES ('m-member2', '${ORG_ID}', 'user-member2', 'member');
    `);

    await expect(
      memberCaller().org.updateMemberRole({ orgId: ORG_ID, userId: "user-member2", role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMember(ORG_ID, "user-member2").role).toBe("member");
  });

  it("non-member: FORBIDDEN and role unchanged", async () => {
    await expect(
      outsiderCaller().org.updateMemberRole({ orgId: ORG_ID, userId: MEMBER_ID, role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMember(ORG_ID, MEMBER_ID).role).toBe("member");
  });
});
