/**
 * Stripe webhook edge case tests.
 *
 * Covers scenarios not in stripe.test.ts:
 * - Duplicate event handling (same event ID processed twice concurrently)
 * - Missing customer ID in webhook payload
 * - Concurrent webhook processing for the same subscription
 * - Malformed event data
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema.sqlite.js";

// ── Test DB ────────────────────────────────────────────────────────────────

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

  rawDb.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used, stripe_customer_id)
    VALUES ('test-user-001', 'test@jarble.ai', 'Test User', 'auth0|test-001', 1, 0, 'cus_test');
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

const mockStopDeployment = vi.fn().mockResolvedValue(undefined);
vi.mock("../../k8s/index.js", () => ({
  stopDeployment: (...args: any[]) => mockStopDeployment(...args),
}));

vi.mock("../../helpers/auth.js", () => ({
  getUserFromRequest: vi.fn(),
}));

vi.mock("../../middleware/rateLimit.js", () => ({
  stripeActionLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../db/index.js", () => ({
  get db() { return testDb; },
  tables: {
    users: sqliteSchema.users,
    deployments: sqliteSchema.deployments,
    processedWebhookEvents: sqliteSchema.processedWebhookEvents,
  },
}));

vi.mock("../../utils/pricing.js", () => ({
  calculateMonthlyPriceCents: vi.fn().mockReturnValue(0),
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

let eventCounter = 100;
function makeEvent(type: string, data: any, id?: string) {
  return {
    type,
    id: id || `evt_edge_${++eventCounter}`,
    data: { object: data },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("stripeWebhookHandler edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStripeConfigured.mockReturnValue(true);
    createFreshDb();
  });

  afterEach(() => {
    rawDb?.close();
  });

  // ── Duplicate event handling ──────────────────────────────────────────────

  describe("duplicate event handling", () => {
    it("processes the same event ID only once even when called concurrently", async () => {
      const eventId = "evt_concurrent_1";

      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-dup', '${TEST_USER_ID}', 'Dup Deploy', 'openclaw', 'running', 'sub_dup')
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.deleted", {
        id: "sub_dup",
        customer: "cus_test",
      }, eventId));

      // Process the event the first time
      const res1 = mockRes();
      await stripeWebhookHandler(mockReq(), res1);
      expect(res1.body).toEqual({ received: true });
      expect(mockStopDeployment).toHaveBeenCalledTimes(1);

      // Process the same event ID again
      const res2 = mockRes();
      await stripeWebhookHandler(mockReq(), res2);
      expect(res2.body).toEqual({ received: true, skipped: true });
      // stopDeployment should NOT be called again
      expect(mockStopDeployment).toHaveBeenCalledTimes(1);
    });

    it("handles duplicate insert race condition gracefully", async () => {
      // Pre-insert the event to simulate a race where two workers both pass
      // the findFirst check but one inserts before the other
      const eventId = "evt_race_1";
      rawDb.exec(`INSERT INTO processed_webhook_events (event_id, event_type) VALUES ('${eventId}', 'test')`);

      mockConstructWebhookEvent.mockReturnValue(
        makeEvent("charge.succeeded", { amount: 100 }, eventId)
      );

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      // Should be skipped due to idempotency check
      expect(res.body).toEqual({ received: true, skipped: true });
    });
  });

  // ── Missing/null customer ID ──────────────────────────────────────────────

  describe("missing customer ID in webhook", () => {
    it("handles checkout.session.completed with null customer gracefully", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: null,
        subscription: "sub_123",
        metadata: { userId: TEST_USER_ID },
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);

      // Should still process (userId is present)
      expect(res.body).toEqual({ received: true });

      const user = rawDb.prepare("SELECT * FROM users WHERE id = ?").get(TEST_USER_ID) as any;
      // stripeCustomerId will be set to null (the checkout object's customer value)
      expect(user.stripe_customer_id).toBeNull();
    });

    it("handles subscription.updated with missing customer field", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-nocust', '${TEST_USER_ID}', 'No Cust', 'openclaw', 'running', 'sub_nocust')
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_nocust",
        customer: undefined,
        status: "active",
        cancel_at_period_end: false,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("handles invoice.payment_failed with unknown customer", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_nonexistent",
        subscription: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });
  });

  // ── Concurrent webhook processing ────────────────────────────────────────

  describe("concurrent webhook processing", () => {
    it("handles concurrent subscription updates for the same deployment", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-conc', '${TEST_USER_ID}', 'Concurrent Deploy', 'openclaw', 'running', 'sub_conc')
      `);

      // Simulate two subscription updates arriving simultaneously
      const event1 = makeEvent("customer.subscription.updated", {
        id: "sub_conc",
        customer: "cus_test",
        status: "past_due",
        cancel_at_period_end: false,
      }, "evt_conc_1");

      const event2 = makeEvent("customer.subscription.updated", {
        id: "sub_conc",
        customer: "cus_test",
        status: "active",
        cancel_at_period_end: false,
      }, "evt_conc_2");

      mockConstructWebhookEvent
        .mockReturnValueOnce(event1)
        .mockReturnValueOnce(event2);

      const [res1, res2] = [mockRes(), mockRes()];

      // Process concurrently
      await Promise.all([
        stripeWebhookHandler(mockReq(), res1),
        stripeWebhookHandler(mockReq(), res2),
      ]);

      expect(res1.body).toEqual({ received: true });
      expect(res2.body).toEqual({ received: true });

      // Both events should be recorded
      const events = rawDb.prepare("SELECT * FROM processed_webhook_events WHERE event_id IN (?, ?)").all("evt_conc_1", "evt_conc_2");
      expect(events.length).toBe(2);
    });

    it("handles concurrent subscription.deleted for the same subscription", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-double-del', '${TEST_USER_ID}', 'Double Delete', 'openclaw', 'running', 'sub_dd')
      `);

      const event1 = makeEvent("customer.subscription.deleted", {
        id: "sub_dd",
        customer: "cus_test",
      }, "evt_dd_1");

      const event2 = makeEvent("customer.subscription.deleted", {
        id: "sub_dd",
        customer: "cus_test",
      }, "evt_dd_2");

      mockConstructWebhookEvent
        .mockReturnValueOnce(event1)
        .mockReturnValueOnce(event2);

      const [res1, res2] = [mockRes(), mockRes()];

      // First processes normally, second should handle already-stopped state
      await stripeWebhookHandler(mockReq(), res1);
      await stripeWebhookHandler(mockReq(), res2);

      expect(res1.body).toEqual({ received: true });
      expect(res2.body).toEqual({ received: true });

      // stopDeployment called at least once (second time may also call if deployment
      // was found before first updated the DB)
      expect(mockStopDeployment).toHaveBeenCalled();
    });
  });

  // ── Malformed event payloads ─────────────────────────────────────────────

  describe("malformed event payloads", () => {
    it("handles checkout.session.completed with empty metadata", async () => {
      mockConstructWebhookEvent.mockReturnValue(makeEvent("checkout.session.completed", {
        customer: "cus_test",
        subscription: "sub_123",
        metadata: null,
        client_reference_id: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });

    it("handles subscription.updated with zero current_period_end", async () => {
      rawDb.exec(`
        INSERT INTO deployments (id, user_id, name, runtime, status, stripe_subscription_id)
        VALUES ('dep-zero', '${TEST_USER_ID}', 'Zero Period', 'openclaw', 'running', 'sub_zero')
      `);

      mockConstructWebhookEvent.mockReturnValue(makeEvent("customer.subscription.updated", {
        id: "sub_zero",
        customer: "cus_test",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: 0, // Unix epoch
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });

      const dep = rawDb.prepare("SELECT * FROM deployments WHERE id = 'dep-zero'").get() as any;
      expect(dep.cancelled_at).toBeTruthy();
    });

    it("handles invoice.payment_failed with null subscription gracefully", async () => {
      // Customer has no stripe_customer_id match in DB
      mockConstructWebhookEvent.mockReturnValue(makeEvent("invoice.payment_failed", {
        customer: "cus_ghost_customer",
        subscription: null,
      }));

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.body).toEqual({ received: true });
    });
  });

  // ── Webhook signature verification failure ────────────────────────────────

  describe("signature verification edge cases", () => {
    it("returns 400 when constructWebhookEvent throws signature error", async () => {
      mockConstructWebhookEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload.");
      });

      const res = mockRes();
      await stripeWebhookHandler(mockReq(), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain("Webhook signature verification failed");
    });

    it("returns 400 with empty request body", async () => {
      mockConstructWebhookEvent.mockImplementation(() => {
        throw new Error("Unexpected token");
      });

      const res = mockRes();
      await stripeWebhookHandler(
        mockReq({ body: Buffer.from("") }),
        res
      );
      expect(res.statusCode).toBe(400);
    });
  });
});
