/**
 * Tests for orphan deployment-id prevention in flows.
 *
 * Covers:
 *  - getDefinitionDeploymentIds — reads top-level + nested config IDs
 *  - validateDeploymentReferences — ownership and cross-owner checks
 *  - flows.create / flows.update — Strategy D rejection
 *  - flows.duplicate — Strategy D auto-strip on fork
 *
 * See docs/audits/stale-flow-deployment-ids.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import * as sqliteSchema from "../../db/schema.sqlite.js";

let ctx: TestDbContext;

// ── Mocks (mirror flows.test.ts pattern) ─────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
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

vi.mock("../../db/index.js", () => ({
  get db() {
    return ctx.db;
  },
  tables: sqliteSchema,
  dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
}));

vi.mock("../../services/stripe.js", () => ({
  isStripeConfigured: vi.fn().mockReturnValue(false),
  getSubscriptionDetails: vi.fn(),
  listInvoices: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  sumSubscriptionItemsCents: vi.fn().mockReturnValue(0),
  getSubscriptionBreakdown: vi.fn().mockReturnValue({
    baseCents: 0,
    managedKeyCents: 0,
    totalCents: 0,
  }),
}));

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi
    .fn()
    .mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi
    .fn()
    .mockResolvedValue({ logs: "", podName: null }),
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
  provisionOpenRouterKey: vi
    .fn()
    .mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

// Import AFTER mocks (vi.mock is hoisted)
import { appRouter } from "../../trpc/index.js";
import type { Context } from "../../trpc/context.js";
import {
  getDefinitionDeploymentIds,
  validateDeploymentReferences,
} from "../../trpc/routers/flows.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: "test-user-001",
  email: "test@jarble.ai",
  name: "Test User",
  auth0Id: "auth0|test-integration-001",
  emailVerified: true,
  freeDeploymentUsed: false,
};

function makeCaller(user: any = TEST_USER) {
  const c: Context = {
    user: user as any,
    db: ctx.db as any,
    requestId: "test-request",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ip: null,
  };
  return appRouter.createCaller(c);
}

/** Insert a deployment row owned by the given user, returning its id. */
function seedDeployment(opts: {
  id: string;
  userId?: string;
  orgId?: string | null;
  name?: string;
}) {
  ctx.raw
    .prepare(
      `INSERT INTO deployments (id, user_id, name, runtime, deployment_type, runtime_catalog_id, status, llm_mode, llm_provider, managed_by, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.userId ?? TEST_USER.id,
      opts.name ?? `Deployment ${opts.id}`,
      "openclaw",
      "agent",
      ctx.openclawCatalogId,
      "running",
      "byok",
      "openrouter",
      "legacy",
      opts.orgId ?? null,
    );
  return opts.id;
}

function seedOrgWithMember(orgId: string, userId: string) {
  // Create an owner user for the org if needed (use TEST_USER by default)
  const ownerId = userId;
  ctx.raw
    .prepare(
      `INSERT INTO organizations (id, name, slug, owner_id) VALUES (?, ?, ?, ?)`,
    )
    .run(orgId, `Org ${orgId}`, `org-${orgId}`, ownerId);
  ctx.raw
    .prepare(
      `INSERT INTO org_members (id, org_id, user_id, role) VALUES (?, ?, ?, ?)`,
    )
    .run(`member-${orgId}-${userId}`, orgId, userId, "owner");
}

const DEF_WITH_DEPLOYMENT = (deploymentId: string) => ({
  nodes: [
    {
      id: "n1",
      type: "deployment" as const,
      label: "Step 1",
      position: { x: 0, y: 0 },
      deploymentId,
    },
    {
      id: "n2",
      type: "output" as const,
      label: "Out",
      position: { x: 200, y: 0 },
    },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
});

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => {
  if (ctx) ctx.raw.close();
});

// ── getDefinitionDeploymentIds ───────────────────────────────────────────────

describe("getDefinitionDeploymentIds", () => {
  it("reads top-level node.deploymentId", () => {
    const def = {
      nodes: [
        { id: "n1", deploymentId: "dep-aaa" },
        { id: "n2", deploymentId: "dep-bbb" },
      ],
    };
    const ids = getDefinitionDeploymentIds(def);
    expect(Array.from(ids).sort()).toEqual(["dep-aaa", "dep-bbb"]);
  });

  it("reads nested node.config.deploymentId", () => {
    const def = {
      nodes: [
        { id: "n1", config: { deploymentId: "dep-from-config" } },
        { id: "n2" },
      ],
    };
    const ids = getDefinitionDeploymentIds(def);
    expect(Array.from(ids)).toEqual(["dep-from-config"]);
  });

  it("deduplicates when both top-level and config reference the same id", () => {
    const def = {
      nodes: [
        {
          id: "n1",
          deploymentId: "dep-shared",
          config: { deploymentId: "dep-shared" },
        },
        {
          id: "n2",
          deploymentId: "dep-shared",
        },
      ],
    };
    const ids = getDefinitionDeploymentIds(def);
    expect(ids.size).toBe(1);
    expect(Array.from(ids)).toEqual(["dep-shared"]);
  });

  it("returns an empty set for an empty / null definition", () => {
    expect(getDefinitionDeploymentIds(null).size).toBe(0);
    expect(getDefinitionDeploymentIds(undefined).size).toBe(0);
    expect(getDefinitionDeploymentIds({}).size).toBe(0);
    expect(getDefinitionDeploymentIds({ nodes: [] }).size).toBe(0);
  });

  it("ignores non-string deploymentId values defensively", () => {
    const def = {
      nodes: [
        { id: "n1", deploymentId: 123 as any },
        { id: "n2", config: { deploymentId: { weird: true } as any } },
        { id: "n3", deploymentId: "dep-real" },
      ],
    };
    const ids = getDefinitionDeploymentIds(def);
    expect(Array.from(ids)).toEqual(["dep-real"]);
  });
});

// ── validateDeploymentReferences ─────────────────────────────────────────────

describe("validateDeploymentReferences", () => {
  it("returns ok when all references exist and are owned by the caller", async () => {
    seedDeployment({ id: "dep-mine-1" });
    seedDeployment({ id: "dep-mine-2" });

    const def = {
      nodes: [
        { id: "n1", deploymentId: "dep-mine-1" },
        { id: "n2", deploymentId: "dep-mine-2" },
      ],
    };
    const result = await validateDeploymentReferences(def, TEST_USER.id);
    expect(result.ok).toBe(true);
  });

  it("returns ok when there are zero referenced deployments", async () => {
    const def = { nodes: [{ id: "n1", type: "output" }] };
    const result = await validateDeploymentReferences(def, TEST_USER.id);
    expect(result.ok).toBe(true);
  });

  it("returns not-ok when one referenced deployment is missing", async () => {
    seedDeployment({ id: "dep-real" });

    const def = {
      nodes: [
        { id: "n1", deploymentId: "dep-real" },
        { id: "n2", deploymentId: "dep-ghost" },
      ],
    };
    const result = await validateDeploymentReferences(def, TEST_USER.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("dep-ghost");
      expect(result.message).not.toContain("dep-real");
    }
  });

  it("returns not-ok when a referenced deployment exists but belongs to another user", async () => {
    // Create a second user with their own deployment
    ctx.raw.exec(
      `INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user-other', 'other@test.com', 'Other', 'auth0|other', 1)`,
    );
    seedDeployment({ id: "dep-theirs", userId: "user-other" });

    const def = { nodes: [{ id: "n1", deploymentId: "dep-theirs" }] };
    const result = await validateDeploymentReferences(def, TEST_USER.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("dep-theirs");
    }
  });

  it("returns ok when the referenced deployment is owned by an org the caller is a member of", async () => {
    seedOrgWithMember("org-1", TEST_USER.id);
    seedDeployment({
      id: "dep-org-owned",
      // user_id is some other user, but the deployment lives in TEST_USER's org
      userId: TEST_USER.id, // user_id NOT NULL constraint
      orgId: "org-1",
    });

    // Now create a SECOND user who is also in the same org and try to validate
    // a reference to the org's deployment as that other user.
    ctx.raw.exec(
      `INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('user-coworker', 'coworker@test.com', 'Coworker', 'auth0|coworker', 1)`,
    );
    ctx.raw
      .prepare(
        `INSERT INTO org_members (id, org_id, user_id, role) VALUES (?, ?, ?, ?)`,
      )
      .run("member-org-1-coworker", "org-1", "user-coworker", "member");

    const def = { nodes: [{ id: "n1", deploymentId: "dep-org-owned" }] };
    const result = await validateDeploymentReferences(def, "user-coworker");
    expect(result.ok).toBe(true);
  });
});

// ── flows.create — Strategy D rejection ──────────────────────────────────────

describe("flows.create with orphan validation", () => {
  it("creates the flow when all deployment references are valid", async () => {
    const depId = seedDeployment({ id: "dep-valid" });
    const result = await makeCaller().flows.create({
      name: "Valid Flow",
      definition: DEF_WITH_DEPLOYMENT(depId),
    });
    expect(result.id).toMatch(/^flw_/);
  });

  it("rejects with BAD_REQUEST when a referenced deploymentId does not exist", async () => {
    await expect(
      makeCaller().flows.create({
        name: "Orphan Flow",
        definition: DEF_WITH_DEPLOYMENT("dep-ghost-999"),
      }),
    ).rejects.toThrow(/dep-ghost-999/);
  });

  it("rejects when a referenced deploymentId belongs to another user", async () => {
    ctx.raw.exec(
      `INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('hostile', 'hostile@test.com', 'Hostile', 'auth0|hostile', 1)`,
    );
    seedDeployment({ id: "dep-hostile", userId: "hostile" });

    await expect(
      makeCaller().flows.create({
        name: "Stealing",
        definition: DEF_WITH_DEPLOYMENT("dep-hostile"),
      }),
    ).rejects.toThrow(/dep-hostile/);
  });
});

// ── flows.update — Strategy D rejection ──────────────────────────────────────

describe("flows.update with orphan validation", () => {
  it("rejects when a new definition introduces an orphan reference", async () => {
    const depId = seedDeployment({ id: "dep-good" });
    const { id } = await makeCaller().flows.create({
      name: "Original",
      definition: DEF_WITH_DEPLOYMENT(depId),
    });

    await expect(
      makeCaller().flows.update({
        id,
        definition: DEF_WITH_DEPLOYMENT("dep-not-real"),
      }),
    ).rejects.toThrow(/dep-not-real/);
  });

  it("does NOT validate when definition is omitted (partial update)", async () => {
    const depId = seedDeployment({ id: "dep-keep" });
    const { id } = await makeCaller().flows.create({
      name: "Partial",
      definition: DEF_WITH_DEPLOYMENT(depId),
    });

    // Updating only the name should NOT trigger the validator.
    const result = await makeCaller().flows.update({
      id,
      name: "Renamed",
    });
    expect(result.success).toBe(true);
  });
});

// ── flows.duplicate — strip stale nodes during fork ──────────────────────────

describe("flows.duplicate with stale-ref stripping", () => {
  it("strips stale deployment nodes during duplication", async () => {
    // Seed two valid deployments
    seedDeployment({ id: "dep-keep-a" });
    seedDeployment({ id: "dep-keep-b" });

    // Build a 3-node flow definition where the middle node references a
    // (later) deleted deployment. We insert it directly via raw SQL so we
    // can include the stale id (the create validator would have blocked it).
    const def = {
      nodes: [
        {
          id: "n1",
          type: "deployment",
          label: "A",
          position: { x: 0, y: 0 },
          deploymentId: "dep-keep-a",
        },
        {
          id: "n2",
          type: "deployment",
          label: "Stale",
          position: { x: 200, y: 0 },
          deploymentId: "dep-stale-xxx",
        },
        {
          id: "n3",
          type: "deployment",
          label: "B",
          position: { x: 400, y: 0 },
          deploymentId: "dep-keep-b",
        },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
      ],
    };
    ctx.raw.exec(
      `INSERT INTO orchestration_flows (id, user_id, name, definition, status, is_public, fork_count, created_at, updated_at)
       VALUES ('flw_with_stale', '${TEST_USER.id}', 'Source', '${JSON.stringify(def).replace(/'/g, "''")}', 'draft', 0, 0, datetime('now'), datetime('now'));`,
    );

    const { id: forkId } = await makeCaller().flows.duplicate({
      sourceFlowId: "flw_with_stale",
    });

    const fork = await makeCaller().flows.getById({ id: forkId });
    const forkDef = JSON.parse(fork.definition as string);
    expect(forkDef.nodes).toHaveLength(2);
    expect(forkDef.nodes.map((n: any) => n.id).sort()).toEqual(["n1", "n3"]);
    // Both edges touched the stripped node, so both should be removed
    expect(forkDef.edges).toHaveLength(0);
  });

  it("preserves all nodes when no stale references are present", async () => {
    const depId = seedDeployment({ id: "dep-clean" });
    const { id } = await makeCaller().flows.create({
      name: "Clean",
      definition: DEF_WITH_DEPLOYMENT(depId),
    });
    const { id: forkId } = await makeCaller().flows.duplicate({
      sourceFlowId: id,
    });
    const fork = await makeCaller().flows.getById({ id: forkId });
    const forkDef = JSON.parse(fork.definition as string);
    expect(forkDef.nodes).toHaveLength(2);
  });
});
