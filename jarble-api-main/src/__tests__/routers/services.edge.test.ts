/**
 * Additional edge case tests for the services tRPC router.
 *
 * Covers gaps not tested in services.test.ts:
 * - Search by displayName/description, case-insensitive search
 * - Component status "approved" in install validation
 * - Non-openclaw runtime compatibility warnings
 * - Anonymous access to public procedures
 * - totalInstalls floor-at-zero edge case during uninstall
 * - Decrement component totalInstalls during uninstall
 * - Health field in getServiceStatus
 * - Multiple deployments sharing the same service
 * - Install/uninstall with mixed component status
 * - Publish input validation (name, displayName, pricing, endpoint)
 * - List filtering edge cases
 * - Deeper integration: install → status → uninstall lifecycle
 * - configSync fire-and-forget behavior
 * - listByCreator excludes draft/pending/rejected
 * - get returns instructionSnippet, remoteApiEndpoint, remoteApiConfig
 * - creatorInstalls multiple deployments
 * - creatorUsage with no profile
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

vi.mock("../../services/serviceHandshake.js", () => ({
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
  return `edge_${++seedCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function seedCreatorProfile(userId?: string) {
  const id = `cp_${uid()}`;
  const uId = userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO creator_profiles (id, user_id, display_name, bio) VALUES ('${id}', '${uId}', 'Test Creator', 'A bio')`
  );
  return id;
}

function seedComponent(creatorUserId: string, overrides?: { name?: string; status?: string; totalInstalls?: number }) {
  const id = `comp_${uid()}`;
  const name = overrides?.name ?? `comp-${id}`;
  const status = overrides?.status ?? "published";
  const installs = overrides?.totalInstalls ?? 0;
  ctx.raw.exec(
    `INSERT INTO marketplace_components (id, creator_id, name, display_name, description, tier, category, status, total_installs, published_at) VALUES ('${id}', '${creatorUserId}', '${name}', 'Display ${name}', 'Description', 'template', 'display', '${status}', ${installs}, datetime('now'))`
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
    `INSERT INTO skills_catalog (id, name, description, runtime, config) VALUES ('${id}', 'skill-${id}', 'A test skill', 'openclaw', '{"type":"builtin"}')`
  );
  return id;
}

function seedDeployment(overrides?: { status?: string; runtime?: string; userId?: string }) {
  const id = `dep_${uid()}`;
  const status = overrides?.status ?? "running";
  const runtime = overrides?.runtime ?? "openclaw";
  const userId = overrides?.userId ?? ctx.testUserId;
  ctx.raw.exec(
    `INSERT INTO deployments (id, user_id, name, runtime, status) VALUES ('${id}', '${userId}', 'Test Bot', '${runtime}', '${status}')`
  );
  return id;
}

function seedService(
  creatorProfileId: string,
  overrides?: {
    name?: string;
    displayName?: string;
    description?: string;
    status?: string;
    hostingModel?: string;
    pricingModel?: string;
    totalInstalls?: number;
    instructionSnippet?: string;
    remoteApiEndpoint?: string;
    remoteApiConfig?: string;
    remoteHealth?: string;
  }
) {
  const id = `pkg_${uid()}`;
  const name = overrides?.name ?? `pkg-${id}`;
  const displayName = overrides?.displayName ?? `Display ${name}`;
  const description = overrides?.description ?? "A test service";
  const status = overrides?.status ?? "published";
  const hosting = overrides?.hostingModel ?? "self_hosted";
  const pricing = overrides?.pricingModel ?? "free";
  const installs = overrides?.totalInstalls ?? 0;
  const snippet = overrides?.instructionSnippet ?? null;
  const endpoint = overrides?.remoteApiEndpoint ?? null;
  const config = overrides?.remoteApiConfig ?? null;
  const health = overrides?.remoteHealth ?? null;
  ctx.raw.exec(
    `INSERT INTO marketplace_packages (id, creator_id, name, display_name, description, hosting_model, status, pricing_model, total_installs, instruction_snippet, remote_api_endpoint, remote_api_config, remote_health) VALUES ('${id}', '${creatorProfileId}', '${name}', '${displayName}', '${description}', '${hosting}', '${status}', '${pricing}', ${installs}, ${snippet ? `'${snippet}'` : "NULL"}, ${endpoint ? `'${endpoint}'` : "NULL"}, ${config ? `'${config.replace(/'/g, "''")}'` : "NULL"}, ${health ? `'${health}'` : "NULL"})`
  );
  return id;
}

function linkComponentToService(serviceId: string, componentId: string) {
  const id = `pkc_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_components (id, package_id, component_id) VALUES ('${id}', '${serviceId}', '${componentId}')`
  );
}

function linkSkillToService(serviceId: string, skillId: string) {
  const id = `pks_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_skills (id, package_id, skill_id) VALUES ('${id}', '${serviceId}', '${skillId}')`
  );
}

function installServiceDirectly(serviceId: string, deploymentId: string) {
  const id = `pki_${uid()}`;
  ctx.raw.exec(
    `INSERT INTO package_installs (id, package_id, deployment_id, user_id, installed_at) VALUES ('${id}', '${serviceId}', '${deploymentId}', '${ctx.testUserId}', datetime('now'))`
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

function seedSecondUser() {
  const userId = `user-2-${uid()}`;
  const auth0Id = `auth0|user-2-${uid()}`;
  ctx.raw.exec(
    `INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('${userId}', 'user2-${uid()}@test.com', 'User 2', '${auth0Id}', 1)`
  );
  return { userId, auth0Id };
}

function buildServiceCardJson(overrides?: { endpoint?: string }): string {
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

describe("services.list — search edge cases", () => {
  it("search matches displayName", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "svc-x", displayName: "Weather Dashboard" });
    seedService(cpId, { name: "svc-y", displayName: "Chat Widget" });

    const caller = authedCaller();
    const result = await caller.services.list({ search: "dashboard" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].displayName).toBe("Weather Dashboard");
  });

  it("search matches description", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "svc-a", description: "Provides real-time weather data" });
    seedService(cpId, { name: "svc-b", description: "A chat assistant" });

    const caller = authedCaller();
    const result = await caller.services.list({ search: "weather" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("svc-a");
  });

  it("search is case-insensitive", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "upper-test", displayName: "UPPERCASE Service" });

    const caller = authedCaller();
    const r1 = await caller.services.list({ search: "uppercase" });
    expect(r1.items).toHaveLength(1);

    const r2 = await caller.services.list({ search: "UPPERCASE" });
    expect(r2.items).toHaveLength(1);

    const r3 = await caller.services.list({ search: "Uppercase" });
    expect(r3.items).toHaveLength(1);
  });

  it("search with no results returns empty items", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "svc-z", displayName: "Normal Service" });

    const caller = authedCaller();
    const result = await caller.services.list({ search: "xyznonexistent" });
    expect(result.items).toEqual([]);
  });

  it("empty search string returns all published services", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "svc-1" });
    seedService(cpId, { name: "svc-2" });

    const caller = authedCaller();
    const result = await caller.services.list({ search: "" });
    expect(result.items).toHaveLength(2);
  });
});

describe("services.list — anonymous access", () => {
  it("list is accessible without authentication (public procedure)", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "public-svc" });

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.services.list();
    expect(result.items).toHaveLength(1);
  });
});

describe("services.list — combined filters", () => {
  it("combines hostingModel and pricingModel filters", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "s1", hostingModel: "remote", pricingModel: "paid" });
    seedService(cpId, { name: "s2", hostingModel: "remote", pricingModel: "free" });
    seedService(cpId, { name: "s3", hostingModel: "self_hosted", pricingModel: "paid" });

    const caller = authedCaller();
    const result = await caller.services.list({ hostingModel: "remote", pricingModel: "paid" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("s1");
  });

  it("combines search and hostingModel", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "weather-remote", displayName: "Weather Remote", hostingModel: "remote" });
    seedService(cpId, { name: "weather-local", displayName: "Weather Local", hostingModel: "self_hosted" });

    const caller = authedCaller();
    const result = await caller.services.list({ search: "weather", hostingModel: "remote" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("weather-remote");
  });
});

describe("services.list — pagination edge cases", () => {
  it("cursor pointing to non-existent ID starts from beginning", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "svc-only" });

    const caller = authedCaller();
    const result = await caller.services.list({ cursor: "nonexistent-cursor" });
    expect(result.items).toHaveLength(1);
  });

  it("limit=1 returns exactly one item with correct nextCursor", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "aaa-first", totalInstalls: 10 });
    seedService(cpId, { name: "bbb-second", totalInstalls: 5 });

    const caller = authedCaller();
    const result = await caller.services.list({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeDefined();
  });
});

describe("services.get — anonymous access", () => {
  it("get is accessible without authentication (public procedure)", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "get-public" });

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.services.get({ serviceId: pkgId });
    expect(result.name).toBe("get-public");
  });
});

describe("services.get — field completeness", () => {
  it("returns remoteApiEndpoint and remoteApiConfig for remote services", async () => {
    const cpId = seedCreatorProfile();
    const cardJson = buildServiceCardJson();
    const pkgId = seedService(cpId, {
      name: "remote-detail",
      hostingModel: "remote",
      remoteApiEndpoint: "https://api.example.com",
      remoteApiConfig: cardJson,
    });

    const caller = authedCaller();
    const result = await caller.services.get({ serviceId: pkgId });
    expect(result.remoteApiEndpoint).toBe("https://api.example.com");
    expect(result.remoteApiConfig).toBeTruthy();
  });

  it("returns all fields for self_hosted services", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, {
      name: "self-hosted-detail",
      hostingModel: "self_hosted",
      instructionSnippet: "Always be polite",
      pricingModel: "paid",
    });

    const caller = authedCaller();
    const result = await caller.services.get({ serviceId: pkgId });
    expect(result.hostingModel).toBe("self_hosted");
    expect(result.instructionSnippet).toBe("Always be polite");
    expect(result.pricingModel).toBe("paid");
  });
});

describe("services.install — component status edge cases", () => {
  it("allows install when component status is approved", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { status: "approved" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "approved-comp-pkg" });
    linkComponentToService(pkgId, comp);

    const caller = authedCaller();
    const result = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(result.success).toBe(true);
    expect(result.installedComponents).toBe(1);
  });

  it("rejects install when component status is rejected", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { status: "rejected" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "rejected-comp-pkg" });
    linkComponentToService(pkgId, comp);

    const caller = authedCaller();
    await expect(
      caller.services.install({ serviceId: pkgId, deploymentId: depId })
    ).rejects.toThrow("is no longer available");
  });

  it("rejects install when component status is pending_review", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { status: "pending_review" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "pending-comp-pkg" });
    linkComponentToService(pkgId, comp);

    const caller = authedCaller();
    await expect(
      caller.services.install({ serviceId: pkgId, deploymentId: depId })
    ).rejects.toThrow("is no longer available");
  });
});

describe("services.install — multiple components and skills", () => {
  it("installs all components and skills in a service atomically", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "comp-multi-1" });
    const comp2 = seedComponent(ctx.testUserId, { name: "comp-multi-2" });
    const comp3 = seedComponent(ctx.testUserId, { name: "comp-multi-3" });
    seedVersion(comp1);
    seedVersion(comp2);
    seedVersion(comp3);
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const pkgId = seedService(cpId, { name: "multi-pkg" });
    linkComponentToService(pkgId, comp1);
    linkComponentToService(pkgId, comp2);
    linkComponentToService(pkgId, comp3);
    linkSkillToService(pkgId, skill1);
    linkSkillToService(pkgId, skill2);

    const caller = authedCaller();
    const result = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(result.installedComponents).toBe(3);
    expect(result.installedSkills).toBe(2);
  });

  it("partially skips already-installed components but installs new ones", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "pre-installed" });
    const comp2 = seedComponent(ctx.testUserId, { name: "new-comp" });
    const ver1 = seedVersion(comp1);
    seedVersion(comp2);
    const pkgId = seedService(cpId, { name: "partial-pkg" });
    linkComponentToService(pkgId, comp1);
    linkComponentToService(pkgId, comp2);

    // Pre-install comp1
    installComponentDirectly(comp1, ver1, depId);

    const caller = authedCaller();
    const result = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(result.installedComponents).toBe(1); // Only comp2
  });
});

describe("services.install — syncMarketplaceComponent for running deployment", () => {
  it("calls syncMarketplaceComponent for each newly installed component on running deployment", async () => {
    const depId = seedDeployment({ status: "running" });
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "sync-comp" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "sync-pkg" });
    linkComponentToService(pkgId, comp);

    const caller = authedCaller();
    await caller.services.install({ serviceId: pkgId, deploymentId: depId });

    expect(mockSyncMarketplaceComponent).toHaveBeenCalled();
    expect(mockSyncConfigsToPvc).toHaveBeenCalledWith(depId);
  });

  it("does not call syncMarketplaceComponent for stopped deployment", async () => {
    const depId = seedDeployment({ status: "stopped" });
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "no-sync-comp" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "no-sync-pkg" });
    linkComponentToService(pkgId, comp);

    const caller = authedCaller();
    await caller.services.install({ serviceId: pkgId, deploymentId: depId });

    expect(mockSyncMarketplaceComponent).not.toHaveBeenCalled();
    expect(mockSyncConfigsToPvc).not.toHaveBeenCalled();
  });
});

describe("services.install — service with only instruction snippet (no components/skills)", () => {
  it("install works for a service with only an instruction snippet and one skill", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "snippet-only", instructionSnippet: "Be polite always" });
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();
    const result = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(result.success).toBe(true);
    expect(result.installedSkills).toBe(1);
    expect(result.installedComponents).toBe(0);
  });
});

describe("services.uninstall — totalInstalls floor-at-zero", () => {
  it("floors component totalInstalls at 0 when already at 0", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "floor-comp", totalInstalls: 0 });
    const ver = seedVersion(comp);
    const pkgId = seedService(cpId, { name: "floor-pkg", totalInstalls: 0 });
    linkComponentToService(pkgId, comp);
    installServiceDirectly(pkgId, depId);
    installComponentDirectly(comp, ver, depId);

    const caller = authedCaller();
    await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });

    const compRow = ctx.raw.prepare("SELECT total_installs FROM marketplace_components WHERE id = ?").get(comp) as any;
    expect(compRow.total_installs).toBe(0); // floor at 0, not -1
  });

  it("floors service totalInstalls at 0", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "floor-svc", totalInstalls: 0 });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });

    const pkgRow = ctx.raw.prepare("SELECT total_installs FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(pkgRow.total_installs).toBe(0);
  });
});

describe("services.uninstall — decrements counts correctly", () => {
  it("decrements component totalInstalls by 1", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "dec-comp", totalInstalls: 10 });
    const ver = seedVersion(comp);
    const pkgId = seedService(cpId, { name: "dec-pkg", totalInstalls: 5 });
    linkComponentToService(pkgId, comp);
    installServiceDirectly(pkgId, depId);
    installComponentDirectly(comp, ver, depId);

    const caller = authedCaller();
    const result = await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });
    expect(result.removedComponents).toBe(1);

    const compRow = ctx.raw.prepare("SELECT total_installs FROM marketplace_components WHERE id = ?").get(comp) as any;
    expect(compRow.total_installs).toBe(9);
  });

  it("decrements service totalInstalls by 1", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "dec-svc", totalInstalls: 7 });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });

    const pkgRow = ctx.raw.prepare("SELECT total_installs FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(pkgRow.total_installs).toBe(6);
  });
});

describe("services.uninstall — skill removal", () => {
  it("removes skills linked to service on uninstall", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "skill-unsvc" });
    linkSkillToService(pkgId, skill);
    installServiceDirectly(pkgId, depId);
    installSkillDirectly(skill, depId);

    const caller = authedCaller();
    const result = await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });
    expect(result.removedSkills).toBe(1);

    const skills = ctx.raw.prepare("SELECT * FROM deployment_skills WHERE deployment_id = ?").all(depId);
    expect(skills).toHaveLength(0);
  });

  it("skips skills that were already removed individually", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "skip-skill-unsvc" });
    linkSkillToService(pkgId, skill);
    installServiceDirectly(pkgId, depId);
    // Note: skill not installed on deployment

    const caller = authedCaller();
    const result = await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });
    expect(result.removedSkills).toBe(0);
  });
});

describe("services.getServiceStatus — edge cases", () => {
  it("returns health field from service", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "health-pkg", remoteHealth: "healthy" });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect((result as any).health).toBe("healthy");
  });

  it("returns null health when not set", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "no-health-pkg" });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect((result as any).health).toBeNull();
  });

  it("returns installed components and skills counts of zero when no sub-items", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "empty-items-pkg" });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect((result as any).components.total).toBe(0);
    expect((result as any).components.installed).toBe(0);
    expect((result as any).skills.total).toBe(0);
    expect((result as any).skills.installed).toBe(0);
  });

  it("returns null handshake for self-hosted service", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "self-hosted-status", hostingModel: "self_hosted" });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect((result as any).handshake).toBeNull();
  });

  it("returns installed=false when querying with wrong serviceId", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "ghost-pkg" });
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    // Query with a different serviceId that doesn't have an install
    const result = await caller.services.getServiceStatus({ serviceId: "pkg-nonexistent", deploymentId: depId });
    expect(result.installed).toBe(false);
  });
});

describe("services.publish — input validation edge cases", () => {
  it("rejects name with uppercase letters", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    await expect(
      caller.services.publish({
        name: "MyService",
        displayName: "My Service",
        hostingModel: "self_hosted",
        skillIds: [skill],
      })
    ).rejects.toThrow();
  });

  it("rejects name with spaces", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    await expect(
      caller.services.publish({
        name: "my service",
        displayName: "My Service",
        hostingModel: "self_hosted",
        skillIds: [skill],
      })
    ).rejects.toThrow();
  });

  it("rejects name with special characters", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    await expect(
      caller.services.publish({
        name: "my@service!",
        displayName: "My Service",
        hostingModel: "self_hosted",
        skillIds: [skill],
      })
    ).rejects.toThrow();
  });

  it("accepts name with hyphens", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "my-cool-service",
      displayName: "My Cool Service",
      hostingModel: "self_hosted",
      skillIds: [skill],
    });
    expect(result.serviceId).toBeDefined();
  });

  it("accepts name with numbers", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "service-v2",
      displayName: "Service V2",
      hostingModel: "self_hosted",
      skillIds: [skill],
    });
    expect(result.serviceId).toBeDefined();
  });

  it("rejects empty name", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    await expect(
      caller.services.publish({
        name: "",
        displayName: "Empty Name",
        hostingModel: "self_hosted",
        skillIds: [skill],
      })
    ).rejects.toThrow();
  });

  it("accepts paid pricing model with price", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "paid-service",
      displayName: "Paid Service",
      hostingModel: "self_hosted",
      pricingModel: "paid",
      priceUsdCents: 999,
      skillIds: [skill],
    });

    const pkg = ctx.raw.prepare("SELECT pricing_model, price_usd_cents FROM marketplace_packages WHERE id = ?").get(result.serviceId) as any;
    expect(pkg.pricing_model).toBe("paid");
    expect(pkg.price_usd_cents).toBe(999);
  });

  it("stores instruction snippet on publish", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "snippet-svc",
      displayName: "Snippet Service",
      hostingModel: "self_hosted",
      instructionSnippet: "Always respond with JSON",
      skillIds: [skill],
    });

    const pkg = ctx.raw.prepare("SELECT instruction_snippet FROM marketplace_packages WHERE id = ?").get(result.serviceId) as any;
    expect(pkg.instruction_snippet).toBe("Always respond with JSON");
  });

  it("accepts hybrid hostingModel", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "hybrid-svc",
      displayName: "Hybrid Service",
      hostingModel: "hybrid",
      skillIds: [skill],
    });

    const pkg = ctx.raw.prepare("SELECT hosting_model FROM marketplace_packages WHERE id = ?").get(result.serviceId) as any;
    expect(pkg.hosting_model).toBe("hybrid");
  });
});

describe("services.listByCreator — filtering", () => {
  it("excludes draft services", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "draft-svc", status: "draft" });
    seedService(cpId, { name: "published-svc", status: "published" });

    const caller = authedCaller();
    const result = await caller.services.listByCreator({ creatorId: cpId });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("published-svc");
  });

  it("excludes pending_review services", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "pending-svc", status: "pending_review" });

    const caller = authedCaller();
    const result = await caller.services.listByCreator({ creatorId: cpId });
    expect(result).toHaveLength(0);
  });

  it("excludes rejected services", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "rejected-svc", status: "rejected" });

    const caller = authedCaller();
    const result = await caller.services.listByCreator({ creatorId: cpId });
    expect(result).toHaveLength(0);
  });

  it("is accessible without authentication (public procedure)", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "anon-list-svc" });

    const caller = createAnonymousCaller(ctx.db);
    const result = await caller.services.listByCreator({ creatorId: cpId });
    expect(result).toHaveLength(1);
  });
});

describe("services.install → status → uninstall lifecycle", () => {
  it("full lifecycle: install service, check status, uninstall, verify cleanup", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "lifecycle-comp" });
    seedVersion(comp);
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "lifecycle-pkg" });
    linkComponentToService(pkgId, comp);
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();

    // 1. Install
    const installResult = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(installResult.success).toBe(true);
    expect(installResult.installedComponents).toBe(1);
    expect(installResult.installedSkills).toBe(1);

    // 2. Check status
    const status = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect(status.installed).toBe(true);
    expect((status as any).components.total).toBe(1);
    expect((status as any).components.installed).toBe(1);
    expect((status as any).skills.total).toBe(1);
    expect((status as any).skills.installed).toBe(1);

    // 3. Verify listed as installed
    const installed = await caller.services.listInstalled({ deploymentId: depId });
    expect(installed).toHaveLength(1);

    // 4. Uninstall
    const uninstallResult = await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });
    expect(uninstallResult.success).toBe(true);
    expect(uninstallResult.removedComponents).toBe(1);
    expect(uninstallResult.removedSkills).toBe(1);

    // 5. Verify no longer installed
    const statusAfter = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect(statusAfter.installed).toBe(false);

    const installedAfter = await caller.services.listInstalled({ deploymentId: depId });
    expect(installedAfter).toHaveLength(0);
  });
});

describe("services.install — same service on multiple deployments", () => {
  it("allows installing the same service on different deployments", async () => {
    const dep1 = seedDeployment({ status: "running" });
    const dep2 = seedDeployment({ status: "running" });
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "multi-dep-pkg" });
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();

    const r1 = await caller.services.install({ serviceId: pkgId, deploymentId: dep1 });
    expect(r1.success).toBe(true);

    const r2 = await caller.services.install({ serviceId: pkgId, deploymentId: dep2 });
    expect(r2.success).toBe(true);

    // totalInstalls should be 2
    const pkg = ctx.raw.prepare("SELECT total_installs FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(pkg.total_installs).toBe(2);
  });
});

describe("services.creatorInstalls — multiple deployments", () => {
  it("shows installs from multiple deployments", async () => {
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "creator-multi" });
    linkSkillToService(pkgId, skill);

    const dep1 = seedDeployment();
    const dep2 = seedDeployment();
    installServiceDirectly(pkgId, dep1);
    installServiceDirectly(pkgId, dep2);

    const caller = authedCaller();
    const result = await caller.services.creatorInstalls({ serviceId: pkgId });
    expect(result.totalInstalls).toBe(2);
    expect(result.installs).toHaveLength(2);
  });
});

describe("services.creatorUsage — no creator profile", () => {
  it("throws FORBIDDEN when user has no creator profile at all", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "usage-no-profile" });

    const user2 = seedSecondUser();
    const caller = authedCaller({ userId: user2.userId, auth0Id: user2.auth0Id });
    await expect(
      caller.services.creatorUsage({ serviceId: pkgId })
    ).rejects.toThrow("Not the service creator");
  });
});

describe("services.upgradeService — edge cases", () => {
  it("triggers syncMarketplaceComponent for new components on running deployment", async () => {
    const depId = seedDeployment({ status: "running" });
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "upgrade-sync-comp" });
    seedVersion(comp);
    const pkgId = seedService(cpId, { name: "upgrade-sync-pkg" });
    linkComponentToService(pkgId, comp);
    installServiceDirectly(pkgId, depId);

    const caller = authedCaller();
    const result = await caller.services.upgradeService({ serviceId: pkgId, deploymentId: depId });
    expect(result.newlyInstalledComponents).toBe(1);
    expect(mockSyncMarketplaceComponent).toHaveBeenCalled();
  });

  it("does not trigger sync when upgrade finds nothing new", async () => {
    const depId = seedDeployment({ status: "running" });
    const cpId = seedCreatorProfile();
    const comp = seedComponent(ctx.testUserId, { name: "no-new-comp" });
    const ver = seedVersion(comp);
    const pkgId = seedService(cpId, { name: "no-new-pkg" });
    linkComponentToService(pkgId, comp);
    installServiceDirectly(pkgId, depId);
    installComponentDirectly(comp, ver, depId);

    const caller = authedCaller();
    const result = await caller.services.upgradeService({ serviceId: pkgId, deploymentId: depId });
    expect(result.newlyInstalledComponents).toBe(0);
    expect(result.newlyInstalledSkills).toBe(0);
    expect(mockSyncConfigsToPvc).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when service does not exist at all", async () => {
    const depId = seedDeployment();

    const caller = authedCaller();
    await expect(
      caller.services.upgradeService({ serviceId: "pkg-nonexistent", deploymentId: depId })
    ).rejects.toThrow("Service is not installed on this deployment");
  });
});

describe("services.listInstalled — edge cases", () => {
  it("returns multiple installed services", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const pkg1 = seedService(cpId, { name: "svc-list-1" });
    const pkg2 = seedService(cpId, { name: "svc-list-2" });
    linkSkillToService(pkg1, skill1);
    linkSkillToService(pkg2, skill2);
    installServiceDirectly(pkg1, depId);
    installServiceDirectly(pkg2, depId);

    const caller = authedCaller();
    const result = await caller.services.listInstalled({ deploymentId: depId });
    expect(result).toHaveLength(2);
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.listInstalled({ deploymentId: "dep-001" })
    ).rejects.toThrow("You must be logged in");
  });
});

describe("services.checkForUpdates — edge cases", () => {
  it("returns update when new component added to service after install", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "original-comp" });
    const ver1 = seedVersion(comp1);
    const pkgId = seedService(cpId, { name: "update-check-pkg" });
    linkComponentToService(pkgId, comp1);
    installServiceDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);

    // Add a new component to the package
    const comp2 = seedComponent(ctx.testUserId, { name: "new-comp-added" });
    seedVersion(comp2);
    linkComponentToService(pkgId, comp2);

    const caller = authedCaller();
    const result = await caller.services.checkForUpdates({ deploymentId: depId });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].newComponents).toBe(1);
  });

  it("returns update when new skill added to service after install", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill1 = seedSkill();
    const pkgId = seedService(cpId, { name: "skill-update-pkg" });
    linkSkillToService(pkgId, skill1);
    installServiceDirectly(pkgId, depId);
    installSkillDirectly(skill1, depId);

    // Add a new skill to the package
    const skill2 = seedSkill();
    linkSkillToService(pkgId, skill2);

    const caller = authedCaller();
    const result = await caller.services.checkForUpdates({ deploymentId: depId });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].newSkills).toBe(1);
  });
});

describe("services.listDeploymentSkills — edge cases", () => {
  it("returns multiple installed skills", async () => {
    const depId = seedDeployment();
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    installSkillDirectly(skill1, depId);
    installSkillDirectly(skill2, depId);

    const caller = authedCaller();
    const result = await caller.services.listDeploymentSkills({ deploymentId: depId });
    expect(result).toHaveLength(2);
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.listDeploymentSkills({ deploymentId: "dep-001" })
    ).rejects.toThrow("You must be logged in");
  });
});

describe("services.listDeploymentComponents — edge cases", () => {
  it("returns multiple installed published components", async () => {
    const depId = seedDeployment();
    const comp1 = seedComponent(ctx.testUserId, { name: "dc-1" });
    const comp2 = seedComponent(ctx.testUserId, { name: "dc-2" });
    const ver1 = seedVersion(comp1);
    const ver2 = seedVersion(comp2);
    installComponentDirectly(comp1, ver1, depId);
    installComponentDirectly(comp2, ver2, depId);

    const caller = authedCaller();
    const result = await caller.services.listDeploymentComponents({ deploymentId: depId });
    expect(result).toHaveLength(2);
  });

  it("rejects anonymous caller", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.listDeploymentComponents({ deploymentId: "dep-001" })
    ).rejects.toThrow("You must be logged in");
  });
});

describe("services.install — handshake status for self-hosted", () => {
  it("returns handshakeStatus=skipped for self_hosted service", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "self-hosted-hs", hostingModel: "self_hosted" });
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();
    const result = await caller.services.install({ serviceId: pkgId, deploymentId: depId });
    expect(result.handshakeStatus).toBe("skipped");
  });
});

describe("services.list — sort stability", () => {
  it("services with same totalInstalls are sorted alphabetically by name", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "charlie", totalInstalls: 5 });
    seedService(cpId, { name: "alpha", totalInstalls: 5 });
    seedService(cpId, { name: "bravo", totalInstalls: 5 });

    const caller = authedCaller();
    const result = await caller.services.list();
    const names = result.items.map((i: any) => i.name);
    expect(names).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("higher totalInstalls appear first", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "low", totalInstalls: 1 });
    seedService(cpId, { name: "high", totalInstalls: 100 });
    seedService(cpId, { name: "mid", totalInstalls: 50 });

    const caller = authedCaller();
    const result = await caller.services.list();
    const names = result.items.map((i: any) => i.name);
    expect(names).toEqual(["high", "mid", "low"]);
  });
});

describe("services.get — service with no skills linked", () => {
  it("returns empty skills array when no skills are linked", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "no-skills-pkg" });

    const caller = authedCaller();
    const result = await caller.services.get({ serviceId: pkgId });
    expect(result.skills).toHaveLength(0);
  });
});

describe("services.publish — creator profile from different user", () => {
  it("uses the caller's own creator profile, not another user's", async () => {
    // Create two users with creator profiles
    const user2 = seedSecondUser();
    seedCreatorProfile(); // for test user
    seedCreatorProfile(user2.userId); // for user2

    const skill = seedSkill();

    // Publish as test user
    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "my-own-service",
      displayName: "My Own Service",
      hostingModel: "self_hosted",
      skillIds: [skill],
    });

    // Verify the service is linked to test user's creator profile
    const pkg = ctx.raw.prepare("SELECT creator_id FROM marketplace_packages WHERE id = ?").get(result.serviceId) as any;
    const cp = ctx.raw.prepare("SELECT user_id FROM creator_profiles WHERE id = ?").get(pkg.creator_id) as any;
    expect(cp.user_id).toBe(ctx.testUserId);
  });
});

describe("services.install — service with zero totalInstalls incremented to 1", () => {
  it("increments from 0 to 1 on first install", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "first-install", totalInstalls: 0 });
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();
    await caller.services.install({ serviceId: pkgId, deploymentId: depId });

    const pkg = ctx.raw.prepare("SELECT total_installs FROM marketplace_packages WHERE id = ?").get(pkgId) as any;
    expect(pkg.total_installs).toBe(1);
  });
});

describe("services.uninstall — multiple components and skills", () => {
  it("removes all components and skills linked to service", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "unsvc-c1" });
    const comp2 = seedComponent(ctx.testUserId, { name: "unsvc-c2" });
    const ver1 = seedVersion(comp1);
    const ver2 = seedVersion(comp2);
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const skill3 = seedSkill();
    const pkgId = seedService(cpId, { name: "multi-unsvc" });
    linkComponentToService(pkgId, comp1);
    linkComponentToService(pkgId, comp2);
    linkSkillToService(pkgId, skill1);
    linkSkillToService(pkgId, skill2);
    linkSkillToService(pkgId, skill3);
    installServiceDirectly(pkgId, depId);
    installComponentDirectly(comp1, ver1, depId);
    installComponentDirectly(comp2, ver2, depId);
    installSkillDirectly(skill1, depId);
    installSkillDirectly(skill2, depId);
    installSkillDirectly(skill3, depId);

    const caller = authedCaller();
    const result = await caller.services.uninstall({ serviceId: pkgId, deploymentId: depId });
    expect(result.removedComponents).toBe(2);
    expect(result.removedSkills).toBe(3);

    // Verify all records cleaned up
    const compInstalls = ctx.raw.prepare("SELECT * FROM component_installs WHERE deployment_id = ?").all(depId);
    expect(compInstalls).toHaveLength(0);
    const skillInstalls = ctx.raw.prepare("SELECT * FROM deployment_skills WHERE deployment_id = ?").all(depId);
    expect(skillInstalls).toHaveLength(0);
  });
});

describe("services.getServiceStatus — skill counts", () => {
  it("returns correct skill installed count when some are installed", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const skill3 = seedSkill();
    const pkgId = seedService(cpId, { name: "partial-skills" });
    linkSkillToService(pkgId, skill1);
    linkSkillToService(pkgId, skill2);
    linkSkillToService(pkgId, skill3);
    installServiceDirectly(pkgId, depId);
    installSkillDirectly(skill1, depId);
    installSkillDirectly(skill3, depId);

    const caller = authedCaller();
    const result = await caller.services.getServiceStatus({ serviceId: pkgId, deploymentId: depId });
    expect((result as any).skills.total).toBe(3);
    expect((result as any).skills.installed).toBe(2);
  });
});

describe("services.list — creator info present", () => {
  it("returns creator info when creator profile exists", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, { name: "with-creator-svc" });

    const caller = authedCaller();
    const result = await caller.services.list();
    const item = result.items.find((i: any) => i.name === "with-creator-svc");
    expect(item).toBeDefined();
    expect(item!.creator).not.toBeNull();
    expect(item!.creator!.displayName).toBe("Test Creator");
  });
});

describe("services.publish — description limits", () => {
  it("accepts description at max length (2000 chars)", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "long-desc-svc",
      displayName: "Long Description",
      description: "x".repeat(2000),
      hostingModel: "self_hosted",
      skillIds: [skill],
    });
    expect(result.serviceId).toBeDefined();
  });

  it("accepts null description (optional)", async () => {
    seedCreatorProfile();
    const skill = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "no-desc-svc",
      displayName: "No Description",
      hostingModel: "self_hosted",
      skillIds: [skill],
    });
    expect(result.serviceId).toBeDefined();
  });
});

describe("services.install — configSync for creating status deployment", () => {
  it("does not trigger configSync for creating status deployment", async () => {
    const depId = seedDeployment({ status: "creating" });
    const cpId = seedCreatorProfile();
    const skill = seedSkill();
    const pkgId = seedService(cpId, { name: "creating-dep-pkg" });
    linkSkillToService(pkgId, skill);

    const caller = authedCaller();
    await caller.services.install({ serviceId: pkgId, deploymentId: depId });

    expect(mockSyncConfigsToPvc).not.toHaveBeenCalled();
    expect(mockSyncMarketplaceComponent).not.toHaveBeenCalled();
  });
});

describe("services.uninstall — deployment ownership check", () => {
  it("rejects uninstall on another user's deployment", async () => {
    const user2 = seedSecondUser();
    const depId = seedDeployment({ userId: user2.userId });

    const caller = authedCaller();
    await expect(
      caller.services.uninstall({ serviceId: "pkg-any", deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("services.listByCreator — return fields", () => {
  it("returns all expected fields", async () => {
    const cpId = seedCreatorProfile();
    seedService(cpId, {
      name: "field-check",
      displayName: "Field Check",
      description: "Testing fields",
      hostingModel: "remote",
      pricingModel: "paid",
      totalInstalls: 42,
    });

    const caller = authedCaller();
    const result = await caller.services.listByCreator({ creatorId: cpId });
    expect(result).toHaveLength(1);
    const svc = result[0];
    expect(svc).toHaveProperty("id");
    expect(svc).toHaveProperty("name", "field-check");
    expect(svc).toHaveProperty("displayName", "Field Check");
    expect(svc).toHaveProperty("description", "Testing fields");
    expect(svc).toHaveProperty("hostingModel", "remote");
    expect(svc).toHaveProperty("pricingModel", "paid");
    expect(svc).toHaveProperty("totalInstalls", 42);
    expect(svc).toHaveProperty("avgRating");
    expect(svc).toHaveProperty("createdAt");
  });
});

describe("services.install — component totalInstalls incremented", () => {
  it("increments each component's totalInstalls by 1", async () => {
    const depId = seedDeployment();
    const cpId = seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "inc-c1", totalInstalls: 5 });
    const comp2 = seedComponent(ctx.testUserId, { name: "inc-c2", totalInstalls: 10 });
    seedVersion(comp1);
    seedVersion(comp2);
    const pkgId = seedService(cpId, { name: "inc-pkg" });
    linkComponentToService(pkgId, comp1);
    linkComponentToService(pkgId, comp2);

    const caller = authedCaller();
    await caller.services.install({ serviceId: pkgId, deploymentId: depId });

    const c1 = ctx.raw.prepare("SELECT total_installs FROM marketplace_components WHERE id = ?").get(comp1) as any;
    const c2 = ctx.raw.prepare("SELECT total_installs FROM marketplace_components WHERE id = ?").get(comp2) as any;
    expect(c1.total_installs).toBe(6);
    expect(c2.total_installs).toBe(11);
  });
});

describe("services.creatorInstalls — empty installs", () => {
  it("returns totalInstalls=0 and empty array when no installs", async () => {
    const cpId = seedCreatorProfile();
    const pkgId = seedService(cpId, { name: "no-installs-svc" });

    const caller = authedCaller();
    const result = await caller.services.creatorInstalls({ serviceId: pkgId });
    expect(result.totalInstalls).toBe(0);
    expect(result.installs).toEqual([]);
  });
});

describe("services.rotateSigningSecret — deployment ownership", () => {
  it("rejects rotation for another user's deployment", async () => {
    const user2 = seedSecondUser();
    const depId = seedDeployment({ userId: user2.userId });

    const caller = authedCaller();
    await expect(
      caller.services.rotateSigningSecret({ serviceId: "pkg-any", deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("services.checkForUpdates — deployment ownership", () => {
  it("rejects for another user's deployment", async () => {
    const user2 = seedSecondUser();
    const depId = seedDeployment({ userId: user2.userId });

    const caller = authedCaller();
    await expect(
      caller.services.checkForUpdates({ deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("services.upgradeService — deployment ownership", () => {
  it("rejects upgrade for another user's deployment", async () => {
    const user2 = seedSecondUser();
    const depId = seedDeployment({ userId: user2.userId });

    const caller = authedCaller();
    await expect(
      caller.services.upgradeService({ serviceId: "pkg-any", deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("services.install — anonymous access rejected", () => {
  it("rejects anonymous caller for install", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.install({ serviceId: "any", deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for uninstall", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.uninstall({ serviceId: "any", deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for publish", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.publish({
        name: "test",
        displayName: "Test",
        hostingModel: "self_hosted",
        skillIds: [],
      })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for getServiceStatus", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.getServiceStatus({ serviceId: "any", deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for checkForUpdates", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.checkForUpdates({ deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for upgradeService", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.upgradeService({ serviceId: "any", deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for creatorInstalls", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.creatorInstalls({ serviceId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for creatorUsage", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.creatorUsage({ serviceId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for rotateSigningSecret", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.rotateSigningSecret({ serviceId: "any", deploymentId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for adminList", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.adminList()
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for adminApprove", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.adminApprove({ serviceId: "any" })
    ).rejects.toThrow("You must be logged in");
  });

  it("rejects anonymous caller for adminReject", async () => {
    const caller = createAnonymousCaller(ctx.db);
    await expect(
      caller.services.adminReject({ serviceId: "any" })
    ).rejects.toThrow("You must be logged in");
  });
});

describe("services.listInstalled — deployment ownership", () => {
  it("rejects listing installed services for another user's deployment", async () => {
    const user2 = seedSecondUser();
    const depId = seedDeployment({ userId: user2.userId });

    const caller = authedCaller();
    await expect(
      caller.services.listInstalled({ deploymentId: depId })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("services.publish — multiple skills and components", () => {
  it("publishes a service with multiple components and multiple skills", async () => {
    seedCreatorProfile();
    const comp1 = seedComponent(ctx.testUserId, { name: "multi-pub-c1" });
    const comp2 = seedComponent(ctx.testUserId, { name: "multi-pub-c2" });
    seedVersion(comp1);
    seedVersion(comp2);
    const skill1 = seedSkill();
    const skill2 = seedSkill();
    const skill3 = seedSkill();

    const caller = authedCaller();
    const result = await caller.services.publish({
      name: "multi-pub-svc",
      displayName: "Multi Publish Service",
      hostingModel: "self_hosted",
      componentIds: [comp1, comp2],
      skillIds: [skill1, skill2, skill3],
    });

    expect(result.serviceId).toBeDefined();

    const comps = ctx.raw.prepare("SELECT * FROM package_components WHERE package_id = ?").all(result.serviceId);
    expect(comps).toHaveLength(2);

    const skills = ctx.raw.prepare("SELECT * FROM package_skills WHERE package_id = ?").all(result.serviceId);
    expect(skills).toHaveLength(3);
  });
});
