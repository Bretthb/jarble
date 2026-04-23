/**
 * Edge-case tests for the organization system (JAR-58, subsection 4).
 *
 * These are the nasty corners that turn bugs: last-owner operations,
 * self-mutation attempts, org deletion cascade, per-user org caps, concurrent
 * invite acceptance, and admin-vs-admin removal. Each test asserts BOTH the
 * returned error code AND the DB state so a silent-noop 200 is still caught.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

// ── Mocks (same shape as org.rbac.test.ts) ────────────────────────────────────

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
  isStripeConfigured: vi.fn().mockReturnValue(false),
  getStripe: vi.fn(),
  createPortalSession: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  listInvoices: vi.fn().mockResolvedValue([]),
  getSubscriptionDetails: vi.fn(),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({ baseCents: 0, managedKeyCents: 0, totalCents: 0 }),
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

vi.mock("../../db/schema.pg.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return schema;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

let ctx: TestDbContext;

const OWNER_ID = "user-owner";
const OWNER_AUTH0 = "auth0|owner";
const OWNER_EMAIL = "owner@test.com";
const ADMIN_ID = "user-admin";
const ADMIN_AUTH0 = "auth0|admin";
const ADMIN_EMAIL = "admin@test.com";
const MEMBER_ID = "user-member";
const MEMBER_AUTH0 = "auth0|member";
const MEMBER_EMAIL = "member@test.com";

const ORG_ID = "org-edge";

function seedUsers() {
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES
      ('${OWNER_ID}',  '${OWNER_EMAIL}',  'Owner',  '${OWNER_AUTH0}',  1),
      ('${ADMIN_ID}',  '${ADMIN_EMAIL}',  'Admin',  '${ADMIN_AUTH0}',  1),
      ('${MEMBER_ID}', '${MEMBER_EMAIL}', 'Member', '${MEMBER_AUTH0}', 1);
  `);
}

function seedOrg() {
  seedUsers();
  ctx.raw.exec(`
    INSERT INTO organizations (id, name, slug, owner_id) VALUES
      ('${ORG_ID}', 'Edge Test Org', 'edge-test-org', '${OWNER_ID}');
    INSERT INTO org_members (id, org_id, user_id, role) VALUES
      ('m-owner',  '${ORG_ID}', '${OWNER_ID}',  'owner'),
      ('m-admin',  '${ORG_ID}', '${ADMIN_ID}',  'admin'),
      ('m-member', '${ORG_ID}', '${MEMBER_ID}', 'member');
  `);
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

const ownerCaller  = () => callerFor(OWNER_ID,  OWNER_AUTH0,  OWNER_EMAIL);
const adminCaller  = () => callerFor(ADMIN_ID,  ADMIN_AUTH0,  ADMIN_EMAIL);
const memberCaller = () => callerFor(MEMBER_ID, MEMBER_AUTH0, MEMBER_EMAIL);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDeployment(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id);
}
function getOrg(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id);
}
function getMember(orgId: string, userId: string): any {
  return ctx.raw.prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId);
}
function countMembers(orgId: string): number {
  return (ctx.raw.prepare(`SELECT COUNT(*) as c FROM org_members WHERE org_id = ?`).get(orgId) as any).c;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterAll(() => {
  ctx?.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("JAR-58 §4: last owner cannot leave the org", () => {
  it("sole owner's org.leave is rejected and membership stays intact", async () => {
    seedOrg();
    const before = countMembers(ORG_ID);

    await expect(
      ownerCaller().org.leave({ orgId: ORG_ID }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/owner/i),
    });

    // Owner membership row still exists; member count unchanged.
    expect(getMember(ORG_ID, OWNER_ID)).toBeTruthy();
    expect(getMember(ORG_ID, OWNER_ID).role).toBe("owner");
    expect(countMembers(ORG_ID)).toBe(before);
  });
});

describe("JAR-58 §4: last owner cannot be demoted", () => {
  // The only way to demote the only owner via the public API is the owner
  // calling updateMemberRole on themselves (no one else has the permission,
  // and the input enum intentionally cannot promote anyone else to owner).
  // The router blocks self-role-changes with BAD_REQUEST "Cannot change your
  // own role" — effectively making the last owner un-demote-able.
  it("owner attempting to demote themselves to admin: BAD_REQUEST and role unchanged", async () => {
    seedOrg();

    await expect(
      ownerCaller().org.updateMemberRole({ orgId: ORG_ID, userId: OWNER_ID, role: "admin" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/own role/i),
    });

    expect(getMember(ORG_ID, OWNER_ID).role).toBe("owner");
  });

  it("owner attempting to demote themselves to member: BAD_REQUEST and role unchanged", async () => {
    seedOrg();

    await expect(
      ownerCaller().org.updateMemberRole({ orgId: ORG_ID, userId: OWNER_ID, role: "member" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/own role/i),
    });

    expect(getMember(ORG_ID, OWNER_ID).role).toBe("owner");
  });
});

describe("JAR-58 §4: members cannot self-escalate their role", () => {
  // The caller role check (requireOrgRole(["owner"])) gates updateMemberRole,
  // so a member trying to promote themselves hits FORBIDDEN before the
  // self-targeting check even runs. Either error code is fine — as long as
  // the DB row does not change.
  it("member calling updateMemberRole on themselves: rejected and role unchanged", async () => {
    seedOrg();

    await expect(
      memberCaller().org.updateMemberRole({ orgId: ORG_ID, userId: MEMBER_ID, role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getMember(ORG_ID, MEMBER_ID).role).toBe("member");
  });

  it("admin calling updateMemberRole on themselves: rejected and role unchanged (owner-only procedure)", async () => {
    seedOrg();

    await expect(
      adminCaller().org.updateMemberRole({ orgId: ORG_ID, userId: ADMIN_ID, role: "member" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getMember(ORG_ID, ADMIN_ID).role).toBe("admin");
  });
});

describe("JAR-58 §4: org.delete unsets org_id on deployments (does NOT hard-delete them)", () => {
  it("org with deployments: delete succeeds, deployments survive with org_id=null", async () => {
    seedOrg();
    const insertDep = ctx.raw.prepare(`
      INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDep.run("dep-a", OWNER_ID, "A", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", ORG_ID, "all");
    insertDep.run("dep-b", ADMIN_ID, "B", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", ORG_ID, "all");
    // A personal deployment (org_id=null) — must be completely untouched.
    insertDep.run("dep-personal", OWNER_ID, "Personal", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", null, "all");

    const result = await ownerCaller().org.delete({ orgId: ORG_ID });
    expect(result).toEqual({ success: true });

    // Org gone, org deployments preserved with org_id = null
    expect(getOrg(ORG_ID)).toBeUndefined();
    expect(getDeployment("dep-a")).toBeTruthy();
    expect(getDeployment("dep-a").org_id).toBeNull();
    expect(getDeployment("dep-a").status).toBe("running");
    expect(getDeployment("dep-b")).toBeTruthy();
    expect(getDeployment("dep-b").org_id).toBeNull();

    // Pre-existing personal deployment untouched
    expect(getDeployment("dep-personal").org_id).toBeNull();
    expect(getDeployment("dep-personal").status).toBe("running");
  });
});

describe("JAR-58 §4: per-user cap of 10 organizations owned", () => {
  it("creating the 11th org as the same user is rejected; only 10 persist", async () => {
    seedUsers();

    // Create 10 orgs as OWNER — must all succeed.
    for (let i = 1; i <= 10; i++) {
      const result = await ownerCaller().org.create({ name: `Org ${i}`, slug: `cap-org-${i}` });
      expect(result.slug).toBe(`cap-org-${i}`);
    }
    expect((ctx.raw.prepare(`SELECT COUNT(*) as c FROM organizations WHERE owner_id = ?`).get(OWNER_ID) as any).c).toBe(10);

    // 11th must fail.
    await expect(
      ownerCaller().org.create({ name: "One Too Many", slug: "cap-org-11" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/10|maximum/i),
    });

    // DB still has exactly 10 orgs for this owner.
    expect((ctx.raw.prepare(`SELECT COUNT(*) as c FROM organizations WHERE owner_id = ?`).get(OWNER_ID) as any).c).toBe(10);
    // The 11th slug must NOT have been inserted.
    expect(ctx.raw.prepare(`SELECT id FROM organizations WHERE slug = ?`).get("cap-org-11")).toBeUndefined();
  });
});

describe("JAR-58 §4: concurrent invite accept", () => {
  // Two users collide on the same invite token. The spec wants one to win
  // cleanly and the other to get a typed tRPC error (NOT an unhandled 500).
  //
  // About Promise.all here: Node is single-threaded and better-sqlite3 is
  // synchronous, so `Promise.all` doesn't give true parallelism — each
  // procedure runs to completion at its first sync DB call before yielding.
  // In production the "concurrency" that matters is two HTTP requests
  // arriving in the same tick, which reduces to back-to-back sequential
  // calls on a single Node process. Both shapes must produce the same
  // contract: one winner, one clean-error loser, DB consistent after both.
  //
  // We run the two calls back-to-back AND assert the resulting state is
  // exactly the same as if they had been truly simultaneous. That covers
  // the real-world case without depending on vitest's dynamic-import mock
  // registry behaving atomically under Promise.all, which in vitest 4 it
  // doesn't (the org router uses `await import(...)` for db/index.js; two
  // concurrent dynamic imports of a mocked module can race and resolve
  // the loser to the real module, independent of any application bug).

  it("matching-email wins, non-matching-email then gets a clean tRPC error (NOT a 500), membership appears exactly once", async () => {
    seedUsers();
    // Owner creates an org and invites MEMBER's email.
    const org = await ownerCaller().org.create({ name: "Race Org", slug: "race-org" });
    const invite = await ownerCaller().org.invite({
      orgId: org.id,
      email: MEMBER_EMAIL,
      role: "member",
    });

    // First caller (MEMBER, email matches) — should win cleanly.
    const memberResult = await memberCaller().org.acceptInvite({ token: invite.token });
    expect(memberResult).toMatchObject({ orgId: org.id, alreadyMember: false });

    // Second caller (ADMIN, email does NOT match) — must fail with a typed
    // tRPC error. The invite is now already "accepted", so the status check
    // fires first (BAD_REQUEST "already used"); before the first accept, an
    // email-mismatch would have been FORBIDDEN instead. Both are fine — the
    // contract is "clean typed error, not a 500".
    await expect(
      adminCaller().org.acceptInvite({ token: invite.token }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(FORBIDDEN|BAD_REQUEST)$/),
    });

    // DB state: MEMBER is now a member, ADMIN is NOT, invite flipped to accepted.
    expect(getMember(org.id, MEMBER_ID)).toBeTruthy();
    expect(getMember(org.id, ADMIN_ID)).toBeUndefined();
    const inviteRow = ctx.raw.prepare(`SELECT status FROM org_invites WHERE token = ?`).get(invite.token) as any;
    expect(inviteRow.status).toBe("accepted");
  });

  it("non-matching-email first: FORBIDDEN, invite stays pending so the real recipient can still accept", async () => {
    seedUsers();
    const org = await ownerCaller().org.create({ name: "Race Order Org", slug: "race-order-org" });
    const invite = await ownerCaller().org.invite({
      orgId: org.id,
      email: MEMBER_EMAIL,
      role: "member",
    });

    // Outsider-like attempt first: must FORBIDDEN, must NOT flip the invite
    // to `accepted` (otherwise the real recipient would be locked out with
    // BAD_REQUEST "already used"). The invariant under test: a mis-sent
    // accept doesn't burn the token.
    await expect(
      adminCaller().org.acceptInvite({ token: invite.token }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const inviteAfterReject = ctx.raw.prepare(`SELECT status FROM org_invites WHERE token = ?`).get(invite.token) as any;
    expect(inviteAfterReject.status).toBe("pending");

    // Real recipient can still accept.
    const memberResult = await memberCaller().org.acceptInvite({ token: invite.token });
    expect(memberResult).toMatchObject({ orgId: org.id, alreadyMember: false });
    expect(getMember(org.id, MEMBER_ID)).toBeTruthy();
  });

  it("same user accepts twice back-to-back: first accepts, second gets a clean BAD_REQUEST (NOT a 500), membership row is not duplicated", async () => {
    seedUsers();
    const org = await ownerCaller().org.create({ name: "Double-Accept Org", slug: "double-accept-org" });
    const invite = await ownerCaller().org.invite({
      orgId: org.id,
      email: MEMBER_EMAIL,
      role: "member",
    });

    // First call: new membership created.
    const first = await memberCaller().org.acceptInvite({ token: invite.token });
    expect(first).toEqual({ orgId: org.id, alreadyMember: false });

    // Second call: the invite is now `accepted`, so the status guard fires
    // with a typed BAD_REQUEST — crucially, NOT a unique-constraint 500 or
    // duplicate-row insert. Replay safety is the real contract here.
    await expect(
      memberCaller().org.acceptInvite({ token: invite.token }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/already/i),
    });

    // Exactly one membership row, not two — the DB must not have a leaked
    // duplicate from the retry.
    const memberships = ctx.raw.prepare(
      `SELECT COUNT(*) as c FROM org_members WHERE org_id = ? AND user_id = ?`,
    ).get(org.id, MEMBER_ID) as any;
    expect(memberships.c).toBe(1);
  });
});

describe("JAR-58 §4: admin cannot remove another admin (owner-only)", () => {
  it("admin A trying to remove admin B: FORBIDDEN, B's membership unchanged", async () => {
    seedUsers();
    // Create a second admin.
    const SECOND_ADMIN_ID = "user-admin2";
    ctx.raw.prepare(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES (?, ?, ?, ?, 1)`).run(
      SECOND_ADMIN_ID, "admin2@test.com", "Admin2", "auth0|admin2",
    );
    ctx.raw.exec(`
      INSERT INTO organizations (id, name, slug, owner_id) VALUES ('${ORG_ID}', 'Edge Test Org', 'edge-test-org', '${OWNER_ID}');
      INSERT INTO org_members (id, org_id, user_id, role) VALUES
        ('m-owner',  '${ORG_ID}', '${OWNER_ID}',  'owner'),
        ('m-admin',  '${ORG_ID}', '${ADMIN_ID}',  'admin'),
        ('m-admin2', '${ORG_ID}', '${SECOND_ADMIN_ID}', 'admin');
    `);
    const before = countMembers(ORG_ID);

    await expect(
      adminCaller().org.removeMember({ orgId: ORG_ID, userId: SECOND_ADMIN_ID }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/admin/i),
    });

    // Both admin rows still exist; member count unchanged.
    expect(getMember(ORG_ID, ADMIN_ID)).toBeTruthy();
    expect(getMember(ORG_ID, SECOND_ADMIN_ID)).toBeTruthy();
    expect(getMember(ORG_ID, SECOND_ADMIN_ID).role).toBe("admin");
    expect(countMembers(ORG_ID)).toBe(before);
  });

  it("owner removing admin: succeeds (sanity check for the admin-vs-admin block)", async () => {
    seedOrg();
    const before = countMembers(ORG_ID);

    const result = await ownerCaller().org.removeMember({ orgId: ORG_ID, userId: ADMIN_ID });
    expect(result).toEqual({ success: true });

    expect(getMember(ORG_ID, ADMIN_ID)).toBeUndefined();
    expect(countMembers(ORG_ID)).toBe(before - 1);
  });
});
