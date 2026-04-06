/**
 * Integration tests for the marketplace tRPC router.
 *
 * Tests discovery, installation, reviews, creator tools, and admin moderation.
 * Uses real in-memory SQLite with mocked K8s, Stripe, configSync, and schema validation.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

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
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

const mockSyncMarketplaceComponent = vi.fn().mockResolvedValue(undefined);
const mockRemoveMarketplaceComponent = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/configSync.js", () => ({
  syncMarketplaceComponent: (...args: any[]) => mockSyncMarketplaceComponent(...args),
  removeMarketplaceComponent: (...args: any[]) => mockRemoveMarketplaceComponent(...args),
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/schemaValidation.js", () => ({
  validatePropsSchema: vi.fn(), // no-op by default
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
let idCounter = 0;

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
  idCounter = 0;
});

afterAll(() => {
  ctx?.raw.close();
});

function nextId(prefix: string) {
  idCounter++;
  return `${prefix}_${idCounter}_${Date.now()}`;
}

function authedCaller(overrides?: { userId?: string; auth0Id?: string; emailVerified?: boolean }) {
  return createTestCaller(ctx.db, {
    id: overrides?.userId ?? ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: overrides?.auth0Id ?? ctx.testAuth0Id,
    emailVerified: overrides?.emailVerified ?? true,
  });
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedCreatorProfile(userId?: string) {
  const id = nextId("cp");
  const uid = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO creator_profiles (id, user_id, display_name, bio, created_at, updated_at)
     VALUES ('${id}', '${uid}', 'Test Creator', 'A bio', datetime('now'), datetime('now'))`
  );
  return id;
}

function seedComponent(
  creatorUserId: string,
  overrides?: Partial<{
    name: string;
    status: string;
    tier: string;
    category: string;
    pricingModel: string;
    priceUsdCents: number;
    featuredAt: string;
    totalInstalls: number;
    averageRating: number;
    ratingCount: number;
  }>
) {
  const id = nextId("comp");
  const name = overrides?.name ?? `test_comp_${id}`;
  const status = overrides?.status ?? "published";
  const tier = overrides?.tier ?? "template";
  const category = overrides?.category ?? "display";
  const pricingModel = overrides?.pricingModel ?? "free";
  const priceUsdCents = overrides?.priceUsdCents ?? 0;
  const featuredAt = overrides?.featuredAt ? `'${overrides.featuredAt}'` : "NULL";
  const totalInstalls = overrides?.totalInstalls ?? 0;
  const averageRating = overrides?.averageRating ?? 0;
  const ratingCount = overrides?.ratingCount ?? 0;
  ctx.raw.exec(
    `INSERT INTO marketplace_components
      (id, creator_id, name, display_name, description, bot_description, tier, category,
       pricing_model, price_usd_cents, status, featured_at, published_at,
       tags, example_prompts, total_installs, average_rating, rating_count,
       created_at, updated_at)
     VALUES
      ('${id}', '${creatorUserId}', '${name}', 'Test ${name}', 'Desc for ${name}',
       'Bot desc', '${tier}', '${category}', '${pricingModel}', ${priceUsdCents},
       '${status}', ${featuredAt}, datetime('now'),
       '["tag1","tag2"]', '["Show me a chart"]',
       ${totalInstalls}, ${averageRating}, ${ratingCount},
       datetime('now'), datetime('now'))`
  );
  return id;
}

function seedVersion(componentId: string, version?: string) {
  const id = nextId("ver");
  const ver = version ?? "1.0.0";
  ctx.raw.exec(
    `INSERT INTO component_versions (id, component_id, version, package_url, package_size_bytes, manifest_hash, created_at)
     VALUES ('${id}', '${componentId}', '${ver}', 'https://cdn.example.com/pkg.tar.gz', 1024, 'hash123', datetime('now'))`
  );
  return id;
}

function seedDeployment(status?: string) {
  const id = nextId("dep");
  ctx.raw.exec(
    `INSERT INTO deployments (id, user_id, name, runtime, status, llm_mode, llm_provider, managed_by)
     VALUES ('${id}', '${ctx.testUserId}', 'Test Bot', 'openclaw', '${status ?? "running"}', 'byok', 'openrouter', 'legacy')`
  );
  return id;
}

function seedSecondUser() {
  const userId = nextId("user2");
  const auth0Id = `auth0|${userId}`;
  ctx.raw.exec(
    `INSERT INTO users (id, email, name, auth0_id, email_verified)
     VALUES ('${userId}', '${userId}@test.com', 'User 2', '${auth0Id}', 1)`
  );
  return { userId, auth0Id };
}

function seedInstall(componentId: string, versionId: string, deploymentId: string, userId?: string) {
  const id = nextId("ci");
  const uid = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO component_installs (id, component_id, version_id, deployment_id, user_id, installed_at)
     VALUES ('${id}', '${componentId}', '${versionId}', '${deploymentId}', '${uid}', datetime('now'))`
  );
  return id;
}

function seedPurchase(componentId: string, userId?: string) {
  const id = nextId("pur");
  const uid = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO component_purchases (id, component_id, user_id, amount_cents, platform_fee_cents, creator_payout_cents, status, purchased_at)
     VALUES ('${id}', '${componentId}', '${uid}', 500, 75, 425, 'active', datetime('now'))`
  );
  return id;
}

function seedReview(componentId: string, userId: string, rating: number) {
  const id = nextId("rev");
  ctx.raw.exec(
    `INSERT INTO component_reviews (id, component_id, user_id, rating, title, body, created_at, updated_at)
     VALUES ('${id}', '${componentId}', '${userId}', ${rating}, 'Review title', 'Review body', datetime('now'), datetime('now'))`
  );
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// DISCOVERY (public)
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.browse", () => {
  it("returns empty list when no published components exist", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.browse({});
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns published components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId);
    seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.browse({});
    expect(result.items).toHaveLength(2);
  });

  it("excludes non-published components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { status: "draft" });
    seedComponent(ctx.testUserId, { status: "submitted" });
    seedComponent(ctx.testUserId, { status: "published" });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({});
    expect(result.items).toHaveLength(1);
  });

  it("filters by category", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { category: "display" });
    seedComponent(ctx.testUserId, { category: "charts" });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ category: "charts" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("charts");
  });

  it("filters by tier", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { tier: "template" });
    seedComponent(ctx.testUserId, { tier: "sandbox" });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ tier: "sandbox" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].tier).toBe("sandbox");
  });

  it("filters by pricing (free)", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { pricingModel: "free" });
    seedComponent(ctx.testUserId, { pricingModel: "one_time", priceUsdCents: 500 });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ pricing: "free" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pricingModel).toBe("free");
  });

  it("filters by pricing (paid)", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { pricingModel: "free" });
    seedComponent(ctx.testUserId, { pricingModel: "one_time", priceUsdCents: 500 });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ pricing: "paid" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pricingModel).toBe("one_time");
  });

  it("filters by search term in name", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { name: "weather_widget" });
    seedComponent(ctx.testUserId, { name: "stock_chart" });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ search: "weather" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("weather_widget");
  });

  it("filters by tags", async () => {
    seedCreatorProfile();
    const id1 = seedComponent(ctx.testUserId);
    // Update tags for first component
    ctx.raw.exec(`UPDATE marketplace_components SET tags = '["weather","live"]' WHERE id = '${id1}'`);
    const id2 = seedComponent(ctx.testUserId);
    ctx.raw.exec(`UPDATE marketplace_components SET tags = '["finance","stock"]' WHERE id = '${id2}'`);

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ tags: ["weather"] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(id1);
  });

  it("sorts by popular (totalInstalls desc)", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { totalInstalls: 5 });
    seedComponent(ctx.testUserId, { totalInstalls: 20 });
    seedComponent(ctx.testUserId, { totalInstalls: 10 });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ sort: "popular" });
    expect(result.items[0].totalInstalls).toBe(20);
    expect(result.items[1].totalInstalls).toBe(10);
    expect(result.items[2].totalInstalls).toBe(5);
  });

  it("sorts by top_rated (averageRating desc)", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { averageRating: 300 });
    seedComponent(ctx.testUserId, { averageRating: 450 });
    seedComponent(ctx.testUserId, { averageRating: 100 });

    const caller = authedCaller();
    const result = await caller.marketplace.browse({ sort: "top_rated" });
    expect(result.items[0].averageRating).toBe(450);
    expect(result.items[1].averageRating).toBe(300);
    expect(result.items[2].averageRating).toBe(100);
  });

  it("supports cursor-based pagination", async () => {
    seedCreatorProfile();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(seedComponent(ctx.testUserId, { totalInstalls: 100 - i }));
    }

    const caller = authedCaller();
    const page1 = await caller.marketplace.browse({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await caller.marketplace.browse({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(2);

    const page3 = await caller.marketplace.browse({ limit: 2, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeUndefined();
  });

  it("works for anonymous callers", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId);

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.marketplace.browse({});
    expect(result.items).toHaveLength(1);
  });

  it("includes creator info", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.browse({});
    expect(result.items[0].creator).toBeTruthy();
    expect(result.items[0].creator!.displayName).toBe("Test Creator");
  });
});

describe("marketplace.getById", () => {
  it("returns component with full details", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedVersion(compId, "1.0.0");

    const caller = authedCaller();
    const result = await caller.marketplace.getById({ id: compId });
    expect(result.id).toBe(compId);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].version).toBe("1.0.0");
    expect(result.reviewSummary).toBeDefined();
    expect(result.tags).toEqual(["tag1", "tag2"]);
    expect(result.examplePrompts).toEqual(["Show me a chart"]);
  });

  it("throws NOT_FOUND for missing component", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.getById({ id: "nonexistent" })
    ).rejects.toThrow("Component not found");
  });

  it("returns review summary with distribution", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { ratingCount: 2, averageRating: 400 });
    seedReview(compId, ctx.testUserId, 5);

    const { userId: user2Id } = seedSecondUser();
    seedReview(compId, user2Id, 3);

    const caller = authedCaller();
    const result = await caller.marketplace.getById({ id: compId });
    expect(result.reviewSummary.count).toBe(2);
    expect(result.reviewSummary.distribution[5]).toBe(1);
    expect(result.reviewSummary.distribution[3]).toBe(1);
    expect(result.reviewSummary.distribution[1]).toBe(0);
  });

  it("works for anonymous callers", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.marketplace.getById({ id: compId });
    expect(result.id).toBe(compId);
  });
});

describe("marketplace.getFeatured", () => {
  it("returns only featured components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { featuredAt: "2024-01-01" });
    seedComponent(ctx.testUserId); // not featured

    const caller = authedCaller();
    const result = await caller.marketplace.getFeatured();
    expect(result).toHaveLength(1);
    expect(result[0].featuredAt).toBe("2024-01-01");
  });

  it("returns max 6 featured components", async () => {
    seedCreatorProfile();
    for (let i = 0; i < 8; i++) {
      seedComponent(ctx.testUserId, { featuredAt: `2024-01-0${i + 1}` });
    }

    const caller = authedCaller();
    const result = await caller.marketplace.getFeatured();
    expect(result).toHaveLength(6);
  });

  it("returns empty when no components are featured", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.getFeatured();
    expect(result).toHaveLength(0);
  });

  it("excludes non-published featured components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { status: "draft", featuredAt: "2024-01-01" });

    const caller = authedCaller();
    const result = await caller.marketplace.getFeatured();
    expect(result).toHaveLength(0);
  });
});

describe("marketplace.getCategories", () => {
  it("returns category counts for published components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { category: "display" });
    seedComponent(ctx.testUserId, { category: "display" });
    seedComponent(ctx.testUserId, { category: "charts" });

    const caller = authedCaller();
    const result = await caller.marketplace.getCategories();
    expect(result).toHaveLength(2);

    const displayCat = result.find((c: any) => c.category === "display");
    expect(displayCat!.count).toBe(2);

    const chartsCat = result.find((c: any) => c.category === "charts");
    expect(chartsCat!.count).toBe(1);
  });

  it("excludes non-published components from counts", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { category: "display", status: "draft" });
    seedComponent(ctx.testUserId, { category: "display", status: "published" });

    const caller = authedCaller();
    const result = await caller.marketplace.getCategories();
    const displayCat = result.find((c: any) => c.category === "display");
    expect(displayCat!.count).toBe(1);
  });

  it("sorts categories by count descending", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { category: "charts" });
    seedComponent(ctx.testUserId, { category: "display" });
    seedComponent(ctx.testUserId, { category: "display" });
    seedComponent(ctx.testUserId, { category: "display" });

    const caller = authedCaller();
    const result = await caller.marketplace.getCategories();
    expect(result[0].category).toBe("display");
    expect(result[0].count).toBe(3);
    expect(result[1].category).toBe("charts");
    expect(result[1].count).toBe(1);
  });
});

describe("marketplace.builtinSchemas", () => {
  it("returns all builtin schemas when no component specified", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.builtinSchemas();
    expect(Object.keys(result).length).toBeGreaterThan(0);
    // Should not include the "canvas" alias
    expect(result).not.toHaveProperty("canvas");
  });

  it("returns a single schema by component name", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.builtinSchemas({ component: "card" });
    expect(result).toHaveProperty("card");
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("throws NOT_FOUND for unknown component name", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.builtinSchemas({ component: "nonexistent_widget" })
    ).rejects.toThrow('Unknown component "nonexistent_widget"');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INSTALLATION (protected)
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.install", () => {
  it("installs a free component on a deployment", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.marketplace.install({
      componentId: compId,
      deploymentId: depId,
    });
    expect(result.success).toBe(true);
    expect(result.installedVersion).toBe("1.0.0");
  });

  it("increments totalInstalls on the component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { totalInstalls: 5 });
    seedVersion(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    await caller.marketplace.install({ componentId: compId, deploymentId: depId });

    const row = ctx.raw.prepare("SELECT total_installs FROM marketplace_components WHERE id = ?").get(compId) as any;
    expect(row.total_installs).toBe(6);
  });

  it("rejects if component is already installed (CONFLICT)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: compId, deploymentId: depId })
    ).rejects.toThrow("already installed");
  });

  it("rejects for non-existent deployment (NOT_FOUND)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedVersion(compId);

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: compId, deploymentId: "nonexistent" })
    ).rejects.toThrow("Deployment not found");
  });

  it("rejects for non-existent component (NOT_FOUND)", async () => {
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: "nonexistent", deploymentId: depId })
    ).rejects.toThrow("Component not found");
  });

  it("rejects unpublished component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { status: "draft" });
    seedVersion(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: compId, deploymentId: depId })
    ).rejects.toThrow("Component not found");
  });

  it("rejects paid component without purchase (FORBIDDEN)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { pricingModel: "one_time", priceUsdCents: 500 });
    seedVersion(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: compId, deploymentId: depId })
    ).rejects.toThrow("must purchase");
  });

  it("allows paid component install with active purchase", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { pricingModel: "one_time", priceUsdCents: 500 });
    seedVersion(compId);
    seedPurchase(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.marketplace.install({ componentId: compId, deploymentId: depId });
    expect(result.success).toBe(true);
  });

  it("installs a specific version when versionId is provided", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedVersion(compId, "1.0.0");
    const v2Id = seedVersion(compId, "2.0.0");
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.marketplace.install({
      componentId: compId,
      deploymentId: depId,
      versionId: v2Id,
    });
    expect(result.installedVersion).toBe("2.0.0");
  });

  it("rejects another user's deployment", async () => {
    const { userId: user2Id } = seedSecondUser();
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedVersion(compId);

    // Create deployment owned by user2
    const depId = nextId("dep");
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status, llm_mode, llm_provider, managed_by)
       VALUES ('${depId}', '${user2Id}', 'Other Bot', 'openclaw', 'running', 'byok', 'openrouter', 'legacy')`
    );

    const caller = authedCaller();
    await expect(
      caller.marketplace.install({ componentId: compId, deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });

  it("fires syncMarketplaceComponent for running deployment", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedVersion(compId);
    const depId = seedDeployment("running");

    const caller = authedCaller();
    await caller.marketplace.install({ componentId: compId, deploymentId: depId });

    // Wait a tick for fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSyncMarketplaceComponent).toHaveBeenCalledWith(
      depId,
      compId,
      expect.any(String),  // componentName
      expect.any(Object),  // manifest
      null,                // componentDefinition (null when no exampleProps)
      "template"
    );
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.marketplace.install({ componentId: "x", deploymentId: "y" })
    ).rejects.toThrow("must be logged in");
  });
});

describe("marketplace.uninstall", () => {
  it("uninstalls an installed component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    const result = await caller.marketplace.uninstall({ componentId: compId, deploymentId: depId });
    expect(result.success).toBe(true);

    // Verify install is removed
    const install = ctx.raw.prepare(
      "SELECT * FROM component_installs WHERE component_id = ? AND deployment_id = ?"
    ).get(compId, depId);
    expect(install).toBeUndefined();
  });

  it("rejects if not installed (NOT_FOUND)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.marketplace.uninstall({ componentId: compId, deploymentId: depId })
    ).rejects.toThrow("not installed");
  });

  it("rejects for non-existent deployment", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.uninstall({ componentId: "x", deploymentId: "nonexistent" })
    ).rejects.toThrow("Deployment not found");
  });

  it("fires removeMarketplaceComponent for running deployment", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment("running");
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    await caller.marketplace.uninstall({ componentId: compId, deploymentId: depId });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockRemoveMarketplaceComponent).toHaveBeenCalledWith(depId, compId, expect.any(String));
  });
});

describe("marketplace.listInstalled", () => {
  it("returns installed components with details", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    const result = await caller.marketplace.listInstalled({ deploymentId: depId });
    expect(result).toHaveLength(1);
    expect(result[0].component!.id).toBe(compId);
    expect(result[0].version).toBe("1.0.0");
  });

  it("returns empty array when nothing installed", async () => {
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.marketplace.listInstalled({ deploymentId: depId });
    expect(result).toEqual([]);
  });

  it("rejects for another user's deployment", async () => {
    const { userId: user2Id } = seedSecondUser();
    const depId = nextId("dep");
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status, llm_mode, llm_provider, managed_by)
       VALUES ('${depId}', '${user2Id}', 'Other Bot', 'openclaw', 'running', 'byok', 'openrouter', 'legacy')`
    );

    const caller = authedCaller();
    await expect(
      caller.marketplace.listInstalled({ deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("marketplace.updateVersion", () => {
  it("updates the installed version", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const v1Id = seedVersion(compId, "1.0.0");
    const v2Id = seedVersion(compId, "2.0.0");
    const depId = seedDeployment();
    seedInstall(compId, v1Id, depId);

    const caller = authedCaller();
    const result = await caller.marketplace.updateVersion({
      componentId: compId,
      deploymentId: depId,
      versionId: v2Id,
    });
    expect(result.success).toBe(true);
    expect(result.version).toBe("2.0.0");
  });

  it("rejects if component not installed", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.marketplace.updateVersion({
        componentId: compId,
        deploymentId: depId,
        versionId: verId,
      })
    ).rejects.toThrow("not installed");
  });

  it("rejects for nonexistent version", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    await expect(
      caller.marketplace.updateVersion({
        componentId: compId,
        deploymentId: depId,
        versionId: "nonexistent",
      })
    ).rejects.toThrow("Version not found");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASES (protected)
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.createCheckout", () => {
  it("throws PRECONDITION_FAILED (placeholder)", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.createCheckout({ componentId: "x", deploymentId: "y" })
    ).rejects.toThrow("Paid marketplace coming soon");
  });
});

describe("marketplace.getPurchases", () => {
  it("returns user's purchases", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedPurchase(compId);

    const caller = authedCaller();
    const result = await caller.marketplace.getPurchases();
    expect(result).toHaveLength(1);
    expect(result[0].componentId).toBe(compId);
    expect(result[0].amountCents).toBe(500);
    expect(result[0].component).toBeTruthy();
    expect(result[0].component!.id).toBe(compId);
  });

  it("returns empty array when no purchases", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.getPurchases();
    expect(result).toEqual([]);
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(caller.marketplace.getPurchases()).rejects.toThrow("must be logged in");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REVIEWS (mixed)
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.getReviews", () => {
  it("returns reviews sorted by newest", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedReview(compId, ctx.testUserId, 5);

    const { userId: user2Id } = seedSecondUser();
    seedReview(compId, user2Id, 3);

    const caller = authedCaller();
    const result = await caller.marketplace.getReviews({ componentId: compId });
    expect(result.items).toHaveLength(2);
    expect(result.summary.count).toBe(2);
    expect(result.summary.averageRating).toBe(4); // (5+3)/2 = 4
  });

  it("sorts by highest rating", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedReview(compId, ctx.testUserId, 2);

    const { userId: user2Id } = seedSecondUser();
    seedReview(compId, user2Id, 5);

    const caller = authedCaller();
    const result = await caller.marketplace.getReviews({
      componentId: compId,
      sort: "highest",
    });
    expect(result.items[0].rating).toBe(5);
    expect(result.items[1].rating).toBe(2);
  });

  it("sorts by lowest rating", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedReview(compId, ctx.testUserId, 5);

    const { userId: user2Id } = seedSecondUser();
    seedReview(compId, user2Id, 1);

    const caller = authedCaller();
    const result = await caller.marketplace.getReviews({
      componentId: compId,
      sort: "lowest",
    });
    expect(result.items[0].rating).toBe(1);
    expect(result.items[1].rating).toBe(5);
  });

  it("paginates reviews with cursor", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    // Create 3 reviews from multiple users
    seedReview(compId, ctx.testUserId, 5);
    const { userId: u2 } = seedSecondUser();
    seedReview(compId, u2, 4);

    const caller = authedCaller();
    const page1 = await caller.marketplace.getReviews({
      componentId: compId,
      limit: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeDefined();

    // page2 has 1 item which equals limit, so nextCursor may still be set
    const page2 = await caller.marketplace.getReviews({
      componentId: compId,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("returns empty for component with no reviews", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.getReviews({ componentId: compId });
    expect(result.items).toEqual([]);
    expect(result.summary.count).toBe(0);
    expect(result.summary.averageRating).toBe(0);
  });

  it("works for anonymous callers", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    seedReview(compId, ctx.testUserId, 4);

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.marketplace.getReviews({ componentId: compId });
    expect(result.items).toHaveLength(1);
  });
});

describe("marketplace.createReview", () => {
  it("creates a review for an installed component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    const result = await caller.marketplace.createReview({
      componentId: compId,
      rating: 5,
      title: "Great component",
      body: "Works perfectly",
    });
    expect(result.success).toBe(true);

    // Check the review in DB
    const review = ctx.raw.prepare(
      "SELECT * FROM component_reviews WHERE component_id = ? AND user_id = ?"
    ).get(compId, ctx.testUserId) as any;
    expect(review.rating).toBe(5);
    expect(review.title).toBe("Great component");
  });

  it("updates existing review (upsert)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    await caller.marketplace.createReview({ componentId: compId, rating: 3 });
    await caller.marketplace.createReview({ componentId: compId, rating: 5 });

    const reviews = ctx.raw.prepare(
      "SELECT * FROM component_reviews WHERE component_id = ? AND user_id = ?"
    ).all(compId, ctx.testUserId);
    expect(reviews).toHaveLength(1);
    expect((reviews[0] as any).rating).toBe(5);
  });

  it("recalculates average rating on component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);
    const verId = seedVersion(compId);
    const depId = seedDeployment();
    seedInstall(compId, verId, depId);

    const caller = authedCaller();
    await caller.marketplace.createReview({ componentId: compId, rating: 4 });

    const comp = ctx.raw.prepare(
      "SELECT average_rating, rating_count FROM marketplace_components WHERE id = ?"
    ).get(compId) as any;
    // averageRating stored as scaled: 4.0 * 100 = 400
    expect(comp.average_rating).toBe(400);
    expect(comp.rating_count).toBe(1);
  });

  it("rejects review without installation (FORBIDDEN)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);

    const caller = authedCaller();
    await expect(
      caller.marketplace.createReview({ componentId: compId, rating: 5 })
    ).rejects.toThrow("must have this component installed");
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.marketplace.createReview({ componentId: "x", rating: 5 })
    ).rejects.toThrow("must be logged in");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATOR (protected)
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.createCreatorProfile", () => {
  it("creates a creator profile", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.createCreatorProfile({
      displayName: "My Creator",
      bio: "I build cool stuff",
    });
    expect(result.id).toBeTruthy();

    const profile = ctx.raw.prepare(
      "SELECT * FROM creator_profiles WHERE user_id = ?"
    ).get(ctx.testUserId) as any;
    expect(profile.display_name).toBe("My Creator");
    expect(profile.bio).toBe("I build cool stuff");
  });

  it("rejects duplicate profile (CONFLICT)", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    await expect(
      caller.marketplace.createCreatorProfile({ displayName: "Duplicate" })
    ).rejects.toThrow("already exists");
  });

  it("creates profile with optional website URL", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.createCreatorProfile({
      displayName: "Creator",
      websiteUrl: "https://example.com",
    });
    expect(result.id).toBeTruthy();

    const profile = ctx.raw.prepare(
      "SELECT website_url FROM creator_profiles WHERE id = ?"
    ).get(result.id) as any;
    expect(profile.website_url).toBe("https://example.com");
  });

  it("rejects anonymous requests", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.marketplace.createCreatorProfile({ displayName: "Anon" })
    ).rejects.toThrow("must be logged in");
  });
});

describe("marketplace.getCreatorProfile", () => {
  it("returns profile with published components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { status: "published" });
    seedComponent(ctx.testUserId, { status: "draft" }); // should be excluded

    const caller = authedCaller();
    const result = await caller.marketplace.getCreatorProfile({ userId: ctx.testUserId });
    expect(result.displayName).toBe("Test Creator");
    expect(result.components).toHaveLength(1);
  });

  it("throws NOT_FOUND for non-existent profile", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.getCreatorProfile({ userId: "nonexistent" })
    ).rejects.toThrow("Creator profile not found");
  });

  it("works for anonymous callers", async () => {
    seedCreatorProfile();

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.marketplace.getCreatorProfile({ userId: ctx.testUserId });
    expect(result.displayName).toBe("Test Creator");
  });
});

describe("marketplace.submitComponent", () => {
  it("creates a draft component and initial version", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    const result = await caller.marketplace.submitComponent({
      name: "my_widget",
      displayName: "My Widget",
      description: "A cool widget",
      tier: "template",
      category: "display",
      propsSchema: '{"type":"object","properties":{"title":{"type":"string"}}}',
    });
    expect(result.componentId).toBeTruthy();

    // Verify component in DB
    const comp = ctx.raw.prepare(
      "SELECT * FROM marketplace_components WHERE id = ?"
    ).get(result.componentId) as any;
    expect(comp.status).toBe("draft");
    expect(comp.name).toBe("my_widget");
    expect(comp.tier).toBe("template");

    // Verify initial version
    const version = ctx.raw.prepare(
      "SELECT * FROM component_versions WHERE component_id = ?"
    ).get(result.componentId) as any;
    expect(version.version).toBe("1.0.0");
  });

  it("rejects without creator profile (PRECONDITION_FAILED)", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.submitComponent({
        name: "my_widget",
        displayName: "My Widget",
        description: "A widget",
        tier: "template",
        category: "display",
        propsSchema: '{"type":"object"}',
      })
    ).rejects.toThrow("must create a creator profile");
  });

  it("rejects duplicate name from same creator (CONFLICT)", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { name: "my_widget" });

    const caller = authedCaller();
    await expect(
      caller.marketplace.submitComponent({
        name: "my_widget",
        displayName: "Duplicate",
        description: "Dupe",
        tier: "template",
        category: "display",
        propsSchema: '{"type":"object"}',
      })
    ).rejects.toThrow("already have a component with this name");
  });

  it("saves tags and example prompts", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    const result = await caller.marketplace.submitComponent({
      name: "tagged_widget",
      displayName: "Tagged Widget",
      description: "Has tags",
      tier: "template",
      category: "display",
      tags: ["weather", "live"],
      examplePrompts: ["Show me the weather"],
      propsSchema: '{"type":"object"}',
    });

    const comp = ctx.raw.prepare("SELECT tags, example_prompts FROM marketplace_components WHERE id = ?")
      .get(result.componentId) as any;
    expect(JSON.parse(comp.tags)).toEqual(["weather", "live"]);
    expect(JSON.parse(comp.example_prompts)).toEqual(["Show me the weather"]);
  });

  it("supports paid pricing model", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    const result = await caller.marketplace.submitComponent({
      name: "paid_widget",
      displayName: "Paid Widget",
      description: "Premium",
      tier: "sandbox",
      category: "charts",
      pricingModel: "one_time",
      priceUsdCents: 999,
      propsSchema: '{"type":"object"}',
    });

    const comp = ctx.raw.prepare("SELECT pricing_model, price_usd_cents FROM marketplace_components WHERE id = ?")
      .get(result.componentId) as any;
    expect(comp.pricing_model).toBe("one_time");
    expect(comp.price_usd_cents).toBe(999);
  });
});

describe("marketplace.publishComponent", () => {
  it("auto-publishes template components", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    const { componentId } = await caller.marketplace.submitComponent({
      name: "template_widget",
      displayName: "Template Widget",
      description: "A template",
      tier: "template",
      category: "display",
      propsSchema: '{"type":"object"}',
    });

    const result = await caller.marketplace.publishComponent({ componentId });
    expect(result.status).toBe("published");

    const comp = ctx.raw.prepare("SELECT status, published_at FROM marketplace_components WHERE id = ?")
      .get(componentId) as any;
    expect(comp.status).toBe("published");
    expect(comp.published_at).toBeTruthy();
  });

  it("submits sandbox components for review", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    const { componentId } = await caller.marketplace.submitComponent({
      name: "sandbox_widget",
      displayName: "Sandbox Widget",
      description: "A sandbox",
      tier: "sandbox",
      category: "display",
      propsSchema: '{"type":"object"}',
    });

    const result = await caller.marketplace.publishComponent({ componentId });
    expect(result.status).toBe("submitted");

    const comp = ctx.raw.prepare("SELECT status FROM marketplace_components WHERE id = ?")
      .get(componentId) as any;
    expect(comp.status).toBe("submitted");
  });

  it("rejects publishing non-draft component", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { status: "published" });

    const caller = authedCaller();
    await expect(
      caller.marketplace.publishComponent({ componentId: compId })
    ).rejects.toThrow('must be "draft" to publish');
  });

  it("rejects publishing component owned by another user", async () => {
    const { userId: user2Id } = seedSecondUser();
    seedCreatorProfile(user2Id);
    const compId = seedComponent(user2Id, { status: "draft" });

    const caller = authedCaller();
    await expect(
      caller.marketplace.publishComponent({ componentId: compId })
    ).rejects.toThrow("do not own");
  });

  it("rejects non-existent component", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.publishComponent({ componentId: "nonexistent" })
    ).rejects.toThrow("Component not found");
  });
});

describe("marketplace.updateComponent", () => {
  it("updates display name and description", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.updateComponent({
      componentId: compId,
      displayName: "Updated Name",
      description: "Updated description",
    });
    expect(result.success).toBe(true);

    const comp = ctx.raw.prepare("SELECT display_name, description FROM marketplace_components WHERE id = ?")
      .get(compId) as any;
    expect(comp.display_name).toBe("Updated Name");
    expect(comp.description).toBe("Updated description");
  });

  it("updates tags", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId);

    const caller = authedCaller();
    await caller.marketplace.updateComponent({
      componentId: compId,
      tags: ["new_tag", "another"],
    });

    const comp = ctx.raw.prepare("SELECT tags FROM marketplace_components WHERE id = ?")
      .get(compId) as any;
    expect(JSON.parse(comp.tags)).toEqual(["new_tag", "another"]);
  });

  it("rejects updating another user's component (FORBIDDEN)", async () => {
    const { userId: user2Id } = seedSecondUser();
    seedCreatorProfile(user2Id);
    const compId = seedComponent(user2Id);

    const caller = authedCaller();
    await expect(
      caller.marketplace.updateComponent({ componentId: compId, displayName: "Hacked" })
    ).rejects.toThrow("do not own");
  });

  it("rejects non-existent component", async () => {
    const caller = authedCaller();
    await expect(
      caller.marketplace.updateComponent({ componentId: "nonexistent", displayName: "X" })
    ).rejects.toThrow("Component not found");
  });
});

describe("marketplace.myComponents", () => {
  it("returns all components for current user", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, { status: "draft" });
    seedComponent(ctx.testUserId, { status: "published" });

    const caller = authedCaller();
    const result = await caller.marketplace.myComponents();
    expect(result).toHaveLength(2);
  });

  it("does not return other user's components", async () => {
    const { userId: user2Id } = seedSecondUser();
    seedCreatorProfile(user2Id);
    seedComponent(user2Id);

    seedCreatorProfile();
    seedComponent(ctx.testUserId);

    const caller = authedCaller();
    const result = await caller.marketplace.myComponents();
    expect(result).toHaveLength(1);
  });

  it("returns empty array when user has no components", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.myComponents();
    expect(result).toEqual([]);
  });

  it("sorts by createdAt descending", async () => {
    seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "first_comp" });
    // Make second component have a later timestamp
    ctx.raw.exec(`UPDATE marketplace_components SET created_at = datetime('now', '+1 second') WHERE id = '${seedComponent(ctx.testUserId, { name: "second_comp" })}'`);

    const caller = authedCaller();
    const result = await caller.marketplace.myComponents();
    expect(result).toHaveLength(2);
    // Most recent should be first
    expect(result[0].name).toBe("second_comp");
  });
});

describe("marketplace.getCreatorAnalytics", () => {
  it("returns aggregate stats across all components", async () => {
    seedCreatorProfile();
    seedComponent(ctx.testUserId, {
      totalInstalls: 10,
      averageRating: 400,
      ratingCount: 5,
      status: "published",
    });
    seedComponent(ctx.testUserId, {
      totalInstalls: 20,
      averageRating: 300,
      ratingCount: 3,
      status: "published",
    });
    seedComponent(ctx.testUserId, { status: "draft" });

    const caller = authedCaller();
    const result = await caller.marketplace.getCreatorAnalytics();
    expect(result.totalComponents).toBe(3);
    expect(result.publishedComponents).toBe(2);
    expect(result.totalInstalls).toBe(30);
    expect(result.totalRatingCount).toBe(8);
  });

  it("returns single component stats when componentId specified", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, {
      totalInstalls: 15,
      averageRating: 450,
      ratingCount: 7,
    });

    const caller = authedCaller();
    const result = await caller.marketplace.getCreatorAnalytics({ componentId: compId });
    expect(result.totalInstalls).toBe(15);
    expect(result.averageRating).toBe(450);
    expect(result.ratingCount).toBe(7);
  });

  it("rejects analytics for another user's component", async () => {
    const { userId: user2Id } = seedSecondUser();
    seedCreatorProfile(user2Id);
    const compId = seedComponent(user2Id);

    const caller = authedCaller();
    await expect(
      caller.marketplace.getCreatorAnalytics({ componentId: compId })
    ).rejects.toThrow("Component not found");
  });

  it("returns zeros when user has no components", async () => {
    const caller = authedCaller();
    const result = await caller.marketplace.getCreatorAnalytics();
    expect(result.totalComponents).toBe(0);
    expect(result.totalInstalls).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════════════════

describe("marketplace.getReviewQueue", () => {
  it("rejects non-admin users (FORBIDDEN)", async () => {
    const caller = authedCaller();
    await expect(caller.marketplace.getReviewQueue()).rejects.toThrow("Admin access required");
  });
});

describe("marketplace.approveComponent", () => {
  it("rejects non-admin users (FORBIDDEN)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { status: "submitted" });

    const caller = authedCaller();
    await expect(
      caller.marketplace.approveComponent({ componentId: compId })
    ).rejects.toThrow("Admin access required");
  });
});

describe("marketplace.rejectComponent", () => {
  it("rejects non-admin users (FORBIDDEN)", async () => {
    seedCreatorProfile();
    const compId = seedComponent(ctx.testUserId, { status: "submitted" });

    const caller = authedCaller();
    await expect(
      caller.marketplace.rejectComponent({ componentId: compId, notes: "Bad" })
    ).rejects.toThrow("Admin access required");
  });
});
