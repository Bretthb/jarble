/**
 * Integration tests for the billing tRPC router.
 *
 * Tests getOverview, getInvoices, getSubscriptions.
 * Uses real in-memory SQLite with mocked Stripe SDK.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsStripeConfigured = vi.fn().mockReturnValue(false);
const mockGetSubscriptionDetails = vi.fn();
const mockListInvoices = vi.fn();

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: (...args: any[]) => mockIsStripeConfigured(...args),
  getSubscriptionDetails: (...args: any[]) => mockGetSubscriptionDetails(...args),
  listInvoices: (...args: any[]) => mockListInvoices(...args),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

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

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
  syncMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
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
  mockIsStripeConfigured.mockReturnValue(false);
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

function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-test-001";
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, is_free, monthly_price_cents, stripe_subscription_id, llm_mode, llm_provider, managed_by, cancelled_at, cancel_at_period_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || ctx.testUserId,
    overrides.name || "Test Deployment",
    overrides.runtime || "openclaw",
    overrides.runtimeCatalogId || ctx.openclawCatalogId,
    overrides.status || "running",
    overrides.isFree ?? 0,
    overrides.monthlyPriceCents ?? 0,
    overrides.stripeSubscriptionId || null,
    overrides.llmMode || "byok",
    overrides.llmProvider || "openrouter",
    overrides.managedBy || "legacy",
    overrides.cancelledAt || null,
    overrides.cancelAtPeriodEnd || null,
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("billing.getOverview", () => {
  it("returns zero totals for user with no deployments", async () => {
    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(0);
    expect(result.activeSubscriptionCount).toBe(0);
    expect(result.nextBillingDate).toBeNull();
    expect(result.paymentMethodLast4).toBeNull();
  });

  it("returns totalMonthlyCents summing all non-free deployments", async () => {
    seedDeployment({ id: "dep-1", monthlyPriceCents: 500, isFree: 0 });
    seedDeployment({ id: "dep-2", monthlyPriceCents: 1000, isFree: 0 });
    seedDeployment({ id: "dep-free", monthlyPriceCents: 0, isFree: 1 });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(1500);
  });

  it("excludes free deployments from totalMonthlyCents even if monthlyPriceCents is set", async () => {
    seedDeployment({ id: "dep-free", monthlyPriceCents: 999, isFree: 1 });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(0);
  });

  it("counts active subscriptions (non-free with stripeSubscriptionId)", async () => {
    seedDeployment({ id: "dep-1", isFree: 0, stripeSubscriptionId: "sub_123" });
    seedDeployment({ id: "dep-2", isFree: 0, stripeSubscriptionId: "sub_456" });
    seedDeployment({ id: "dep-3", isFree: 0, stripeSubscriptionId: null }); // no subscription
    seedDeployment({ id: "dep-4", isFree: 1, stripeSubscriptionId: null }); // free

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.activeSubscriptionCount).toBe(2);
  });

  it("does not fetch Stripe details when Stripe is not configured", async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(mockGetSubscriptionDetails).not.toHaveBeenCalled();
    expect(result.nextBillingDate).toBeNull();
    expect(result.paymentMethodLast4).toBeNull();
  });

  it("fetches next billing date from Stripe when configured", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: futureTimestamp,
      default_payment_method: null,
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(mockGetSubscriptionDetails).toHaveBeenCalledWith("sub_123");
    expect(result.nextBillingDate).toBeTruthy();
    expect(new Date(result.nextBillingDate!).getTime()).toBeGreaterThan(Date.now());
  });

  it("fetches payment method last4 from Stripe", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: {
        card: { last4: "4242" },
      },
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.paymentMethodLast4).toBe("4242");
  });

  it("handles missing card on payment method", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: { type: "sepa_debit" }, // no card
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.paymentMethodLast4).toBeNull();
  });

  it("handles Stripe API error gracefully", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockRejectedValue(new Error("Stripe API error"));
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.nextBillingDate).toBeNull();
    expect(result.paymentMethodLast4).toBeNull();
  });

  it("handles null default_payment_method", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: null,
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.paymentMethodLast4).toBeNull();
  });

  it("handles string default_payment_method (not expanded)", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: "pm_123abc", // string, not expanded
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.paymentMethodLast4).toBeNull();
  });

  it("handles missing current_period_end", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      default_payment_method: null,
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_123" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.nextBillingDate).toBeNull();
  });

  it("uses only the first paid deployment for Stripe details", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: null,
    });
    seedDeployment({ id: "dep-1", isFree: 0, stripeSubscriptionId: "sub_first" });
    seedDeployment({ id: "dep-2", isFree: 0, stripeSubscriptionId: "sub_second" });

    const caller = authedCaller();
    await caller.billing.getOverview();

    expect(mockGetSubscriptionDetails).toHaveBeenCalledTimes(1);
    expect(mockGetSubscriptionDetails).toHaveBeenCalledWith("sub_first");
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.billing.getOverview()).rejects.toThrow("You must be logged in");
  });

  it("does not include other users' deployments", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-mine", monthlyPriceCents: 500 });
    seedDeployment({ id: "dep-theirs", monthlyPriceCents: 1000, userId: "user2" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(500);
  });
});

describe("billing.getInvoices", () => {
  it("returns empty array when Stripe is not configured", async () => {
    mockIsStripeConfigured.mockReturnValue(false);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toEqual([]);
    expect(mockListInvoices).not.toHaveBeenCalled();
  });

  it("returns empty array when user has no stripeCustomerId", async () => {
    mockIsStripeConfigured.mockReturnValue(true);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toEqual([]);
    expect(mockListInvoices).not.toHaveBeenCalled();
  });

  it("returns invoices when Stripe is configured and user has customerId", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    const now = Math.floor(Date.now() / 1000);
    mockListInvoices.mockResolvedValue([
      {
        id: "inv_001",
        created: now,
        description: "Monthly subscription",
        amount_paid: 999,
        amount_due: 999,
        status: "paid",
        invoice_pdf: "https://stripe.com/pdf/inv_001",
        hosted_invoice_url: "https://stripe.com/hosted/inv_001",
        lines: { data: [] },
      },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inv_001");
    expect(result[0].amountCents).toBe(999);
    expect(result[0].status).toBe("paid");
    expect(result[0].pdfUrl).toBe("https://stripe.com/pdf/inv_001");
    expect(result[0].hostedUrl).toBe("https://stripe.com/hosted/inv_001");
    expect(result[0].description).toBe("Monthly subscription");
  });

  it("falls back to line item description when invoice description is null", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    mockListInvoices.mockResolvedValue([
      {
        id: "inv_002",
        created: Math.floor(Date.now() / 1000),
        description: null,
        amount_paid: 500,
        amount_due: 500,
        status: "paid",
        invoice_pdf: null,
        hosted_invoice_url: null,
        lines: {
          data: [{ description: "Jarble Deployment (openclaw)" }],
        },
      },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result[0].description).toBe("Jarble Deployment (openclaw)");
  });

  it("uses 'Subscription' as fallback description when both are null", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    mockListInvoices.mockResolvedValue([
      {
        id: "inv_003",
        created: Math.floor(Date.now() / 1000),
        description: null,
        amount_paid: 300,
        amount_due: 300,
        status: "paid",
        invoice_pdf: null,
        hosted_invoice_url: null,
        lines: { data: [] },
      },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result[0].description).toBe("Subscription");
  });

  it("handles null invoice_pdf and hosted_invoice_url", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    mockListInvoices.mockResolvedValue([
      {
        id: "inv_004",
        created: Math.floor(Date.now() / 1000),
        description: "Test",
        amount_paid: 100,
        amount_due: 100,
        status: "draft",
        invoice_pdf: null,
        hosted_invoice_url: null,
        lines: { data: [] },
      },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result[0].pdfUrl).toBeNull();
    expect(result[0].hostedUrl).toBeNull();
  });

  it("returns empty array on Stripe API error", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);
    mockListInvoices.mockRejectedValue(new Error("Stripe API error"));

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toEqual([]);
  });

  it("returns multiple invoices sorted by date", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    const now = Math.floor(Date.now() / 1000);
    mockListInvoices.mockResolvedValue([
      { id: "inv_a", created: now, description: "A", amount_paid: 100, status: "paid", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
      { id: "inv_b", created: now - 86400, description: "B", amount_paid: 200, status: "paid", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("inv_a");
    expect(result[1].id).toBe("inv_b");
  });

  it("uses amount_due when amount_paid is 0", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    mockListInvoices.mockResolvedValue([
      { id: "inv_due", created: Math.floor(Date.now() / 1000), description: "Open", amount_paid: 0, amount_due: 750, status: "open", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result[0].amountCents).toBe(750);
  });

  it("converts created timestamp to ISO date string", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_test123' WHERE id = '${ctx.testUserId}'`);

    const specificTimestamp = 1704067200; // 2024-01-01T00:00:00Z
    mockListInvoices.mockResolvedValue([
      { id: "inv_date", created: specificTimestamp, description: "Test", amount_paid: 100, status: "paid", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result[0].date).toContain("2024-01-01");
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.billing.getInvoices()).rejects.toThrow("You must be logged in");
  });
});

describe("billing.getSubscriptions", () => {
  it("returns empty array when user has no deployments", async () => {
    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toEqual([]);
  });

  it("returns empty array when user has only free deployments", async () => {
    seedDeployment({ isFree: 1, stripeSubscriptionId: null });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toEqual([]);
  });

  it("returns empty array when user has deployments without stripeSubscriptionId", async () => {
    seedDeployment({ isFree: 0, stripeSubscriptionId: null });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toEqual([]);
  });

  it("returns subscription details for paid deployments", async () => {
    mockIsStripeConfigured.mockReturnValue(false); // Stripe not configured
    seedDeployment({
      id: "dep-paid",
      name: "Paid Bot",
      isFree: 0,
      monthlyPriceCents: 999,
      stripeSubscriptionId: "sub_123",
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(1);
    expect(result[0].deploymentId).toBe("dep-paid");
    expect(result[0].deploymentName).toBe("Paid Bot");
    expect(result[0].monthlyPriceCents).toBe(999);
    expect(result[0].stripeStatus).toBe("unknown");
    expect(result[0].periodStart).toBeNull();
    expect(result[0].periodEnd).toBeNull();
  });

  it("fetches Stripe subscription details when configured", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    const now = Math.floor(Date.now() / 1000);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_start: now - 86400 * 15,
      current_period_end: now + 86400 * 15,
      status: "active",
    });

    seedDeployment({
      id: "dep-stripe",
      name: "Stripe Bot",
      isFree: 0,
      stripeSubscriptionId: "sub_abc",
      monthlyPriceCents: 1500,
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(1);
    expect(result[0].stripeStatus).toBe("active");
    expect(result[0].periodStart).toBeTruthy();
    expect(result[0].periodEnd).toBeTruthy();
  });

  it("handles Stripe API error gracefully (falls through with defaults)", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockRejectedValue(new Error("Stripe error"));

    seedDeployment({
      isFree: 0,
      stripeSubscriptionId: "sub_error",
      monthlyPriceCents: 500,
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(1);
    expect(result[0].stripeStatus).toBe("unknown");
    expect(result[0].periodStart).toBeNull();
    expect(result[0].periodEnd).toBeNull();
  });

  it("returns runtime name from runtimeCatalogEntry", async () => {
    seedDeployment({
      isFree: 0,
      stripeSubscriptionId: "sub_rt",
      runtimeCatalogId: ctx.openclawCatalogId,
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result[0].runtime).toBe("OpenClaw");
  });

  it("returns cancelledAt and cancelAtPeriodEnd when set", async () => {
    const cancelDate = new Date().toISOString();
    seedDeployment({
      isFree: 0,
      stripeSubscriptionId: "sub_cancel",
      cancelledAt: cancelDate,
      cancelAtPeriodEnd: cancelDate,
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result[0].cancelledAt).toBeTruthy();
    expect(result[0].cancelAtPeriodEnd).toBeTruthy();
  });

  it("returns null cancelledAt when not cancelled", async () => {
    seedDeployment({
      isFree: 0,
      stripeSubscriptionId: "sub_active",
    });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result[0].cancelledAt).toBeNull();
    expect(result[0].cancelAtPeriodEnd).toBeNull();
  });

  it("handles multiple paid deployments", async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    seedDeployment({ id: "dep-1", name: "Bot One", isFree: 0, stripeSubscriptionId: "sub_1" });
    seedDeployment({ id: "dep-2", name: "Bot Two", isFree: 0, stripeSubscriptionId: "sub_2" });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(2);
    const names = result.map((r: any) => r.deploymentName).sort();
    expect(names).toEqual(["Bot One", "Bot Two"]);
  });

  it("filters out failed Promise.allSettled results", async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    seedDeployment({ id: "dep-ok", name: "OK Bot", isFree: 0, stripeSubscriptionId: "sub_ok" });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    // All should succeed since Stripe is not configured
    expect(result).toHaveLength(1);
  });

  it("does not include other users' deployments", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user2', 'other@test.com', 'Other', 'auth0|other', 1)`);
    seedDeployment({ id: "dep-mine", isFree: 0, stripeSubscriptionId: "sub_mine" });
    seedDeployment({ id: "dep-theirs", isFree: 0, stripeSubscriptionId: "sub_theirs", userId: "user2" });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(1);
    expect(result[0].deploymentId).toBe("dep-mine");
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.billing.getSubscriptions()).rejects.toThrow("You must be logged in");
  });

  it("excludes free deployments even with stripeSubscriptionId", async () => {
    seedDeployment({ isFree: 1, stripeSubscriptionId: "sub_free" });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toEqual([]);
  });

  it("falls back to runtime field when runtimeCatalogEntry is null", async () => {
    ctx.raw.prepare(`
      INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, is_free, monthly_price_cents, stripe_subscription_id, llm_mode, llm_provider, managed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "dep-no-catalog",
      ctx.testUserId,
      "No Catalog Bot",
      "custom-runtime",
      null,
      "running",
      0,
      500,
      "sub_no_catalog",
      "byok",
      "openrouter",
      "legacy",
    );

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    expect(result).toHaveLength(1);
    expect(result[0].runtime).toBe("custom-runtime");
  });
});

describe("billing — mixed scenarios", () => {
  it("overview handles a mix of free and paid deployments correctly", async () => {
    seedDeployment({ id: "dep-free-1", isFree: 1, monthlyPriceCents: 0 });
    seedDeployment({ id: "dep-free-2", isFree: 1, monthlyPriceCents: 0 });
    seedDeployment({ id: "dep-paid-1", isFree: 0, monthlyPriceCents: 500, stripeSubscriptionId: "sub_1" });
    seedDeployment({ id: "dep-paid-2", isFree: 0, monthlyPriceCents: 1500, stripeSubscriptionId: "sub_2" });
    seedDeployment({ id: "dep-pending", isFree: 0, monthlyPriceCents: 999, stripeSubscriptionId: null });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(2999); // 500 + 1500 + 999
    expect(result.activeSubscriptionCount).toBe(2); // only those with stripeSubscriptionId
  });

  it("subscriptions handles Stripe failure for one subscription among multiple", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    // First sub succeeds
    mockGetSubscriptionDetails
      .mockResolvedValueOnce({
        current_period_start: Math.floor(Date.now() / 1000) - 86400,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 29,
        status: "active",
      })
      // Second sub fails
      .mockRejectedValueOnce(new Error("Not found"));

    seedDeployment({ id: "dep-ok", isFree: 0, stripeSubscriptionId: "sub_ok", monthlyPriceCents: 500 });
    seedDeployment({ id: "dep-fail", isFree: 0, stripeSubscriptionId: "sub_fail", monthlyPriceCents: 1000 });

    const caller = authedCaller();
    const result = await caller.billing.getSubscriptions();

    // Both should still appear (Promise.allSettled), second with defaults
    expect(result).toHaveLength(2);
    const okSub = result.find((s: any) => s.deploymentId === "dep-ok");
    const failSub = result.find((s: any) => s.deploymentId === "dep-fail");
    expect(okSub!.stripeStatus).toBe("active");
    expect(failSub!.stripeStatus).toBe("unknown");
  });

  it("invoices returns correct amountCents for various invoice states", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    ctx.raw.exec(`UPDATE users SET stripe_customer_id = 'cus_mixed' WHERE id = '${ctx.testUserId}'`);

    mockListInvoices.mockResolvedValue([
      { id: "inv_paid", created: 1700000000, description: "Paid", amount_paid: 999, amount_due: 999, status: "paid", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
      { id: "inv_open", created: 1700000000, description: "Open", amount_paid: 0, amount_due: 1500, status: "open", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
      { id: "inv_void", created: 1700000000, description: "Void", amount_paid: 0, amount_due: 0, status: "void", invoice_pdf: null, hosted_invoice_url: null, lines: { data: [] } },
    ]);

    const caller = authedCaller();
    const result = await caller.billing.getInvoices();

    expect(result).toHaveLength(3);
    const paid = result.find((i: any) => i.id === "inv_paid");
    const open = result.find((i: any) => i.id === "inv_open");
    const voided = result.find((i: any) => i.id === "inv_void");

    expect(paid!.amountCents).toBe(999);
    expect(open!.amountCents).toBe(1500);
    expect(voided!.amountCents).toBe(0);
  });

  it("overview returns 0 totalMonthlyCents when all deployments are free", async () => {
    seedDeployment({ id: "dep-all-free-1", isFree: 1, monthlyPriceCents: 0 });
    seedDeployment({ id: "dep-all-free-2", isFree: 1, monthlyPriceCents: 0 });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.totalMonthlyCents).toBe(0);
    expect(result.activeSubscriptionCount).toBe(0);
  });

  it("overview with card.last4 as null returns null paymentMethodLast4", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetSubscriptionDetails.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      default_payment_method: { card: { last4: null } },
    });
    seedDeployment({ isFree: 0, stripeSubscriptionId: "sub_no_last4" });

    const caller = authedCaller();
    const result = await caller.billing.getOverview();

    expect(result.paymentMethodLast4).toBeNull();
  });
});
