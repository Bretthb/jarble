/**
 * Integration tests for the packages tRPC router.
 *
 * Tests list, get, install, uninstall, listInstalled, publish, listByCreator.
 * Uses real in-memory SQLite with mocked K8s, Stripe, configSync, and OpenRouter.
 */
import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from "vitest";
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
const mockSyncConfigsToPvc = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/configSync.js", () => ({
  syncMarketplaceComponent: (...args: any[]) => mockSyncMarketplaceComponent(...args),
  removeMarketplaceComponent: vi.fn().mockResolvedValue(undefined),
  syncConfigsToPvc: (...args: any[]) => mockSyncConfigsToPvc(...args),
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

const mockPerformInstallHandshake = vi.fn().mockResolvedValue({
  remoteInstallId: "remote-inst-001",
  proxyUrl: "https://api.example.com/proxy",
});

vi.mock("../../services/packageHandshake.js", () => ({
  performInstallHandshake: (...args: any[]) => mockPerformInstallHandshake(...args),
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
});

afterAll(() => {
  ctx?.raw.close();
});

function authedCaller(opts?: { userId?: string; auth0Id?: string }) {
  return createTestCaller(ctx.db, {
    id: opts?.userId ?? ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: opts?.auth0Id ?? ctx.testAuth0Id,
    emailVerified: true,
  });
}

// ── Seed Helpers ─────────────────────────────────────────────────────────────

let seedCounter = 0;

function uid() {
  return `${Date.now()}_${++seedCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function seedCreatorProfile(userId?: string) {
  const id = `cp_${uid()}`;
  const uId = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO creator_profiles (id, user_id, display_name, bio) VALUES ('${id}', '${uId}', 'Test Creator', 'A bio')`
  );
  return id;
}

function seedComponent(creatorUserId: string, overrides?: { name?: string; status?: string }) {
  const id = `comp_${uid()}`;
  const name = overrides?.name ?? `comp-${id}`;
  const status = overrides?.status ?? "published";
  ctx.raw.exec(
    `INSERT INTO marketplace_components (id, creator_id, name, display_name, description, tier, category, status, published_at) VALUES ('${id}', '${creatorUserId}', '${name}', 'Display ${name}', 'Description', 'template', 'display', '${status}', datetime('now'))`
  );
  return id;
}

function seedVersion(componentId: string) {
  const id = `ver_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO component_versions (id, component_id, version, package_url, package_size_bytes, manifest_hash) VALUES ('${id}', '${componentId}', '1.0.0', 'https://cdn.example.com/pkg.tar.gz', 1024, 'hash123')`
  );
  return id;
}

function seedSkill() {
  const id = `skill_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO skills_catalog (id, name, description, runtime, config) VALUES ('${id}', 'web-search-${id}', 'Search the web', 'openclaw', '{"type":"builtin"}')`
  );
  return id;
}

function seedDeployment(status?: string) {
  const id = `dep_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${id}', '${ctx.testUserId}', 'Test Bot', 'openclaw', '${status ?? "running"}')`
  );
  return id;
}

function seedPackage(
  creatorProfileId: string,
  overrides?: {
    name?: string;
    status?: string;
    hostingModel?: string;
    pricingModel?: string;
    totalInstalls?: number;
    instructionSnippet?: string;
    remoteApiEndpoint?: string;
    remoteApiConfig?: string;
  }
) {
  const id = `pkg_${uid()}`;
  const name = overrides?.name ?? `pkg-${id}`;
  const status = overrides?.status ?? "published";
  const hosting = overrides?.hostingModel ?? "self_hosted";
  const pricing = overrides?.pricingModel ?? "free";
  const installs = overrides?.totalInstalls ?? 0;
  const snippet = overrides?.instructionSnippet ?? null;
  const endpoint = overrides?.remoteApiEndpoint ?? null;
  const config = overrides?.remoteApiConfig ?? null;
  ctx.raw.exec(
    `INSERT INTO marketplace_packages (id, creator_id, name, display_name, description, hosting_model, status, pricing_model, total_installs, instruction_snippet, remote_api_endpoint, remote_api_config) VALUES ('${id}', '${creatorProfileId}', '${name}', 'Display ${name}', 'A test package', '${hosting}', '${status}', '${pricing}', ${installs}, ${snippet ? `'${snippet}'` : "NULL"}, ${endpoint ? `'${endpoint}'` : "NULL"}, ${config ? `'${config.replace(/'/g, "''")}'` : "NULL"})`
  );
  return id;
}

function linkComponentToPackage(packageId: string, componentId: string) {
  const id = `pkc_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_components (id, package_id, component_id) VALUES ('${id}', '${packageId}', '${componentId}')`
  );
}

function linkSkillToPackage(packageId: string, skillId: string) {
  const id = `pks_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_skills (id, package_id, skill_id) VALUES ('${id}', '${packageId}', '${skillId}')`
  );
}

function seedSecondUser() {
  const userId = `user-2-${uid()}`;
  const auth0Id = `auth0|user-2-${uid()}`;
  ctx.raw.exec(
    `INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('${userId}', 'user2-${uid()}@test.com', 'User 2', '${auth0Id}', 1)`
  );
  return { userId, auth0Id };
}

function installPackageDirectly(packageId: string, deploymentId: string) {
  const id = `pki_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_installs (id, package_id, deployment_id, user_id, installed_at) VALUES ('${id}', '${packageId}', '${deploymentId}', '${ctx.testUserId}', datetime('now'))`
  );
  return id;
}

function installComponentDirectly(componentId: string, versionId: string, deploymentId: string) {
  const id = `ci_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO component_installs (id, component_id, version_id, deployment_id, user_id, installed_at) VALUES ('${id}', '${componentId}', '${versionId}', '${deploymentId}', '${ctx.testUserId}', datetime('now'))`
  );
  return id;
}

function installSkillDirectly(skillId: string, deploymentId: string) {
  const id = `ds_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO deployment_skills (id, deployment_id, skill_id, installed_at) VALUES ('${id}', '${deploymentId}', '${skillId}', datetime('now'))`
  );
  return id;
}

/** Build a valid PackageCard JSON string for remote package tests. */
function buildPackageCardJson(overrides?: { endpoint?: string }): string {
  return JSON.stringify({
    endpoint: overrides?.endpoint ?? "https://api.creator.example.com/v1",
    healthEndpoint: "https://api.creator.example.com/health",
    auth: { type: "api_key", headerName: "X-API-Key" },
    skills: [
      {
        name: "get_weather",
        description: "Get weather for a location",
        inputSchema: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ],
    rateLimits: { requestsPerMinute: 60 },
    version: "1.0.0",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("packages.list", () => {
  it("returns empty when no published packages", async () => {
    const caller = authedCaller();
    const result = await caller.packages.list();
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns published packages sorted by totalInstalls desc", async () => {
    const cpId = seedCreatorProfile();
    const pkg1 = seedPackage(cpId, { name: "alpha", totalInstalls: 5 });
    const pkg2 = seedPackage(cpId, { name: "beta", totalInstalls: 20 });
    const pkg3 = seedPackage(cpId, { name: "gamma", totalInstalls: 10 });

    const caller = authedCaller();
    const result = await caller.packages.list();

    expect(result.items).toHaveLength(3);
    expect(result.items[0].name).toBe("beta");
    expect(result.items[1].name).toBe("gamma");
    expect(result.items[2].name).toBe("alpha");
  });

  it("filters by hostingModel", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "self-pkg", hostingModel: "self_hosted" });
    seedPackage(cpId, { name: "remote-pkg", hostingModel: "remote" });

    const caller = authedCaller();
    const result = await caller.packages.list({ hostingModel: "remote" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("remote-pkg");
  });

  it("filters by pricingModel", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "free-pkg", pricingModel: "free" });
    seedPackage(cpId, { name: "paid-pkg", pricingModel: "paid" });

    const caller = authedCaller();
    const result = await caller.packages.list({ pricingModel: "paid" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("paid-pkg");
  });

  it("filters by search term matching name", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "weather-tools" });
    seedPackage(cpId, { name: "chart-bundle" });

    const caller = authedCaller();
    const result = await caller.packages.list({ search: "weather" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("weather-tools");
  });

  it("cursor-based pagination works", async () => {
    const cpId = seedCreatorProfile();
    // Create 3 packages, all with same installs so sorted by name
    seedPackage(cpId, { name: "aaa-pkg", totalInstalls: 0 });
    seedPackage(cpId, { name: "bbb-pkg", totalInstalls: 0 });
    seedPackage(cpId, { name: "ccc-pkg", totalInstalls: 0 });

    const caller = authedCaller();

    // Get first page of 2
    const page1 = await caller.packages.list({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();

    // Get second page using cursor
    const page2 = await caller.packages.list({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();

    // All 3 packages covered across pages
    const allNames = [...page1.items, ...page2.items].map((p) => p.name);
    expect(allNames).toHaveLength(3);
  });

  it("excludes non-published packages (draft, pending_review)", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "draft-pkg", status: "draft" });
    seedPackage(cpId, { name: "pending-pkg", status: "pending_review" });
    seedPackage(cpId, { name: "published-pkg", status: "published" });

    const caller = authedCaller();
    const result = await caller.packages.list();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("published-pkg");
  });

  it("returns componentCount and skillCount", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "full-pkg" });
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    const skill1 = seedSkill();
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);
    linkSkillToPackage(pkgId, skill1);

    const caller = authedCaller();
    const result = await caller.packages.list();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].componentCount).toBe(2);
    expect(result.items[0].skillCount).toBe(1);
  });
});

describe("packages.get", () => {
  it("returns full package with components and skills arrays", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "full-pkg" });
    const comp = seedComponent(ctx.testUserId, { name: "my-comp" });
    const skill = seedSkill();
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill);

    const caller = authedCaller();
    const result = await caller.packages.get({ packageId: pkgId });

    expect(result.name).toBe("full-pkg");
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("my-comp");
    expect(result.skills).toHaveLength(1);
  });

  it("returns creator info", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "creator-pkg" });

    const caller = authedCaller();
    const result = await caller.packages.get({ packageId: pkgId });

    expect(result.creator).toBeTruthy();
    expect(result.creator!.displayName).toBe("Test Creator");
    expect(result.creator!.bio).toBe("A bio");
  });

  it("throws NOT_FOUND for nonexistent packageId", async () => {
    const caller = authedCaller();
    await expect(caller.packages.get({ packageId: "nonexistent" })).rejects.toThrow("Package not found");
  });

  it("includes instructionSnippet", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "snippet-pkg", instructionSnippet: "Use this tool to search" });

    const caller = authedCaller();
    const result = await caller.packages.get({ packageId: pkgId });

    expect(result.instructionSnippet).toBe("Use this tool to search");
  });

  it("returns all linked components regardless of status", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "mixed-pkg" });
    const publishedComp = seedComponent(ctx.testUserId, { name: "published-comp", status: "published" });
    const draftComp = seedComponent(ctx.testUserId, { name: "draft-comp", status: "draft" });
    linkComponentToPackage(pkgId, publishedComp);
    linkComponentToPackage(pkgId, draftComp);

    const caller = authedCaller();
    const result = await caller.packages.get({ packageId: pkgId });

    // get() fetches by ID without filtering by status, so both are returned
    expect(result.components).toHaveLength(2);
  });
});

describe("packages.install", () => {
  it("creates packageInstalls record", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "install-pkg" });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);

    const row = ctx.raw
      .prepare("SELECT * FROM package_installs WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(row).toBeTruthy();
  });

  it("creates componentInstalls for each package component", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    seedVersion(comp1);
    seedVersion(comp2);
    const pkgId = seedPackage(cpId, { name: "multi-comp-pkg" });
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.installedComponents).toBe(2);

    const installs = ctx.raw
      .prepare("SELECT * FROM component_installs WHERE deployment_id = ?")
      .all(depId);
    expect(installs).toHaveLength(2);
  });

  it("creates deploymentSkills for each package skill", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "skill-pkg" });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill1);
    linkSkillToPackage(pkgId, skill2);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.installedSkills).toBe(2);

    const skills = ctx.raw
      .prepare("SELECT * FROM deployment_skills WHERE deployment_id = ?")
      .all(depId);
    expect(skills).toHaveLength(2);
  });

  it("increments totalInstalls on package", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "counter-pkg", totalInstalls: 5 });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    const pkg = ctx.raw
      .prepare("SELECT total_installs FROM marketplace_packages WHERE id = ?")
      .get(pkgId) as any;
    expect(pkg.total_installs).toBe(6);
  });

  it("skips already-installed components", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    // Pre-install the component
    installComponentDirectly(comp, verId, depId);
    const pkgId = seedPackage(cpId, { name: "skip-comp-pkg" });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.installedComponents).toBe(0);

    // Should still have only the original install
    const installs = ctx.raw
      .prepare("SELECT * FROM component_installs WHERE deployment_id = ? AND component_id = ?")
      .all(depId, comp);
    expect(installs).toHaveLength(1);
  });

  it("skips already-installed skills", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const skill = seedSkill();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    // Pre-install the skill
    installSkillDirectly(skill, depId);
    const pkgId = seedPackage(cpId, { name: "skip-skill-pkg" });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.installedSkills).toBe(0);
  });

  it("throws NOT_FOUND for deployment not owned by user", async () => {
    const { userId, auth0Id } = seedSecondUser();
    const cpId = seedCreatorProfile(userId);
    // Deployment owned by second user
    const depId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${depId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );
    const comp = seedComponent(userId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "no-access-pkg" });
    linkComponentToPackage(pkgId, comp);

    // Caller is test user, not the second user
    const caller = authedCaller();
    await expect(
      caller.packages.install({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });

  it("throws NOT_FOUND for unpublished package", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const pkgId = seedPackage(cpId, { name: "draft-pkg", status: "draft" });

    const caller = authedCaller();
    await expect(
      caller.packages.install({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Package not found or not published");
  });

  it("throws CONFLICT when already installed", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "conflict-pkg" });
    linkComponentToPackage(pkgId, comp);

    // Pre-install the package
    installPackageDirectly(pkgId, depId);

    const caller = authedCaller();
    await expect(
      caller.packages.install({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Package is already installed");
  });

  it("skips components with no versions", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const compWithVersion = seedComponent(ctx.testUserId);
    const compNoVersion = seedComponent(ctx.testUserId);
    seedVersion(compWithVersion);
    // compNoVersion has no versions
    const pkgId = seedPackage(cpId, { name: "partial-ver-pkg" });
    linkComponentToPackage(pkgId, compWithVersion);
    linkComponentToPackage(pkgId, compNoVersion);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    // Only the component with a version is installed
    expect(result.installedComponents).toBe(1);
  });

  // ── Remote/Hybrid package install ──────────────────────────────────────

  it("creates packageCredentials for remote package with valid remoteApiConfig", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const cardJson = buildPackageCardJson();
    const pkgId = seedPackage(cpId, {
      name: "remote-install-pkg",
      hostingModel: "remote",
      remoteApiEndpoint: "https://api.creator.example.com/v1",
      remoteApiConfig: cardJson,
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);

    // Verify packageCredentials record was created
    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(cred).toBeTruthy();
    // Handshake fires async but the mock resolves immediately, so status is already "completed"
    expect(["pending", "completed"]).toContain(cred.handshake_status);
    expect(cred.package_install_id).toBeTruthy();
    // Signing secret should be stored with plain: prefix (no encryption key in test env)
    expect(cred.signing_secret).toMatch(/^plain:/);
  });

  it("fires performInstallHandshake for remote package", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const cardJson = buildPackageCardJson({ endpoint: "https://remote.api.test/v1" });
    const pkgId = seedPackage(cpId, {
      name: "handshake-pkg",
      hostingModel: "remote",
      remoteApiConfig: cardJson,
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    // Handshake is fire-and-forget but should have been called
    expect(mockPerformInstallHandshake).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://remote.api.test/v1",
        packageId: pkgId,
        deploymentId: depId,
        signingSecret: expect.any(String),
      }),
    );
  });

  it("creates packageCredentials for hybrid package", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const cardJson = buildPackageCardJson();
    const pkgId = seedPackage(cpId, {
      name: "hybrid-install-pkg",
      hostingModel: "hybrid",
      remoteApiConfig: cardJson,
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(cred).toBeTruthy();
    expect(mockPerformInstallHandshake).toHaveBeenCalled();
  });

  it("skips handshake for self_hosted package (no credentials created)", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, {
      name: "self-hosted-pkg",
      hostingModel: "self_hosted",
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.handshakeStatus).toBe("skipped");

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(cred).toBeUndefined();
    expect(mockPerformInstallHandshake).not.toHaveBeenCalled();
  });

  it("skips credentials when remote package has no remoteApiConfig", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, {
      name: "remote-no-config-pkg",
      hostingModel: "remote",
      // No remoteApiConfig
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.handshakeStatus).toBe("skipped");

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(cred).toBeUndefined();
  });

  it("skips credentials when remoteApiConfig is invalid JSON schema (non-fatal)", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    // Invalid PackageCard: missing required fields (endpoint, auth, skills, version)
    const pkgId = seedPackage(cpId, {
      name: "bad-config-pkg",
      hostingModel: "remote",
      remoteApiConfig: JSON.stringify({ invalid: true }),
    });
    linkComponentToPackage(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.packages.install({ packageId: pkgId, deploymentId: depId });

    // Should succeed (non-fatal) but skip handshake
    expect(result.success).toBe(true);
    expect(result.handshakeStatus).toBe("skipped");

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId) as any;
    expect(cred).toBeUndefined();
  });
});

describe("packages.uninstall", () => {
  it("removes packageInstalls, componentInstalls, deploymentSkills", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: "uninstall-pkg" });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill);

    // Manually install everything
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);
    installSkillDirectly(skill, depId);

    const caller = authedCaller();
    const result = await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.removedComponents).toBe(1);
    expect(result.removedSkills).toBe(1);

    // Verify all records removed
    const pkgInstall = ctx.raw
      .prepare("SELECT * FROM package_installs WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId);
    expect(pkgInstall).toBeUndefined();

    const compInstall = ctx.raw
      .prepare("SELECT * FROM component_installs WHERE deployment_id = ? AND component_id = ?")
      .get(depId, comp);
    expect(compInstall).toBeUndefined();

    const skillInstall = ctx.raw
      .prepare("SELECT * FROM deployment_skills WHERE deployment_id = ? AND skill_id = ?")
      .get(depId, skill);
    expect(skillInstall).toBeUndefined();
  });

  it("returns correct removedComponents and removedSkills counts", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const ver2 = seedVersion(comp2);
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: "count-pkg" });
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);
    linkSkillToPackage(pkgId, skill);

    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);
    installComponentDirectly(comp2, ver2, depId);
    installSkillDirectly(skill, depId);

    const caller = authedCaller();
    const result = await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(result.removedComponents).toBe(2);
    expect(result.removedSkills).toBe(1);
  });

  it("throws NOT_FOUND for deployment not owned by user", async () => {
    const { userId } = seedSecondUser();
    const cpId = seedCreatorProfile(userId);
    const depId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${depId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );
    const pkgId = seedPackage(cpId, { name: "other-pkg" });

    const caller = authedCaller();
    await expect(
      caller.packages.uninstall({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });

  it("throws NOT_FOUND when package not installed", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const pkgId = seedPackage(cpId, { name: "not-installed-pkg" });

    const caller = authedCaller();
    await expect(
      caller.packages.uninstall({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Package is not installed");
  });

  it("works when package has no components/skills to remove", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const pkgId = seedPackage(cpId, { name: "empty-removal-pkg" });
    linkComponentToPackage(pkgId, comp);
    // Package is installed but component was never installed (e.g., had no version)
    installPackageDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.removedComponents).toBe(0);
    expect(result.removedSkills).toBe(0);
  });

  it("calls syncConfigsToPvc for running deployment", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment("running");
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "sync-pkg" });
    linkComponentToPackage(pkgId, comp);
    installPackageDirectly(pkgId, depId);

    const caller = authedCaller();
    await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(mockSyncConfigsToPvc).toHaveBeenCalledWith(depId);
  });
});

describe("packages.listInstalled", () => {
  it("returns installed packages with details", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: "installed-pkg" });
    linkComponentToPackage(pkgId, comp);
    installPackageDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.packages.listInstalled({ deploymentId: depId });

    expect(result).toHaveLength(1);
    expect(result[0].package.name).toBe("installed-pkg");
    expect(result[0].package.displayName).toBe("Display installed-pkg");
    expect(result[0].installId).toBeTruthy();
    expect(result[0].installedAt).toBeTruthy();
  });

  it("returns empty when nothing installed", async () => {
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.packages.listInstalled({ deploymentId: depId });

    expect(result).toEqual([]);
  });

  it("throws NOT_FOUND for deployment not owned by user", async () => {
    const { userId } = seedSecondUser();
    const depId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${depId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );

    const caller = authedCaller();
    await expect(
      caller.packages.listInstalled({ deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("packages.publish", () => {
  it("creates package in pending_review status", async () => {
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "pub-comp" });
    seedVersion(comp);

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "my-package",
      displayName: "My Package",
      hostingModel: "self_hosted",
      componentIds: [comp],
    });

    expect(result.packageId).toBeTruthy();

    const pkg = ctx.raw
      .prepare("SELECT * FROM marketplace_packages WHERE id = ?")
      .get(result.packageId) as any;
    expect(pkg.status).toBe("pending_review");
    expect(pkg.name).toBe("my-package");
  });

  it("creates packageComponents join records", async () => {
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "join-comp-1" });
    const comp2 = seedComponent(ctx.testUserId, { name: "join-comp-2" });

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "join-pkg",
      displayName: "Join Package",
      hostingModel: "self_hosted",
      componentIds: [comp1, comp2],
    });

    const joins = ctx.raw
      .prepare("SELECT * FROM package_components WHERE package_id = ?")
      .all(result.packageId);
    expect(joins).toHaveLength(2);
  });

  it("creates packageSkills join records", async () => {
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const comp = seedComponent(ctx.testUserId, { name: "skill-join-comp" });

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "skill-join-pkg",
      displayName: "Skill Join Package",
      hostingModel: "self_hosted",
      componentIds: [comp],
      skillIds: [skill],
    });

    const joins = ctx.raw
      .prepare("SELECT * FROM package_skills WHERE package_id = ?")
      .all(result.packageId);
    expect(joins).toHaveLength(1);
  });

  it("throws PRECONDITION_FAILED without creator profile", async () => {
    // Do NOT create a creator profile
    const comp = seedComponent(ctx.testUserId, { name: "no-profile-comp" });

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "no-profile-pkg",
        displayName: "No Profile",
        hostingModel: "self_hosted",
        componentIds: [comp],
      })
    ).rejects.toThrow("creator profile");
  });

  it("throws CONFLICT for duplicate name", async () => {
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "dup-comp" });
    // Pre-seed a package with same name under same creator
    seedPackage(cpId, { name: "dup-name" });

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "dup-name",
        displayName: "Duplicate",
        hostingModel: "self_hosted",
        componentIds: [comp],
      })
    ).rejects.toThrow("already have a package with this name");
  });

  it("throws BAD_REQUEST for invalid component ID", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "bad-comp-pkg",
        displayName: "Bad Component",
        hostingModel: "self_hosted",
        componentIds: ["nonexistent-comp"],
      })
    ).rejects.toThrow("not found or not published");
  });

  it("throws BAD_REQUEST for invalid skill ID", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "valid-comp-for-skill" });

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "bad-skill-pkg",
        displayName: "Bad Skill",
        hostingModel: "self_hosted",
        componentIds: [comp],
        skillIds: ["nonexistent-skill"],
      })
    ).rejects.toThrow("Skill nonexistent-skill not found");
  });

  it("throws BAD_REQUEST when no components and no skills", async () => {
    seedCreatorProfile();

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "empty-pkg",
        displayName: "Empty Package",
        hostingModel: "self_hosted",
        componentIds: [],
        skillIds: [],
      })
    ).rejects.toThrow("at least one component or skill");
  });

  it("validates name regex (lowercase alphanumeric with hyphens)", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "regex-comp" });

    const caller = authedCaller();

    // Invalid: uppercase
    await expect(
      caller.packages.publish({
        name: "My-Package",
        displayName: "Invalid",
        hostingModel: "self_hosted",
        componentIds: [comp],
      })
    ).rejects.toThrow();

    // Invalid: spaces
    await expect(
      caller.packages.publish({
        name: "my package",
        displayName: "Invalid",
        hostingModel: "self_hosted",
        componentIds: [comp],
      })
    ).rejects.toThrow();

    // Invalid: underscores
    await expect(
      caller.packages.publish({
        name: "my_package",
        displayName: "Invalid",
        hostingModel: "self_hosted",
        componentIds: [comp],
      })
    ).rejects.toThrow();
  });

  it("remote hosting model with API endpoint", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "remote-comp" });

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "remote-pkg",
      displayName: "Remote Package",
      hostingModel: "remote",
      remoteApiEndpoint: "https://api.example.com/v1",
      componentIds: [comp],
    });

    const pkg = ctx.raw
      .prepare("SELECT * FROM marketplace_packages WHERE id = ?")
      .get(result.packageId) as any;
    expect(pkg.hosting_model).toBe("remote");
    expect(pkg.remote_api_endpoint).toBe("https://api.example.com/v1");
  });
});

describe("packages.listByCreator", () => {
  it("returns published packages for creator", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "creator-pkg-1" });
    seedPackage(cpId, { name: "creator-pkg-2" });

    const caller = authedCaller();
    const result = await caller.packages.listByCreator({ creatorId: cpId });

    expect(result).toHaveLength(2);
  });

  it("excludes non-published", async () => {
    const cpId = seedCreatorProfile();
    seedPackage(cpId, { name: "published-one", status: "published" });
    seedPackage(cpId, { name: "draft-one", status: "draft" });
    seedPackage(cpId, { name: "pending-one", status: "pending_review" });

    const caller = authedCaller();
    const result = await caller.packages.listByCreator({ creatorId: cpId });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("published-one");
  });

  it("returns empty for nonexistent creator", async () => {
    const caller = authedCaller();
    const result = await caller.packages.listByCreator({ creatorId: "nonexistent-creator" });

    expect(result).toEqual([]);
  });
});

describe("packages.publish — remoteApiConfig validation", () => {
  it("stores remoteApiConfig as JSON string for remote package", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "remote-cfg-comp" });
    const cardJson = buildPackageCardJson();

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "remote-with-card",
      displayName: "Remote With Card",
      hostingModel: "remote",
      remoteApiEndpoint: "https://api.creator.example.com/v1",
      remoteApiConfig: cardJson,
      componentIds: [comp],
    });

    const pkg = ctx.raw
      .prepare("SELECT * FROM marketplace_packages WHERE id = ?")
      .get(result.packageId) as any;
    expect(pkg.remote_api_config).toBeTruthy();
    const parsed = JSON.parse(pkg.remote_api_config);
    expect(parsed.endpoint).toBe("https://api.creator.example.com/v1");
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.version).toBe("1.0.0");
  });

  it("throws BAD_REQUEST for invalid PackageCard JSON in remote package", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "invalid-card-comp" });

    const caller = authedCaller();
    await expect(
      caller.packages.publish({
        name: "bad-card-pkg",
        displayName: "Bad Card",
        hostingModel: "remote",
        remoteApiConfig: JSON.stringify({ endpoint: "not-a-url" }),
        componentIds: [comp],
      })
    ).rejects.toThrow("Invalid PackageCard config");
  });

  it("allows remote package without remoteApiConfig (optional during publish)", async () => {
    seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "no-card-comp" });

    const caller = authedCaller();
    const result = await caller.packages.publish({
      name: "remote-no-card",
      displayName: "Remote No Card",
      hostingModel: "remote",
      componentIds: [comp],
    });

    expect(result.packageId).toBeTruthy();

    const pkg = ctx.raw
      .prepare("SELECT * FROM marketplace_packages WHERE id = ?")
      .get(result.packageId) as any;
    expect(pkg.remote_api_config).toBeNull();
  });
});

// ── Creator Dashboard Procedures ────────────────────────────────────────────

describe("packages.creatorInstalls", () => {
  it("returns install list for the package creator", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "creator-installs-pkg" });

    // Seed two deployments and install the package on both
    const dep1 = seedDeployment();
    const dep2 = seedDeployment();
    installPackageDirectly(pkgId, dep1);
    installPackageDirectly(pkgId, dep2);

    const caller = authedCaller();
    const result = await caller.packages.creatorInstalls({ packageId: pkgId });

    expect(result.totalInstalls).toBe(2);
    expect(result.installs).toHaveLength(2);
    expect(result.installs[0].deploymentId).toBeTruthy();
    expect(result.installs[0].installedAt).toBeTruthy();
    expect(result.installs[0].id).toBeTruthy();
  });

  it("returns empty installs when package has no installations", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "no-installs-pkg" });

    const caller = authedCaller();
    const result = await caller.packages.creatorInstalls({ packageId: pkgId });

    expect(result.totalInstalls).toBe(0);
    expect(result.installs).toEqual([]);
  });

  it("throws FORBIDDEN if the caller is not the creator", async () => {
    // Create a second user who is the creator
    const { userId: creatorUserId, auth0Id: creatorAuth0Id } = seedSecondUser();
    const cpId = seedCreatorProfile(creatorUserId);
    const pkgId = seedPackage(cpId, { name: "forbidden-installs-pkg" });

    // Call as the test user (not the creator)
    const caller = authedCaller();
    await expect(
      caller.packages.creatorInstalls({ packageId: pkgId })
    ).rejects.toThrow("Not the package creator");
  });

  it("throws FORBIDDEN when user has no creator profile at all", async () => {
    // Create a second user who is the creator
    const { userId: creatorUserId } = seedSecondUser();
    const cpId = seedCreatorProfile(creatorUserId);
    const pkgId = seedPackage(cpId, { name: "no-profile-installs-pkg" });

    // Test user has no creator profile
    const caller = authedCaller();
    await expect(
      caller.packages.creatorInstalls({ packageId: pkgId })
    ).rejects.toThrow("Not the package creator");
  });

  it("throws NOT_FOUND if the package does not exist", async () => {
    seedCreatorProfile();
    const caller = authedCaller();
    await expect(
      caller.packages.creatorInstalls({ packageId: "nonexistent-pkg" })
    ).rejects.toThrow("NOT_FOUND");
  });

  it("returns installs with correct deployment IDs", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "dep-id-verify-pkg" });

    const dep1 = seedDeployment();
    const dep2 = seedDeployment();
    installPackageDirectly(pkgId, dep1);
    installPackageDirectly(pkgId, dep2);

    const caller = authedCaller();
    const result = await caller.packages.creatorInstalls({ packageId: pkgId });

    const deploymentIds = result.installs.map((i: any) => i.deploymentId);
    expect(deploymentIds).toContain(dep1);
    expect(deploymentIds).toContain(dep2);
  });
});

describe("packages.creatorUsage", () => {
  it("returns usage aggregated by billing month", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "usage-pkg" });
    const depId = seedDeployment();
    const installId = installPackageDirectly(pkgId, depId);

    // Seed usage records
    ctx.raw.exec(
      `INSERT INTO package_usage (id, package_install_id, deployment_id, package_id, skill_name, request_count, billing_cycle_start)
       VALUES ('pu_001', '${installId}', '${depId}', '${pkgId}', 'get_weather', 150, '2026-01-01')`
    );
    ctx.raw.exec(
      `INSERT INTO package_usage (id, package_install_id, deployment_id, package_id, skill_name, request_count, billing_cycle_start)
       VALUES ('pu_002', '${installId}', '${depId}', '${pkgId}', 'search_web', 75, '2026-01-01')`
    );
    ctx.raw.exec(
      `INSERT INTO package_usage (id, package_install_id, deployment_id, package_id, skill_name, request_count, billing_cycle_start)
       VALUES ('pu_003', '${installId}', '${depId}', '${pkgId}', 'get_weather', 200, '2026-02-01')`
    );

    const caller = authedCaller();
    const result = await caller.packages.creatorUsage({ packageId: pkgId });

    expect(result.totalRequests).toBe(425);
    expect(result.byMonth["2026-01-01"]).toBe(225); // 150 + 75
    expect(result.byMonth["2026-02-01"]).toBe(200);
  });

  it("returns zero usage when no records exist", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "zero-usage-pkg" });

    const caller = authedCaller();
    const result = await caller.packages.creatorUsage({ packageId: pkgId });

    expect(result.totalRequests).toBe(0);
    expect(result.byMonth).toEqual({});
  });

  it("throws FORBIDDEN if not the creator", async () => {
    const { userId: creatorUserId } = seedSecondUser();
    const cpId = seedCreatorProfile(creatorUserId);
    const pkgId = seedPackage(cpId, { name: "forbidden-usage-pkg" });

    const caller = authedCaller();
    await expect(
      caller.packages.creatorUsage({ packageId: pkgId })
    ).rejects.toThrow("Not the package creator");
  });

  it("throws NOT_FOUND if package missing", async () => {
    seedCreatorProfile();
    const caller = authedCaller();
    await expect(
      caller.packages.creatorUsage({ packageId: "nonexistent-pkg" })
    ).rejects.toThrow("NOT_FOUND");
  });

  it("aggregates usage across multiple deployments for same billing cycle", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "multi-dep-usage-pkg" });
    const dep1 = seedDeployment();
    const dep2 = seedDeployment();
    const install1 = installPackageDirectly(pkgId, dep1);
    const install2 = installPackageDirectly(pkgId, dep2);

    ctx.raw.exec(
      `INSERT INTO package_usage (id, package_install_id, deployment_id, package_id, skill_name, request_count, billing_cycle_start)
       VALUES ('pu_m1', '${install1}', '${dep1}', '${pkgId}', 'get_weather', 100, '2026-03-01')`
    );
    ctx.raw.exec(
      `INSERT INTO package_usage (id, package_install_id, deployment_id, package_id, skill_name, request_count, billing_cycle_start)
       VALUES ('pu_m2', '${install2}', '${dep2}', '${pkgId}', 'get_weather', 50, '2026-03-01')`
    );

    const caller = authedCaller();
    const result = await caller.packages.creatorUsage({ packageId: pkgId });

    expect(result.totalRequests).toBe(150);
    expect(result.byMonth["2026-03-01"]).toBe(150);
  });
});

describe("packages.adminList", () => {
  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = authedCaller();
    await expect(
      caller.packages.adminList()
    ).rejects.toThrow("Admin access required");
  });
});

describe("packages.adminApprove", () => {
  it("throws FORBIDDEN for non-admin user", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "approve-target", status: "pending_review" });

    const caller = authedCaller();
    await expect(
      caller.packages.adminApprove({ packageId: pkgId })
    ).rejects.toThrow("Admin access required");
  });
});

describe("packages.adminReject", () => {
  it("throws FORBIDDEN for non-admin user", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: "reject-target", status: "pending_review" });

    const caller = authedCaller();
    await expect(
      caller.packages.adminReject({ packageId: pkgId, reason: "Policy violation" })
    ).rejects.toThrow("Admin access required");
  });
});

// ── Phase 4: rotateSigningSecret, enhanced uninstall, getPackageStatus, checkForUpdates, upgradePackage ──

/**
 * Helper: seed a fully-installed remote package with packageCredentials.
 * Returns { pkgId, depId, credId, installId, signingSecret }.
 */
function seedInstalledRemotePackage(overrides?: {
  hostingModel?: string;
  endpoint?: string;
}) {
  const cpId = seedCreatorProfile();
  const depId = seedDeployment();
  const comp = seedComponent(ctx.testUserId);
  seedVersion(comp);

  const endpoint = overrides?.endpoint ?? "https://api.creator.example.com/v1";
  const cardJson = buildPackageCardJson({ endpoint });
  const hosting = overrides?.hostingModel ?? "remote";

  const pkgId = seedPackage(cpId, {
    name: `remote-pkg-${uid()}`,
    hostingModel: hosting,
    remoteApiEndpoint: endpoint,
    remoteApiConfig: cardJson,
  });
  linkComponentToPackage(pkgId, comp);

  // Install the package
  const installId = installPackageDirectly(pkgId, depId);

  // Install the component
  const verId = ctx.raw
    .prepare("SELECT id FROM component_versions WHERE component_id = ?")
    .get(comp) as any;
  installComponentDirectly(comp, verId.id, depId);

  // Create packageCredentials with a known signing secret
  const signingSecret = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const credId = `pkc_${uid()}`;
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  ctx.raw.exec(
    `INSERT INTO package_credentials (id, package_install_id, deployment_id, package_id, signing_secret, handshake_status, created_at, updated_at) VALUES ('${credId}', '${installId}', '${depId}', '${pkgId}', 'plain:${signingSecret}', 'completed', '${now}', '${now}')`
  );

  return { pkgId, depId, credId, installId, signingSecret, cpId, comp };
}

describe("packages.rotateSigningSecret", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("successfully rotates the signing secret and updates DB", async () => {
    const { pkgId, depId, credId, signingSecret } = seedInstalledRemotePackage();

    // Mock fetch to avoid real network calls (rotate webhook is fire-and-forget)
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    const caller = authedCaller();
    const result = await caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);

    // Verify the signing secret was updated in the DB
    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE id = ?")
      .get(credId) as any;
    expect(cred).toBeTruthy();
    // The new secret should be different from the old one (plain: prefix in test env)
    expect(cred.signing_secret).toMatch(/^plain:/);
    const newStoredSecret = cred.signing_secret.replace("plain:", "");
    expect(newStoredSecret).not.toBe(signingSecret);
  });

  it("generates a new secret different from the old one", async () => {
    const { pkgId, depId, credId, signingSecret } = seedInstalledRemotePackage();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    const caller = authedCaller();
    await caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId });

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE id = ?")
      .get(credId) as any;
    const newSecret = cred.signing_secret.replace("plain:", "");
    // Must be a 64-char hex string (32 random bytes)
    expect(newSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(newSecret).not.toBe(signingSecret);
  });

  it("throws NOT_FOUND if deployment not found or not owned by user", async () => {
    const { pkgId } = seedInstalledRemotePackage();

    const caller = authedCaller();
    await expect(
      caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: "nonexistent-dep" })
    ).rejects.toThrow("Deployment not found");
  });

  it("throws NOT_FOUND if deployment is owned by another user", async () => {
    const { pkgId } = seedInstalledRemotePackage();
    const { userId, auth0Id } = seedSecondUser();
    const otherDepId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${otherDepId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );

    const caller = authedCaller();
    await expect(
      caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: otherDepId })
    ).rejects.toThrow("Deployment not found");
  });

  it("throws NOT_FOUND if no packageCredentials found for this deployment+package", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedPackage(cpId, { name: `no-cred-pkg-${uid()}` });

    const caller = authedCaller();
    await expect(
      caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("No credentials found for this package installation");
  });

  it("fires webhook to creator endpoint with OLD secret for signing", async () => {
    const { pkgId, depId, signingSecret } = seedInstalledRemotePackage({
      endpoint: "https://creator.test.api/v1",
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    globalThis.fetch = mockFetch;

    const caller = authedCaller();
    await caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId });

    // The webhook is fire-and-forget via void, but the mock resolves immediately
    // so by the time we check it should have been called.
    // Give microtask queue a tick to process the fire-and-forget promise.
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://creator.test.api/v1/jarble/rotate");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Jarble-Signature"]).toMatch(/^sha256=/);
    expect(options.headers["X-Jarble-Timestamp"]).toBeTruthy();

    // Verify the body contains the new signing secret
    const body = JSON.parse(options.body);
    expect(body.action).toBe("rotate");
    expect(body.packageId).toBe(pkgId);
    expect(body.deploymentId).toBe(depId);
    expect(body.signingSecret).toBeTruthy();
    // The body's signingSecret is the NEW secret (sent so creator can update their side)
    expect(body.signingSecret).not.toBe(signingSecret);

    // Verify the webhook is signed with the OLD secret (not the new one)
    // We can verify by importing signRequest and checking:
    const timestamp = Number(options.headers["X-Jarble-Timestamp"]);
    const { signRequest } = await import("../../utils/hmac.js");
    const expectedSig = signRequest(signingSecret, timestamp, options.body);
    expect(options.headers["X-Jarble-Signature"]).toBe(expectedSig);
  });

  it("does not fail if webhook to creator endpoint fails", async () => {
    const { pkgId, depId, credId } = seedInstalledRemotePackage();

    // Webhook fails with network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const caller = authedCaller();
    // Should NOT throw — rotation still succeeds locally
    const result = await caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId });
    expect(result.success).toBe(true);

    // Verify the secret was still updated locally
    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE id = ?")
      .get(credId) as any;
    expect(cred.signing_secret).toMatch(/^plain:/);
  });

  it("does not fail if webhook returns non-OK status", async () => {
    const { pkgId, depId } = seedInstalledRemotePackage();

    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    const caller = authedCaller();
    const result = await caller.packages.rotateSigningSecret({ packageId: pkgId, deploymentId: depId });
    expect(result.success).toBe(true);
  });
});

// ── Enhanced uninstall with webhook ──────────────────────────────────────────

describe("packages.uninstall — remote webhook", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends uninstall webhook to creator endpoint for remote package", async () => {
    const { pkgId, depId } = seedInstalledRemotePackage({ hostingModel: "remote" });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    globalThis.fetch = mockFetch;

    const caller = authedCaller();
    await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/jarble/uninstall");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.action).toBe("uninstall");
    expect(body.packageId).toBe(pkgId);
    expect(body.deploymentId).toBe(depId);
    expect(body.timestamp).toBeTruthy();
  });

  it("sends uninstall webhook for hybrid package", async () => {
    const { pkgId, depId } = seedInstalledRemotePackage({ hostingModel: "hybrid" });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    globalThis.fetch = mockFetch;

    const caller = authedCaller();
    await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/jarble/uninstall");
  });

  it("deletes packageCredentials row after uninstall", async () => {
    const { pkgId, depId, credId } = seedInstalledRemotePackage();

    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    const caller = authedCaller();
    await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    const cred = ctx.raw
      .prepare("SELECT * FROM package_credentials WHERE id = ?")
      .get(credId) as any;
    expect(cred).toBeUndefined();
  });

  it("uninstall succeeds even if webhook fails (fire-and-forget)", async () => {
    const { pkgId, depId } = seedInstalledRemotePackage();

    // Webhook throws a network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const caller = authedCaller();
    const result = await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);

    // Package install should still be removed
    const install = ctx.raw
      .prepare("SELECT * FROM package_installs WHERE package_id = ? AND deployment_id = ?")
      .get(pkgId, depId);
    expect(install).toBeUndefined();
  });

  it("self-hosted packages do not trigger webhook on uninstall", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const pkgId = seedPackage(cpId, {
      name: `self-hosted-uninstall-${uid()}`,
      hostingModel: "self_hosted",
    });
    linkComponentToPackage(pkgId, comp);
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    globalThis.fetch = mockFetch;

    const caller = authedCaller();
    const result = await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    // No webhook should have been sent for self-hosted packages
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uninstall webhook is signed with the correct signing secret", async () => {
    const { pkgId, depId, signingSecret } = seedInstalledRemotePackage({
      endpoint: "https://signed.creator.api/v1",
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    globalThis.fetch = mockFetch;

    const caller = authedCaller();
    await caller.packages.uninstall({ packageId: pkgId, deploymentId: depId });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0];
    const timestamp = Number(options.headers["X-Jarble-Timestamp"]);
    const { signRequest } = await import("../../utils/hmac.js");
    const expectedSig = signRequest(signingSecret, timestamp, options.body);
    expect(options.headers["X-Jarble-Signature"]).toBe(expectedSig);
  });
});

// ── getPackageStatus ─────────────────────────────────────────────────────────

describe("packages.getPackageStatus", () => {
  it("returns { installed: false } when package is not installed on deployment", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const pkgId = seedPackage(cpId, { name: `status-not-installed-${uid()}` });

    const caller = authedCaller();
    const result = await caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: depId });

    expect(result.installed).toBe(false);
  });

  it("returns full status with component/skill counts when installed", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const ver2 = seedVersion(comp2);
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: `status-full-${uid()}` });
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);
    linkSkillToPackage(pkgId, skill);

    // Install the package and its components/skills
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);
    installComponentDirectly(comp2, ver2, depId);
    installSkillDirectly(skill, depId);

    const caller = authedCaller();
    const result = await caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: depId });

    expect(result.installed).toBe(true);
    expect(result.installedAt).toBeTruthy();
    expect(result.package).toEqual(
      expect.objectContaining({
        id: pkgId,
        hostingModel: "self_hosted",
      })
    );
    expect(result.components).toEqual({ total: 2, installed: 2 });
    expect(result.skills).toEqual({ total: 1, installed: 1 });
  });

  it("returns partial component/skill counts when not all are installed", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    seedVersion(comp2); // version exists but component not installed
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: `status-partial-${uid()}` });
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);
    linkSkillToPackage(pkgId, skill);

    // Install package but only one component and no skills
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);

    const caller = authedCaller();
    const result = await caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: depId });

    expect(result.installed).toBe(true);
    expect(result.components).toEqual({ total: 2, installed: 1 });
    expect(result.skills).toEqual({ total: 1, installed: 0 });
  });

  it("returns handshake status for remote/hybrid packages", async () => {
    const { pkgId, depId } = seedInstalledRemotePackage({ hostingModel: "remote" });

    // Mock fetch in case rotateSigningSecret or other procedures fire it
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    const caller = authedCaller();
    const result = await caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: depId });

    expect(result.installed).toBe(true);
    expect(result.handshake).toBeTruthy();
    expect(result.handshake!.status).toBe("completed");
    expect(result.handshake!.error).toBeNull();

    globalThis.fetch = origFetch;
  });

  it("returns null handshake for self-hosted packages (no credentials)", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const pkgId = seedPackage(cpId, {
      name: `status-self-hosted-${uid()}`,
      hostingModel: "self_hosted",
    });
    linkComponentToPackage(pkgId, comp);
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);

    const caller = authedCaller();
    const result = await caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: depId });

    expect(result.installed).toBe(true);
    expect(result.handshake).toBeNull();
  });

  it("throws NOT_FOUND if deployment not owned by user", async () => {
    const { userId } = seedSecondUser();
    const cpId = seedCreatorProfile(userId);
    const otherDepId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${otherDepId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );
    const pkgId = seedPackage(cpId, { name: `status-not-owned-${uid()}` });

    const caller = authedCaller();
    await expect(
      caller.packages.getPackageStatus({ packageId: pkgId, deploymentId: otherDepId })
    ).rejects.toThrow("Deployment not found");
  });
});

// ── checkForUpdates ──────────────────────────────────────────────────────────

describe("packages.checkForUpdates", () => {
  it("returns empty updates array when all packages are up to date", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: `uptodate-${uid()}` });
    linkComponentToPackage(pkgId, comp);
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toEqual([]);
  });

  it("returns package in updates when package.updatedAt > install.installedAt", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: `updated-pkg-${uid()}` });
    linkComponentToPackage(pkgId, comp);

    // Install the package with an old timestamp
    const installId = `pki_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO package_installs (id, package_id, deployment_id, user_id, installed_at) VALUES ('${installId}', '${pkgId}', '${depId}', '${ctx.testUserId}', '2025-01-01 00:00:00')`
    );
    installComponentDirectly(comp, verId, depId);

    // Update the package's updatedAt to a more recent time
    ctx.raw.exec(
      `UPDATE marketplace_packages SET updated_at = '2026-06-01 00:00:00' WHERE id = '${pkgId}'`
    );

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].packageId).toBe(pkgId);
    expect(result.updates[0].newComponents).toBe(0);
    expect(result.updates[0].newSkills).toBe(0);
  });

  it("returns package in updates when new components were added after install", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const pkgId = seedPackage(cpId, { name: `new-comp-${uid()}` });
    linkComponentToPackage(pkgId, comp1);

    // Install the package with only comp1
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);

    // Creator adds a new component to the package AFTER install
    const comp2 = seedComponent(ctx.testUserId);
    seedVersion(comp2);
    linkComponentToPackage(pkgId, comp2);

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].packageId).toBe(pkgId);
    expect(result.updates[0].newComponents).toBe(1);
  });

  it("returns package in updates when new skills were added after install", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const skill1 = seedSkill();
    const pkgId = seedPackage(cpId, { name: `new-skill-${uid()}` });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill1);

    // Install the package with skill1
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);
    installSkillDirectly(skill1, depId);

    // Creator adds a new skill to the package AFTER install
    const skill2 = seedSkill();
    linkSkillToPackage(pkgId, skill2);

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].packageId).toBe(pkgId);
    expect(result.updates[0].newSkills).toBe(1);
  });

  it("throws NOT_FOUND if deployment not owned by user", async () => {
    const { userId } = seedSecondUser();
    const otherDepId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${otherDepId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );

    const caller = authedCaller();
    await expect(
      caller.packages.checkForUpdates({ deploymentId: otherDepId })
    ).rejects.toThrow("Deployment not found");
  });

  it("returns empty updates when deployment has no installed packages", async () => {
    const depId = seedDeployment();

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toEqual([]);
  });

  it("does not include packages with no actual changes", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: `no-change-${uid()}` });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill);

    // Install everything at current time
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);
    installSkillDirectly(skill, depId);

    // Ensure updatedAt <= installedAt (package was NOT modified after install)
    ctx.raw.exec(
      `UPDATE marketplace_packages SET updated_at = '2020-01-01 00:00:00' WHERE id = '${pkgId}'`
    );

    const caller = authedCaller();
    const result = await caller.packages.checkForUpdates({ deploymentId: depId });

    expect(result.updates).toEqual([]);
  });
});

// ── upgradePackage ───────────────────────────────────────────────────────────

describe("packages.upgradePackage", () => {
  it("installs newly added components that were not in the original install", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const pkgId = seedPackage(cpId, { name: `upgrade-comp-${uid()}` });
    linkComponentToPackage(pkgId, comp1);

    // Original install: only comp1
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);

    // Creator adds comp2 to the package
    const comp2 = seedComponent(ctx.testUserId);
    seedVersion(comp2);
    linkComponentToPackage(pkgId, comp2);

    const caller = authedCaller();
    const result = await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.newlyInstalledComponents).toBe(1);
    expect(result.newlyInstalledSkills).toBe(0);

    // Verify comp2 is now installed
    const comp2Install = ctx.raw
      .prepare("SELECT * FROM component_installs WHERE deployment_id = ? AND component_id = ?")
      .get(depId, comp2) as any;
    expect(comp2Install).toBeTruthy();
  });

  it("installs newly added skills that were not in the original install", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const skill1 = seedSkill();
    const pkgId = seedPackage(cpId, { name: `upgrade-skill-${uid()}` });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill1);

    // Original install: comp + skill1
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);
    installSkillDirectly(skill1, depId);

    // Creator adds skill2 to the package
    const skill2 = seedSkill();
    linkSkillToPackage(pkgId, skill2);

    const caller = authedCaller();
    const result = await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.newlyInstalledComponents).toBe(0);
    expect(result.newlyInstalledSkills).toBe(1);

    // Verify skill2 is now installed
    const skill2Install = ctx.raw
      .prepare("SELECT * FROM deployment_skills WHERE deployment_id = ? AND skill_id = ?")
      .get(depId, skill2) as any;
    expect(skill2Install).toBeTruthy();
  });

  it("updates installedAt on packageInstalls to mark as up-to-date", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const pkgId = seedPackage(cpId, { name: `upgrade-timestamp-${uid()}` });
    linkComponentToPackage(pkgId, comp);

    // Install with an old timestamp
    const installId = `pki_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO package_installs (id, package_id, deployment_id, user_id, installed_at) VALUES ('${installId}', '${pkgId}', '${depId}', '${ctx.testUserId}', '2025-01-01 00:00:00')`
    );
    installComponentDirectly(comp, verId, depId);

    const caller = authedCaller();
    await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    // Verify the installedAt was updated to a newer time
    const install = ctx.raw
      .prepare("SELECT * FROM package_installs WHERE id = ?")
      .get(installId) as any;
    expect(install).toBeTruthy();
    // The new installedAt should be more recent than the original
    expect(new Date(install.installed_at).getTime()).toBeGreaterThan(
      new Date("2025-01-01 00:00:00").getTime()
    );
  });

  it("throws NOT_FOUND if package not installed on this deployment", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const pkgId = seedPackage(cpId, { name: `upgrade-not-installed-${uid()}` });

    const caller = authedCaller();
    await expect(
      caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId })
    ).rejects.toThrow("Package is not installed on this deployment");
  });

  it("throws NOT_FOUND if deployment not owned by user", async () => {
    const { userId } = seedSecondUser();
    const cpId = seedCreatorProfile(userId);
    const otherDepId = `dep_other_${uid()}`;
    ctx.raw.exec(
      `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${otherDepId}', '${userId}', 'Other Bot', 'openclaw', 'running')`
    );
    const pkgId = seedPackage(cpId, { name: `upgrade-not-owned-${uid()}` });

    const caller = authedCaller();
    await expect(
      caller.packages.upgradePackage({ packageId: pkgId, deploymentId: otherDepId })
    ).rejects.toThrow("Deployment not found");
  });

  it("skips already-installed components during upgrade", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const comp2 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const ver2 = seedVersion(comp2);
    const pkgId = seedPackage(cpId, { name: `upgrade-skip-${uid()}` });
    linkComponentToPackage(pkgId, comp1);
    linkComponentToPackage(pkgId, comp2);

    // Install package with both components already installed
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);
    installComponentDirectly(comp2, ver2, depId);

    const caller = authedCaller();
    const result = await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.newlyInstalledComponents).toBe(0);
    expect(result.newlyInstalledSkills).toBe(0);
  });

  it("skips already-installed skills during upgrade", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp = seedComponent(ctx.testUserId);
    const verId = seedVersion(comp);
    const skill = seedSkill();
    const pkgId = seedPackage(cpId, { name: `upgrade-skip-skill-${uid()}` });
    linkComponentToPackage(pkgId, comp);
    linkSkillToPackage(pkgId, skill);

    // Install package with skill already installed
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp, verId, depId);
    installSkillDirectly(skill, depId);

    const caller = authedCaller();
    const result = await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.newlyInstalledSkills).toBe(0);
  });

  it("increments totalInstalls on newly-installed components", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const pkgId = seedPackage(cpId, { name: `upgrade-counter-${uid()}` });
    linkComponentToPackage(pkgId, comp1);

    // Install without components
    installPackageDirectly(pkgId, depId);

    // Get initial total_installs
    const before = ctx.raw
      .prepare("SELECT total_installs FROM marketplace_components WHERE id = ?")
      .get(comp1) as any;
    const initialCount = before.total_installs;

    const caller = authedCaller();
    await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    const after = ctx.raw
      .prepare("SELECT total_installs FROM marketplace_components WHERE id = ?")
      .get(comp1) as any;
    expect(after.total_installs).toBe(initialCount + 1);
  });

  it("handles upgrade with both new components and new skills", async () => {
    const cpId = seedCreatorProfile();
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId);
    const ver1 = seedVersion(comp1);
    const pkgId = seedPackage(cpId, { name: `upgrade-both-${uid()}` });
    linkComponentToPackage(pkgId, comp1);

    // Initial install with comp1 only
    installPackageDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);

    // Creator adds new component + new skill after install
    const comp2 = seedComponent(ctx.testUserId);
    seedVersion(comp2);
    linkComponentToPackage(pkgId, comp2);
    const skill = seedSkill();
    linkSkillToPackage(pkgId, skill);

    const caller = authedCaller();
    const result = await caller.packages.upgradePackage({ packageId: pkgId, deploymentId: depId });

    expect(result.success).toBe(true);
    expect(result.newlyInstalledComponents).toBe(1);
    expect(result.newlyInstalledSkills).toBe(1);
  });
});
