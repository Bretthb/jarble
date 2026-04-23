/**
 * Billing routing tests for the organization system (JAR-58, subsection 3).
 *
 * Covers the split between personal billing (user.stripeCustomerId) and
 * organization billing (organizations.stripeCustomerId). Each test asserts
 * BOTH the Stripe call shape AND the DB state, so a silent-noop router can't
 * pass by doing nothing.
 *
 * Scope notes:
 *   - The Stripe *subscription* is created by the POST /api/stripe/checkout
 *     REST route (see src/routes/stripe.ts), which writes
 *     user.pendingStripeSubscriptionId. The tRPC `deployment.create` procedure
 *     only LINKS that pending subscription to the new deployment row. Because
 *     of this split, tRPC-level billing-routing coverage lives on the org
 *     router's setupBilling / createBillingPortal / getBilling procedures, and
 *     on the `customer.subscription.deleted` Stripe webhook, which is what
 *     actually stops a deployment when an org's subscription is cancelled.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mirrors org.rbac.test.ts with two additions:
//   1. Stripe services (getStripe, createPortalSession, constructWebhookEvent)
//      are mocked so we can assert the exact call shape.
//   2. db/index.js uses a getter so the Stripe webhook handler, which reads
//      `db` as a module-level import, sees the per-test in-memory SQLite DB.

const mockStripeCustomersCreate = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockConstructWebhookEvent = vi.fn();
const mockIsStripeConfigured = vi.fn().mockReturnValue(true);
const mockStopDeployment = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: (...args: any[]) => mockIsStripeConfigured(...args),
  getStripe: () => ({
    customers: { create: (...args: any[]) => mockStripeCustomersCreate(...args) },
  }),
  createPortalSession: (...args: any[]) => mockCreatePortalSession(...args),
  constructWebhookEvent: (...args: any[]) => mockConstructWebhookEvent(...args),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  listInvoices: vi.fn().mockResolvedValue([]),
  getSubscriptionDetails: vi.fn(),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({ baseCents: 0, managedKeyCents: 0, totalCents: 0 }),
}));

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: (...args: any[]) => mockStopDeployment(...args),
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
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_WEBHOOK_SECRET: "whsec_xxx",
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));

// The webhook handler reads `db` and `tables` as module-level imports from
// db/index.js, so we need to re-point that module at the per-test SQLite DB.
// A getter indirection lets `beforeEach` swap ctx.db in cleanly.
vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return {
    get db() { return ctx.db; },
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

// Imported after the mocks above so the handler picks up the test DB.
import { stripeWebhookHandler } from "../../routes/stripe.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

let ctx: TestDbContext;

const ORG_ID = "org-bill";
const ORG_STRIPE_CUST = "cus_org_abc";
const USER_STRIPE_CUST = "cus_user_personal";

const OWNER_ID = "user-owner";
const OWNER_AUTH0 = "auth0|owner";
const OWNER_EMAIL = "owner@test.com";

const MEMBER_ID = "user-member";
const MEMBER_AUTH0 = "auth0|member";
const MEMBER_EMAIL = "member@test.com";

const OUTSIDER_ID = "user-outsider";

const ORG_DEPLOYMENT_ID = "dep-org-primary";
const ORG_DEPLOYMENT_SUB = "sub_org_primary";
const SECOND_ORG_DEPLOYMENT_ID = "dep-org-secondary";
const SECOND_ORG_DEPLOYMENT_SUB = "sub_org_secondary";
const PERSONAL_DEPLOYMENT_ID = "dep-personal";
const PERSONAL_DEPLOYMENT_SUB = "sub_personal";

/**
 * Seed: one org with a Stripe customer id, an owner (with their own personal
 * Stripe customer id and a personal deployment), a member, and an outsider.
 * Two org-owned deployments, each with its own Stripe subscription id, plus
 * one personal deployment for the owner.
 */
function seedOrg(opts: { orgHasBilling?: boolean } = { orgHasBilling: true }) {
  ctx.raw.prepare(`INSERT INTO users (id, email, name, auth0_id, email_verified, stripe_customer_id) VALUES (?, ?, ?, ?, 1, ?)`).run(
    OWNER_ID, OWNER_EMAIL, "Owner", OWNER_AUTH0, USER_STRIPE_CUST,
  );
  ctx.raw.prepare(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES (?, ?, ?, ?, 1)`).run(
    MEMBER_ID, MEMBER_EMAIL, "Member", MEMBER_AUTH0,
  );
  ctx.raw.prepare(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES (?, ?, ?, ?, 1)`).run(
    OUTSIDER_ID, "outsider@test.com", "Outsider", "auth0|outsider",
  );

  ctx.raw.prepare(`INSERT INTO organizations (id, name, slug, owner_id, stripe_customer_id) VALUES (?, ?, ?, ?, ?)`).run(
    ORG_ID, "Billing Org", "billing-org", OWNER_ID, opts.orgHasBilling ? ORG_STRIPE_CUST : null,
  );
  ctx.raw.exec(`
    INSERT INTO org_members (id, org_id, user_id, role) VALUES
      ('m-owner', '${ORG_ID}', '${OWNER_ID}', 'owner'),
      ('m-member', '${ORG_ID}', '${MEMBER_ID}', 'member');
  `);

  // Two org deployments (each with its own Stripe subscription id) and one
  // personal deployment. Hard-coded stripe_subscription_id lets us drive the
  // `customer.subscription.deleted` webhook at a specific deployment.
  const insertDep = ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id, visibility, stripe_subscription_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDep.run(ORG_DEPLOYMENT_ID, OWNER_ID, "Org Primary", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", ORG_ID, "all", ORG_DEPLOYMENT_SUB);
  insertDep.run(SECOND_ORG_DEPLOYMENT_ID, OWNER_ID, "Org Secondary", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", ORG_ID, "all", SECOND_ORG_DEPLOYMENT_SUB);
  insertDep.run(PERSONAL_DEPLOYMENT_ID, OWNER_ID, "Personal", "openclaw", ctx.openclawCatalogId, "running", "byok", "openrouter", "legacy", null, "all", PERSONAL_DEPLOYMENT_SUB);
}

function callerFor(userId: string, auth0Id: string, email: string, stripeCustomerId: string | null = null) {
  return createTestCaller(ctx.db, {
    id: userId,
    email,
    name: userId,
    auth0Id,
    emailVerified: true,
    stripeCustomerId,
  });
}

const ownerCaller  = () => callerFor(OWNER_ID,  OWNER_AUTH0,  OWNER_EMAIL, USER_STRIPE_CUST);
const memberCaller = () => callerFor(MEMBER_ID, MEMBER_AUTH0, MEMBER_EMAIL, null);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDeployment(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id);
}

function getOrg(id: string): any {
  return ctx.raw.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id);
}

let eventCounter = 0;
function makeEvent(type: string, data: any, id?: string) {
  return { type, id: id || `evt_bill_${++eventCounter}`, data: { object: data } };
}

function mockReq(): Request {
  return {
    body: Buffer.from("{}"),
    headers: { "stripe-signature": "sig_test" },
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
  };
  return res;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  mockIsStripeConfigured.mockReturnValue(true);
  mockStopDeployment.mockResolvedValue(undefined);
});

afterAll(() => {
  ctx?.raw.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("JAR-58 §3: org.setupBilling creates a Stripe customer against the org", () => {
  // This is the point where the routing decision "this customer belongs to
  // the org, not the user" is made: setupBilling creates the Stripe customer
  // with the org's name and an `orgId` metadata tag, and writes the returned
  // customer id to `organizations.stripe_customer_id`. That value is what
  // `/api/stripe/checkout` later reads when deciding whether to bill the org
  // or the personal user.

  it("owner with no existing billing: creates Stripe customer and persists org.stripe_customer_id", async () => {
    seedOrg({ orgHasBilling: false });
    mockStripeCustomersCreate.mockResolvedValue({ id: "cus_new_from_stripe" });

    const result = await ownerCaller().org.setupBilling({ orgId: ORG_ID });
    expect(result).toEqual({ stripeCustomerId: "cus_new_from_stripe", alreadySetUp: false });

    // Stripe call shape: name = org name, metadata tags orgId + type
    expect(mockStripeCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeCustomersCreate).toHaveBeenCalledWith({
      name: "Billing Org",
      email: OWNER_EMAIL,
      metadata: { orgId: ORG_ID, type: "organization" },
    });

    // DB state: org row updated with the new Stripe customer id
    expect(getOrg(ORG_ID).stripe_customer_id).toBe("cus_new_from_stripe");
    expect(getOrg(ORG_ID).billing_email).toBe(OWNER_EMAIL);
  });

  it("owner with existing billing: short-circuits (does NOT call Stripe again)", async () => {
    seedOrg({ orgHasBilling: true }); // org already has stripe_customer_id set

    const result = await ownerCaller().org.setupBilling({ orgId: ORG_ID });
    expect(result).toEqual({ stripeCustomerId: ORG_STRIPE_CUST, alreadySetUp: true });

    // Critical: no duplicate Stripe customer created, no DB mutation
    expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
    expect(getOrg(ORG_ID).stripe_customer_id).toBe(ORG_STRIPE_CUST);
  });
});

describe("JAR-58 §3: org.createBillingPortal routes to the org's Stripe customer", () => {
  // createBillingPortal is the closest tRPC procedure to "use the org's
  // stripeCustomerId not the user's". It reads organizations.stripeCustomerId
  // and hands it to Stripe's billing portal. This is the exact routing split
  // requested in the task brief — same call shape as /checkout, but a real
  // tRPC procedure we can assert against.

  it("org with billing set up: calls createPortalSession with org.stripe_customer_id, NOT user.stripe_customer_id", async () => {
    seedOrg({ orgHasBilling: true });
    mockCreatePortalSession.mockResolvedValue({ url: "https://billing.stripe.com/session_org" });

    const result = await ownerCaller().org.createBillingPortal({ orgId: ORG_ID });
    expect(result).toEqual({ url: "https://billing.stripe.com/session_org" });

    expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
    const args = mockCreatePortalSession.mock.calls[0][0];
    expect(args.stripeCustomerId).toBe(ORG_STRIPE_CUST);
    // Critical: the user's personal customer id must NOT leak into the org
    // billing session. This is the whole point of the routing split.
    expect(args.stripeCustomerId).not.toBe(USER_STRIPE_CUST);
    expect(args.returnUrl).toContain(`/orgs/${ORG_ID}`);
  });

  it("org without billing (stripe_customer_id=null): throws PRECONDITION_FAILED and Stripe is NOT called", async () => {
    seedOrg({ orgHasBilling: false });

    await expect(
      ownerCaller().org.createBillingPortal({ orgId: ORG_ID }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/billing/i),
    });

    expect(mockCreatePortalSession).not.toHaveBeenCalled();
  });
});

describe("JAR-58 §3: customer.subscription.deleted stops the matching org deployment", () => {
  beforeEach(() => {
    seedOrg({ orgHasBilling: true });
  });

  it("webhook for an org deployment's subscription: stops that deployment, leaves other org deployments running", async () => {
    mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
      id: ORG_DEPLOYMENT_SUB,
      customer: ORG_STRIPE_CUST,
    }));

    const res = mockRes();
    await stripeWebhookHandler(mockReq(), res);
    expect(res.body).toEqual({ received: true });

    // Targeted deployment: status flipped, subscription id cleared, K8s stop called
    const target = getDeployment(ORG_DEPLOYMENT_ID);
    expect(target.status).toBe("stopped");
    expect(target.stripe_subscription_id).toBeNull();
    expect(mockStopDeployment).toHaveBeenCalledWith(ORG_DEPLOYMENT_ID);
    expect(mockStopDeployment).toHaveBeenCalledTimes(1);

    // Other org deployment: untouched (each deployment has its own subscription)
    const sibling = getDeployment(SECOND_ORG_DEPLOYMENT_ID);
    expect(sibling.status).toBe("running");
    expect(sibling.stripe_subscription_id).toBe(SECOND_ORG_DEPLOYMENT_SUB);
  });

  it("webhook for an org deployment's subscription: does NOT touch personal deployments", async () => {
    mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
      id: ORG_DEPLOYMENT_SUB,
      customer: ORG_STRIPE_CUST,
    }));

    const res = mockRes();
    await stripeWebhookHandler(mockReq(), res);
    expect(res.body).toEqual({ received: true });

    // Personal deployment is the owner's but with org_id=null and a different
    // subscription id — it must be completely unaffected.
    const personal = getDeployment(PERSONAL_DEPLOYMENT_ID);
    expect(personal.status).toBe("running");
    expect(personal.stripe_subscription_id).toBe(PERSONAL_DEPLOYMENT_SUB);
    expect(personal.org_id).toBeNull();
  });
});

describe("JAR-58 §3: org.leave only affects the leaving member's own deployments", () => {
  // The task wording "member leaving does NOT affect org deployments" is
  // shorthand for "leaving doesn't affect OTHER members' org deployments".
  // The router intentionally unsets org_id on the leaver's OWN deployments
  // (see org.ts::leave). We verify both halves of that rule.

  it("a member with no deployments leaves: owner's org deployments are untouched", async () => {
    seedOrg({ orgHasBilling: true });
    // Baseline snapshot of both org deployments owned by the owner.
    const beforePrimary = getDeployment(ORG_DEPLOYMENT_ID);
    const beforeSecondary = getDeployment(SECOND_ORG_DEPLOYMENT_ID);

    const result = await memberCaller().org.leave({ orgId: ORG_ID });
    expect(result).toEqual({ success: true });

    // Owner's org deployments: no change to org_id, status, or subscription
    const afterPrimary = getDeployment(ORG_DEPLOYMENT_ID);
    const afterSecondary = getDeployment(SECOND_ORG_DEPLOYMENT_ID);
    expect(afterPrimary.org_id).toBe(beforePrimary.org_id);
    expect(afterPrimary.status).toBe(beforePrimary.status);
    expect(afterPrimary.stripe_subscription_id).toBe(beforePrimary.stripe_subscription_id);
    expect(afterSecondary.org_id).toBe(beforeSecondary.org_id);
    expect(afterSecondary.status).toBe(beforeSecondary.status);
  });

  it("a member with their own org deployment leaves: only their own deployment's org_id is unset", async () => {
    seedOrg({ orgHasBilling: true });
    // Seed a deployment that the MEMBER owns in the org.
    ctx.raw.prepare(`
      INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dep-member-org", MEMBER_ID, "Member's Org Bot", "openclaw", ctx.openclawCatalogId,
      "running", "byok", "openrouter", "legacy", ORG_ID, "all",
    );

    await memberCaller().org.leave({ orgId: ORG_ID });

    // Member's deployment: org_id unset (returned to personal mode), row still exists
    const memberDep = getDeployment("dep-member-org");
    expect(memberDep).toBeTruthy();
    expect(memberDep.org_id).toBeNull();

    // Owner's org deployments: still tied to the org
    expect(getDeployment(ORG_DEPLOYMENT_ID).org_id).toBe(ORG_ID);
    expect(getDeployment(SECOND_ORG_DEPLOYMENT_ID).org_id).toBe(ORG_ID);
  });
});
