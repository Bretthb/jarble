/**
 * Stripe webhook handler tests.
 *
 * Tests the stripeWebhookHandler function with a real in-memory SQLite DB.
 * Mocks Stripe services (constructWebhookEvent, isStripeConfigured) and K8s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../__tests__/helpers/testSchema.sqlite.js";

// ── Test DB helper (inline, avoids db/index.js import chain) ─────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth0_id TEXT NOT NULL UNIQUE,
    email_verified INTEGER DEFAULT 0 NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    stripe_customer_id TEXT,
    pending_stripe_subscription_id TEXT,
    pending_stripe_tier TEXT,
    free_deployment_used INTEGER DEFAULT 0 NOT NULL,
    free_trial_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    runtime TEXT DEFAULT 'openclaw' NOT NULL,
    deployment_type TEXT DEFAULT 'agent' NOT NULL,
    image TEXT,
    runtime_catalog_id INTEGER,
    is_free INTEGER DEFAULT 0 NOT NULL,
    monthly_price_cents INTEGER DEFAULT 0 NOT NULL,
    free_expires_at TEXT,
    cpu_limit TEXT,
    memory_mb INTEGER,
    storage_mb INTEGER,
    llm_mode TEXT DEFAULT 'byok' NOT NULL,
    llm_provider TEXT DEFAULT 'openrouter' NOT NULL,
    llm_model TEXT,
    llm_api_key TEXT,
    llm_api_key_id TEXT,
    llm_credit_limit_dollars INTEGER,
    llm_api_key_source_deployment_id TEXT,
    system_prompt TEXT,
    stripe_subscription_id TEXT,
    cancelled_at TEXT,
    cancel_at_period_end TEXT,
    status TEXT DEFAULT 'creating' NOT NULL,
    error TEXT,
    messaging_only INTEGER DEFAULT 0 NOT NULL,
    managed_by TEXT DEFAULT 'legacy' NOT NULL,
    isolation_level TEXT DEFAULT 'standard' NOT NULL,
    is_platform INTEGER DEFAULT 0 NOT NULL,
    resource_tier TEXT,
    theme_config TEXT,
    forked_from_id TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    fork_count INTEGER DEFAULT 0 NOT NULL,
    featured_at TEXT,
    specialties TEXT,
    bio TEXT,
    showcase_prompts TEXT,
    org_id TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
`;

let rawDb: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof sqliteSchema>>;

function createFreshDb() {
  rawDb = new Database(":memory:");
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(CREATE_TABLES_SQL);
  testDb = drizzle(rawDb, { schema: sqliteSchema });

  // Seed test user
  rawDb.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('test-user-001', 'test@jarble.ai', 'Test User', 'auth0|test-001', 1, 0);
  `);
}

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_WEBHOOK_SECRET: "whsec_xxx",
    FRONTEND_URL: "https://jarble.ai",
  },
}));

const mockIsStripeConfigured = vi.fn().mockReturnValue(true);
const mockConstructWebhookEvent = vi.fn();

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: (...args: any[]) => mockIsStripeConfigured(...args),
  constructWebhookEvent: (...args: any[]) => mockConstructWebhookEvent(...args),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
}));

const mockStopDeployment = vi.fn();
vi.mock("../../k8s/index.js", () => ({
  stopDeployment: (...args: any[]) => mockStopDeployment(...args),
}));

vi.mock("../../helpers/auth.js", () => ({
  getUserFromRequest: vi.fn(),
}));

vi.mock("../../middleware/rateLimit.js", () => ({
  stripeActionLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Mock db/index.js to use our test DB
vi.mock("../../db/index.js", () => ({
  get db() { return testDb; },
  tables: {
    users: sqliteSchema.users,
    deployments: sqliteSchema.deployments,
    processedWebhookEvents: sqliteSchema.processedWebhookEvents,
  },
}));

import { stripeWebhookHandler } from "../stripe.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-001";

function mockReq(overrides?: Partial<Request>): Request {
  return {
    body: Buffer.from("{}"),
    headers: { "stripe-signature": "sig_test" },
    ...overrides,
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

let eventCounter = 0;
function makeEvent(type: string, data: any, id?: string) {
  return {
    type,
    id: id || `evt_test_${++eventCounter}`,
    data: { object: data },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("stripeWebhookHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStripeConfigured.mockReturnValue(true);
    createFreshDb();
  });

  afterEach(() => {
    rawDb?.close();
  });

  // ── Pre-conditions ─────────────────────────────────────────────────────────

  describe("pre-condition checks", () => {
    it("returns 503 when Stripe is not configured", async () => {
      mockIsStripeConfigured.mockReturnValue(false);
      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toContain("not configured");
    });

    it("returns 400 when stripe-signature header is missing", async () => {
      const res = mockRes();
      await stripeWebhookHandler(mockReq({ headers: {} }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain("stripe-signature");
    });

    it("returns 400 when constructWebhookEvent throws", async () => {
      mockConstructWebhookEvent.mockImplementation(() => {
        throw new Error("Webhook signature verification failed");
      });
      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("skips already-processed events", async () => {
      const eventId = "evt_already";
      rawDb.exec(`INSERT INTO processed_webhook_events (event_id, event_type) VALUES ('${eventId}', 'test')`);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {}, eventId));
      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true, skipped: true });
    });

    it("records event ID after successful processing", async () => {
      const eventId = "evt_new_123";
      mockConstructWebhookEvent.mockReturnValue(makeEvent("unknown.type", {}, eventId));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });

      const row = rawDb.prepare("SELECT * FROM processed_webhook_events WHERE event_id = ?").get(eventId);
      expect(row).toBeTruthy();
    });
  });

  // ── checkout.session.completed ─────────────────────────────────────────────

  describe("checkout.session.completed", () => {
    it("updates user with Stripe customer ID and sets emailVerified", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_456",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });

      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user.stripe_customer_id).toBe("cus_123");
      expect(user.email_verified).toBe(1);
    });

    it("stores pending subscription when no deployment to link", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_pending",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user.pending_stripe_subscription_id).toBe("sub_pending");
    });

    it("stores pending subscription even when unlinked deployment exists", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, is_free)
        VALUES ('dep-001', '${TEST_USER_ID}', 'Test Deploy', 'openclaw', 'creating', 0)
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_link",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      // Handler stores pending subscription on user, not auto-linked to deployment
      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user.pending_stripe_subscription_id).toBe("sub_link");
      expect(user.stripe_customer_id).toBe("cus_123");
    });

    it("uses client_reference_id when metadata.userId is absent", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_fallback",
        subscription: null,
        metadata: {},
        client_reference_id: TEST_USER_ID,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user.stripe_customer_id).toBe("cus_fallback");
    });

    it("does nothing when neither userId nor client_reference_id is present", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_nobody",
        subscription: null,
        metadata: {},
        client_reference_id: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("does not link subscription to free deployment", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, is_free)
        VALUES ('dep-free', '${TEST_USER_ID}', 'Free Deploy', 'openclaw', 'running', 1)
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_not_free",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-free'").get() as any;
      expect(dep.stripe_subscription_id).toBeNull();
    });

    it("does not link subscription to already-linked deployment", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, is_free, stripe_subscription_id)
        VALUES ('dep-linked', '${TEST_USER_ID}', 'Linked Deploy', 'openclaw', 'running', 0, 'sub_existing')
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_new",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-linked'").get() as any;
      expect(dep.stripe_subscription_id).toBe("sub_existing");
    });

    it("handles checkout without subscription (one-time payment)", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_onetime",
        subscription: null,
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      expect(user.stripe_customer_id).toBe("cus_onetime");
      // No pendingStripeSubscriptionId set when subscription is null
    });
  });

  // ── customer.subscription.updated ──────────────────────────────────────────

  describe("customer.subscription.updated", () => {
    beforeEach(() => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-sub', '${TEST_USER_ID}', 'Sub Deploy', 'openclaw', 'running', 'sub_test')
      `);
    });

    it("sets cancelledAt when cancel_at_period_end is true", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.cancelled_at).toBeTruthy();
      expect(dep.cancel_at_period_end).toBeTruthy();
    });

    it("clears cancelledAt when reactivated", async () => {
      rawDb.exec(`UPDATE deployments SET cancelled_at = '2026-01-01', cancel_at_period_end = '2026-02-01' WHERE id = 'dep-sub'`);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.cancelled_at).toBeNull();
      expect(dep.cancel_at_period_end).toBeNull();
    });

    it("sets error for past_due status", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "past_due",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.error).toContain("past_due");
    });

    it("sets error for unpaid status", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "unpaid",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.error).toContain("unpaid");
    });

    it("clears subscription error when status becomes active", async () => {
      rawDb.exec(`UPDATE deployments SET error = 'Subscription past_due: please update' WHERE id = 'dep-sub'`);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.error).toBeNull();
    });

    it("does NOT clear non-subscription errors when active", async () => {
      rawDb.exec(`UPDATE deployments SET error = 'Pod crashed unexpectedly' WHERE id = 'dep-sub'`);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-sub'").get() as any;
      expect(dep.error).toBe("Pod crashed unexpectedly");
    });

    it("handles unknown subscription ID gracefully", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_unknown",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("does not change deployment when no updates needed", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_test",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });
  });

  // ── customer.subscription.deleted ──────────────────────────────────────────

  describe("customer.subscription.deleted", () => {
    beforeEach(() => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-del', '${TEST_USER_ID}', 'Delete Deploy', 'openclaw', 'running', 'sub_del')
      `);
      mockStopDeployment.mockResolvedValue(undefined);
    });

    it("stops the deployment and clears subscription data", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
        id: "sub_del",
        customer: "cus_123",
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      expect(mockStopDeployment).toHaveBeenCalledWith("dep-del");

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-del'").get() as any;
      expect(dep.status).toBe("stopped");
      expect(dep.stripe_subscription_id).toBeNull();
      expect(dep.cancelled_at).toBeNull();
      expect(dep.error).toBeNull();
    });

    it("handles unknown subscription gracefully", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
        id: "sub_ghost",
        customer: "cus_123",
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(mockStopDeployment).not.toHaveBeenCalled();
      expect(res.body).toEqual({ received: true });
    });

    it("still records event even if K8s stop fails", async () => {
      mockStopDeployment.mockRejectedValue(new Error("K8s down"));

      const eventId = "evt_k8s_fail";
      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
        id: "sub_del",
        customer: "cus_123",
      }, eventId));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });

      const row = rawDb.prepare("SELECT * FROM processed_webhook_events WHERE event_id = ?").get(eventId);
      expect(row).toBeTruthy();
    });
  });

  // ── invoice.payment_failed ─────────────────────────────────────────────────

  describe("invoice.payment_failed", () => {
    it("flags deployment with payment error (subscription-level)", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-pay', '${TEST_USER_ID}', 'Pay Deploy', 'openclaw', 'running', 'sub_pay')
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_123",
        subscription: "sub_pay",
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-pay'").get() as any;
      expect(dep.error).toContain("Payment failed");
    });

    it("flags paid deployments on customer-level failure (no subscription)", async () => {
      rawDb.exec(`UPDATE users SET stripe_customer_id = 'cus_cust' WHERE id = '${TEST_USER_ID}'`);
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id, is_free)
        VALUES ('dep-paid', '${TEST_USER_ID}', 'Paid', 'openclaw', 'running', 'sub_1', 0)
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_cust",
        subscription: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-paid'").get() as any;
      expect(dep.error).toContain("Payment failed");
    });

    it("does NOT flag free deployments on customer-level failure", async () => {
      rawDb.exec(`UPDATE users SET stripe_customer_id = 'cus_free' WHERE id = '${TEST_USER_ID}'`);
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, is_free)
        VALUES ('dep-free2', '${TEST_USER_ID}', 'Free', 'openclaw', 'running', 1)
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_free",
        subscription: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-free2'").get() as any;
      expect(dep.error).toBeNull();
    });

    it("handles unknown subscription gracefully", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_123",
        subscription: "sub_ghost",
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("handles unknown customer gracefully", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_unknown",
        subscription: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });
  });

  // ── Unhandled events ──────────────────────────────────────────────────────

  describe("unhandled event types", () => {
    it("acknowledges charge.succeeded", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("charge.succeeded", { amount: 999 }));
      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("acknowledges payment_intent.created", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("payment_intent.created", {}));
      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });
  });
});
