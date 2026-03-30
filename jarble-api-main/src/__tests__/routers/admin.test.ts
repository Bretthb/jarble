/**
 * Integration tests for the admin tRPC router.
 *
 * Tests auth guards, getStats, listUsers, getUserById, updateUserRole,
 * listAllDeployments, adminStartDeployment, adminDeleteDeployment.
 *
 * The admin router uses the module-level `db` from `../../db/index.js`
 * rather than `ctx.db`, so we mock that module to inject the test DB.
 * Uses real in-memory SQLite with mocked K8s, Stripe, Prometheus, etc.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema.sqlite.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Hoisted mutable DB reference ─────────────────────────────────────────────
// vi.hoisted runs before vi.mock factories, giving us a mutable holder
// that the db/index mock can close over.
const dbHolder = vi.hoisted(() => ({
  db: null as any,
  raw: null as any,
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/admin.js", () => {
  const adminIds = new Set(["admin-001"]);
  return {
    isAdmin: (userId: string) => adminIds.has(userId),
    getAdminUserIds: () => adminIds,
  };
});

// Mock the db module so the admin router queries hit our test DB
vi.mock("../../db/index.js", () => ({
  get db() { return dbHolder.db; },
  get tables() {
    return {
      users: sqliteSchema.users,
      deployments: sqliteSchema.deployments,
      runtimeCatalog: sqliteSchema.runtimeCatalog,
      platformCredentials: sqliteSchema.platformCredentials,
      processedWebhookEvents: sqliteSchema.processedWebhookEvents,
      skillsCatalog: sqliteSchema.skillsCatalog,
      deploymentSkills: sqliteSchema.deploymentSkills,
      creatorProfiles: sqliteSchema.creatorProfiles,
      marketplaceComponents: sqliteSchema.marketplaceComponents,
      componentVersions: sqliteSchema.componentVersions,
      componentInstalls: sqliteSchema.componentInstalls,
      componentPurchases: sqliteSchema.componentPurchases,
      componentReviews: sqliteSchema.componentReviews,
      marketplaceServices: sqliteSchema.marketplaceServices,
      serviceComponents: sqliteSchema.serviceComponents,
      serviceSkills: sqliteSchema.serviceSkills,
      serviceInstalls: sqliteSchema.serviceInstalls,
      serviceCredentials: sqliteSchema.serviceCredentials,
      serviceUsage: sqliteSchema.serviceUsage,
      serviceRateLimits: sqliteSchema.serviceRateLimits,
      serviceCircuitBreakers: sqliteSchema.serviceCircuitBreakers,
      serviceHeartbeats: sqliteSchema.serviceHeartbeats,
      serviceAsyncJobs: sqliteSchema.serviceAsyncJobs,
      apiKeys: sqliteSchema.apiKeys,
      domains: sqliteSchema.domains,
      deploymentRatings: sqliteSchema.deploymentRatings,
      deploymentDomainScores: sqliteSchema.deploymentDomainScores,
      serviceBenchmarkSamples: sqliteSchema.serviceBenchmarkSamples,
      serviceBenchmarkAggregates: sqliteSchema.serviceBenchmarkAggregates,
      serviceReviews: sqliteSchema.serviceReviews,
      personaTemplates: sqliteSchema.personaTemplates,
      agentCalls: sqliteSchema.agentCalls,
      chatSessions: sqliteSchema.chatSessions,
      chatMessages: sqliteSchema.chatMessages,
      auditLogs: sqliteSchema.auditLogs,
      betaSignups: sqliteSchema.betaSignups,
    } as any;
  },
  dbDate: (date: Date = new Date()) => date.toISOString(),
  DB_PROVIDER: "sqlite",
  USE_SQLITE: true,
  sqliteRaw: null,
  sqliteDb: null,
  mysqlSchema: sqliteSchema,
  sqliteSchema,
  pgSchema: sqliteSchema,
  schema: sqliteSchema,
  getRowsAffected: (result: any) => {
    if (Array.isArray(result) && result[0]?.affectedRows != null) return result[0].affectedRows;
    if (result?.rowsAffected != null) return result.rowsAffected;
    if (result?.changes != null) return result.changes;
    return 0;
  },
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

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/email.js", () => ({
  sendBetaWelcomeEmail: vi.fn().mockResolvedValue(true),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../../services/prometheus.js", () => ({
  queryInstant: vi.fn().mockResolvedValue([]),
  queryRange: vi.fn().mockResolvedValue([]),
  isReachable: vi.fn().mockResolvedValue(false),
  getActiveAlerts: vi.fn().mockResolvedValue([]),
  QUERY_KEYS: ["node_cpu", "node_memory", "node_disk", "running_pods", "pod_restarts"],
}));

// Mock auditLog — the admin router calls logAdminAction which also uses module-level `db`.
// By mocking this, we avoid the audit log trying to hit a different DB instance.
const mockLogAdminAction = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/auditLog.js", () => ({
  logAdminAction: (...args: any[]) => mockLogAdminAction(...args),
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

// ── Schema SQL (same as testDb.ts) ──────────────────────────────────────────

// We reuse the same CREATE TABLE SQL from testDb — kept in sync with db/init.ts
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS runtime_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'bot' NOT NULL,
    docker_image TEXT NOT NULL,
    cpu_limit TEXT DEFAULT '2.0' NOT NULL,
    memory_mb INTEGER DEFAULT 2048 NOT NULL,
    storage_mb INTEGER DEFAULT 30 NOT NULL,
    monthly_price_cents INTEGER DEFAULT 0 NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth0_id TEXT NOT NULL UNIQUE,
    email_verified INTEGER DEFAULT 0 NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    stripe_customer_id TEXT,
    pending_stripe_subscription_id TEXT,
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
    runtime_catalog_id INTEGER REFERENCES runtime_catalog(id),
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
  CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id);
  CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
  CREATE INDEX IF NOT EXISTS idx_deployments_is_public ON deployments(is_public);
  CREATE TABLE IF NOT EXISTS platform_credentials (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL,
    credentials TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_platform ON platform_credentials(deployment_id, platform_id);
  CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skills_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    runtime TEXT DEFAULT 'openclaw' NOT NULL,
    config TEXT NOT NULL,
    author TEXT,
    is_official INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deployment_skills (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills_catalog(id),
    installed_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_skill ON deployment_skills(deployment_id, skill_id);
  CREATE TABLE IF NOT EXISTS creator_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT,
    website_url TEXT,
    avatar_url TEXT,
    stripe_connect_account_id TEXT,
    stripe_connect_onboarded INTEGER DEFAULT 0 NOT NULL,
    is_verified INTEGER DEFAULT 0 NOT NULL,
    is_platform INTEGER DEFAULT 0 NOT NULL,
    total_earnings_cents INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marketplace_components (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    bot_description TEXT,
    tier TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT,
    icon TEXT,
    props_schema TEXT,
    example_props TEXT,
    example_prompts TEXT,
    pricing_model TEXT DEFAULT 'free' NOT NULL,
    price_usd_cents INTEGER DEFAULT 0 NOT NULL,
    stripe_price_id TEXT,
    stripe_product_id TEXT,
    current_version TEXT DEFAULT '1.0.0' NOT NULL,
    status TEXT DEFAULT 'draft' NOT NULL,
    review_notes TEXT,
    total_installs INTEGER DEFAULT 0 NOT NULL,
    total_revenue_cents INTEGER DEFAULT 0 NOT NULL,
    average_rating INTEGER,
    rating_count INTEGER DEFAULT 0 NOT NULL,
    featured_at TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_component_name ON marketplace_components(creator_id, name);
  CREATE TABLE IF NOT EXISTS component_versions (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES marketplace_components(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    changelog TEXT,
    package_url TEXT NOT NULL,
    package_size_bytes INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL,
    status TEXT DEFAULT 'published' NOT NULL,
    download_count INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_component_version ON component_versions(component_id, version);
  CREATE TABLE IF NOT EXISTS component_installs (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES marketplace_components(id),
    version_id TEXT NOT NULL REFERENCES component_versions(id),
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    pinned_version TEXT,
    auto_update INTEGER DEFAULT 1 NOT NULL,
    synced_at TEXT,
    installed_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_component ON component_installs(deployment_id, component_id);
  CREATE TABLE IF NOT EXISTS component_purchases (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES marketplace_components(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    stripe_payment_intent_id TEXT,
    stripe_subscription_id TEXT,
    amount_cents INTEGER NOT NULL,
    platform_fee_cents INTEGER NOT NULL,
    creator_payout_cents INTEGER NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    purchased_at TEXT DEFAULT (datetime('now')) NOT NULL,
    expires_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_component_purchase ON component_purchases(user_id, component_id);
  CREATE TABLE IF NOT EXISTS component_reviews (
    id TEXT PRIMARY KEY,
    component_id TEXT NOT NULL REFERENCES marketplace_components(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    creator_response TEXT,
    creator_responded_at TEXT,
    helpful INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_component_review ON component_reviews(user_id, component_id);
  CREATE TABLE IF NOT EXISTS marketplace_packages (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creator_profiles(id),
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    hosting_model TEXT NOT NULL,
    instruction_snippet TEXT,
    remote_api_endpoint TEXT,
    remote_api_config TEXT,
    remote_health TEXT DEFAULT 'unknown',
    remote_last_check TEXT,
    creator_deployment_id TEXT,
    status TEXT DEFAULT 'draft' NOT NULL,
    pricing_model TEXT DEFAULT 'free' NOT NULL,
    price_usd_cents INTEGER DEFAULT 0 NOT NULL,
    is_platform INTEGER DEFAULT 0 NOT NULL,
    total_installs INTEGER DEFAULT 0 NOT NULL,
    avg_rating TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_package_name ON marketplace_packages(creator_id, name);
  CREATE TABLE IF NOT EXISTS package_components (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES marketplace_packages(id) ON DELETE CASCADE,
    component_id TEXT NOT NULL REFERENCES marketplace_components(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_package_component ON package_components(package_id, component_id);
  CREATE TABLE IF NOT EXISTS package_skills (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES marketplace_packages(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills_catalog(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_package_skill ON package_skills(package_id, skill_id);
  CREATE TABLE IF NOT EXISTS package_installs (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES marketplace_packages(id),
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    installed_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_package ON package_installs(deployment_id, package_id);
  CREATE TABLE IF NOT EXISTS package_credentials (
    id TEXT PRIMARY KEY,
    package_install_id TEXT NOT NULL REFERENCES package_installs(id) ON DELETE CASCADE,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL REFERENCES marketplace_packages(id),
    signing_secret TEXT NOT NULL,
    previous_signing_secret TEXT,
    previous_secret_expires_at TEXT,
    handshake_status TEXT DEFAULT 'pending' NOT NULL,
    handshake_error TEXT,
    remote_install_id TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_package_cred ON package_credentials(deployment_id, package_id);
  CREATE TABLE IF NOT EXISTS package_usage (
    id TEXT PRIMARY KEY,
    package_install_id TEXT NOT NULL REFERENCES package_installs(id) ON DELETE CASCADE,
    deployment_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    request_count INTEGER DEFAULT 0 NOT NULL,
    billing_cycle_start TEXT NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS persona_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    recommended_tools TEXT,
    default_theme TEXT,
    suggested_llm TEXT,
    icon TEXT,
    example_conversation TEXT,
    showcase_prompts TEXT,
    is_active INTEGER DEFAULT 1 NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_rate_limits (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    window_type TEXT NOT NULL,
    window_start TEXT NOT NULL,
    count INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_srl_deployment_service_window ON service_rate_limits(deployment_id, service_id, window_type, window_start);
  CREATE TABLE IF NOT EXISTS service_circuit_breakers (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL UNIQUE,
    state TEXT DEFAULT 'CLOSED' NOT NULL,
    consecutive_failures INTEGER DEFAULT 0 NOT NULL,
    last_failure_at TEXT,
    opened_at TEXT,
    half_open_claimed_by TEXT,
    half_open_claimed_at TEXT,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_heartbeats (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL UNIQUE,
    last_heartbeat_at TEXT NOT NULL,
    heartbeat_interval_ms INTEGER DEFAULT 60000 NOT NULL,
    payload TEXT,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    scopes TEXT DEFAULT 'mesh:read,mesh:write' NOT NULL,
    rate_limit_per_min INTEGER DEFAULT 60 NOT NULL,
    rate_limit_per_day INTEGER DEFAULT 10000 NOT NULL,
    last_used_at TEXT,
    request_count INTEGER DEFAULT 0 NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
  CREATE TABLE IF NOT EXISTS service_async_jobs (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    request_body TEXT NOT NULL,
    response_body TEXT,
    response_status INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    completed_at TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_service_async_jobs_deployment_id ON service_async_jobs(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_service_async_jobs_expires_at ON service_async_jobs(expires_at);
  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    parent_id TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_domains_parent ON domains(parent_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_domains_name ON domains(name);
  CREATE TABLE IF NOT EXISTS deployment_ratings (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    domain_id TEXT NOT NULL REFERENCES domains(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    accuracy INTEGER NOT NULL,
    helpfulness INTEGER NOT NULL,
    creativity INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_rating ON deployment_ratings(user_id, deployment_id, domain_id);
  CREATE INDEX IF NOT EXISTS idx_drt_deployment_domain ON deployment_ratings(deployment_id, domain_id);
  CREATE TABLE IF NOT EXISTS deployment_domain_scores (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    domain_id TEXT NOT NULL REFERENCES domains(id),
    avg_accuracy INTEGER,
    avg_helpfulness INTEGER,
    avg_creativity INTEGER,
    overall_score INTEGER,
    rating_count INTEGER DEFAULT 0 NOT NULL,
    confidence TEXT DEFAULT 'low' NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_dds_deployment_domain ON deployment_domain_scores(deployment_id, domain_id);
  CREATE INDEX IF NOT EXISTS idx_dds_domain_score ON deployment_domain_scores(domain_id, overall_score);
  CREATE TABLE IF NOT EXISTS service_benchmark_samples (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL,
    success INTEGER DEFAULT 1 NOT NULL,
    response_size_bytes INTEGER,
    sampled_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sbs_service_skill ON service_benchmark_samples(service_id, skill_name);
  CREATE INDEX IF NOT EXISTS idx_sbs_sampled_at ON service_benchmark_samples(sampled_at);
  CREATE TABLE IF NOT EXISTS service_benchmark_aggregates (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    period TEXT NOT NULL,
    latency_p50 INTEGER,
    latency_p95 INTEGER,
    latency_p99 INTEGER,
    uptime_percent INTEGER,
    error_rate INTEGER,
    avg_response_size INTEGER,
    sample_count INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_sba_service_skill_period ON service_benchmark_aggregates(service_id, skill_name, period);
  CREATE TABLE IF NOT EXISTS service_reviews (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES marketplace_packages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    creator_response TEXT,
    creator_responded_at TEXT,
    helpful INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_service_review ON service_reviews(user_id, service_id);
  CREATE TABLE IF NOT EXISTS agent_credits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_credits_user_id ON agent_credits(user_id);
  CREATE TABLE IF NOT EXISTS agent_calls (
    id TEXT PRIMARY KEY,
    caller_deployment_id TEXT NOT NULL REFERENCES deployments(id),
    callee_deployment_id TEXT NOT NULL REFERENCES deployments(id),
    skill_name TEXT NOT NULL,
    credits_charged INTEGER DEFAULT 0 NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    request_body TEXT,
    response_body TEXT,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_calls_caller ON agent_calls(caller_deployment_id);
  CREATE INDEX IF NOT EXISTS idx_agent_calls_callee ON agent_calls(callee_deployment_id);
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New conversation' NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    thinking_text TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE TABLE IF NOT EXISTS beta_signups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    experience TEXT,
    use_case TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    invited_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
`;

// ── Setup ────────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = "admin-001";
const ADMIN_AUTH0_ID = "auth0|admin-001";
const REGULAR_USER_ID = "user-regular-001";
const REGULAR_AUTH0_ID = "auth0|regular-001";

let raw: Database.Database;

function createFreshDb() {
  const rawDb = new Database(":memory:");
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.exec(CREATE_TABLES_SQL);

  const db = drizzle(rawDb, { schema: sqliteSchema });

  // Seed runtime catalog
  rawDb.exec(`
    INSERT INTO runtime_catalog (slug, name, description, category, docker_image, cpu_limit, memory_mb, storage_mb, monthly_price_cents)
    VALUES
      ('openclaw', 'OpenClaw', 'AI assistant', 'bot', 'ghcr.io/jarble-ai/openclaw:latest', '2.0', 2048, 30, 0),
      ('zeroclaw', 'ZeroClaw', 'Lightweight bot', 'bot', 'ghcr.io/jarble-ai/zeroclaw:latest', '2.0', 2048, 30, 0);
  `);

  // Seed admin user
  rawDb.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, role)
    VALUES ('${ADMIN_USER_ID}', 'admin@jarble.ai', 'Admin User', '${ADMIN_AUTH0_ID}', 1, 'super_admin');
  `);

  // Seed regular user
  rawDb.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, role)
    VALUES ('${REGULAR_USER_ID}', 'regular@jarble.ai', 'Regular User', '${REGULAR_AUTH0_ID}', 1, 'user');
  `);

  return { db, raw: rawDb };
}

beforeEach(() => {
  if (raw) raw.close();
  const fresh = createFreshDb();
  raw = fresh.raw;
  // Update the mutable holder so the mocked db/index.js returns this DB
  dbHolder.db = fresh.db;
  dbHolder.raw = fresh.raw;
  vi.clearAllMocks();
});

afterAll(() => {
  raw?.close();
});

// ── Caller Helpers ──────────────────────────────────────────────────────────

function adminCaller() {
  return createTestCaller(dbHolder.db, {
    id: ADMIN_USER_ID,
    email: "admin@jarble.ai",
    name: "Admin User",
    auth0Id: ADMIN_AUTH0_ID,
    emailVerified: true,
  });
}

function regularCaller() {
  return createTestCaller(dbHolder.db, {
    id: REGULAR_USER_ID,
    email: "regular@jarble.ai",
    name: "Regular User",
    auth0Id: REGULAR_AUTH0_ID,
    emailVerified: true,
  });
}

/** Seed a deployment directly via SQL. */
function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-admin-001";
  raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || REGULAR_USER_ID,
    overrides.name || "Test Deployment",
    overrides.runtime || "openclaw",
    overrides.runtimeCatalogId || 1,
    overrides.status || "running",
    overrides.llmMode || "byok",
    overrides.llmProvider || "openrouter",
    overrides.managedBy || "legacy",
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("admin auth guard", () => {
  it("rejects non-admin user with FORBIDDEN", async () => {
    const caller = regularCaller();
    await expect(caller.admin.getStats()).rejects.toThrow("Admin access required");
  });

  it("rejects anonymous caller with UNAUTHORIZED", async () => {
    const caller = createAnonymousCaller(dbHolder.db);
    await expect(caller.admin.getStats()).rejects.toThrow("You must be logged in");
  });
});

describe("admin.getStats", () => {
  it("returns correct counts for users, deployments, active deployments", async () => {
    // Seed some deployments
    seedDeployment({ id: "dep-1", status: "running" });
    seedDeployment({ id: "dep-2", status: "running" });
    seedDeployment({ id: "dep-3", status: "stopped" });

    const caller = adminCaller();
    const result = await caller.admin.getStats();

    // 2 users (admin + regular) seeded in beforeEach
    expect(result.totalUsers).toBe(2);
    expect(result.totalDeployments).toBe(3);
    expect(result.activeDeployments).toBe(2);
  });

  it("returns zeros when database is empty (except seeded users)", async () => {
    const caller = adminCaller();
    const result = await caller.admin.getStats();

    expect(result.totalUsers).toBe(2); // admin + regular always seeded
    expect(result.totalDeployments).toBe(0);
    expect(result.activeDeployments).toBe(0);
    expect(result.totalChatSessions).toBe(0);
    expect(result.totalRevenueCents).toBe(0);
  });
});

describe("admin.listUsers", () => {
  it("returns paginated user list", async () => {
    const caller = adminCaller();
    const result = await caller.admin.listUsers({ page: 1, limit: 20 });

    expect(result.users.length).toBe(2); // admin + regular
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it("respects search filter", async () => {
    const caller = adminCaller();
    const result = await caller.admin.listUsers({ page: 1, limit: 20, search: "admin" });

    expect(result.users.length).toBe(1);
    expect(result.users[0].email).toBe("admin@jarble.ai");
  });

  it("pagination works (limit + offset)", async () => {
    // Add more users for pagination test
    for (let i = 0; i < 5; i++) {
      raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('page-user-${i}', 'page${i}@jarble.ai', 'Page User ${i}', 'auth0|page${i}', 1)`);
    }

    const caller = adminCaller();

    // Total should be 7 (admin + regular + 5 page users)
    const page1 = await caller.admin.listUsers({ page: 1, limit: 3 });
    expect(page1.users.length).toBe(3);
    expect(page1.total).toBe(7);

    const page2 = await caller.admin.listUsers({ page: 2, limit: 3 });
    expect(page2.users.length).toBe(3);

    const page3 = await caller.admin.listUsers({ page: 3, limit: 3 });
    expect(page3.users.length).toBe(1);
  });
});

describe("admin.getUserById", () => {
  it("returns user with their deployments", async () => {
    seedDeployment({ id: "dep-for-user", userId: REGULAR_USER_ID, name: "User Bot" });

    const caller = adminCaller();
    const result = await caller.admin.getUserById({ userId: REGULAR_USER_ID });

    expect(result.id).toBe(REGULAR_USER_ID);
    expect(result.email).toBe("regular@jarble.ai");
    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0].name).toBe("User Bot");
  });

  it("throws NOT_FOUND for non-existent user", async () => {
    const caller = adminCaller();
    await expect(
      caller.admin.getUserById({ userId: "nonexistent" })
    ).rejects.toThrow("User not found");
  });
});

describe("admin.updateUserRole", () => {
  it("promotes user to super_admin", async () => {
    const caller = adminCaller();
    const result = await caller.admin.updateUserRole({
      userId: REGULAR_USER_ID,
      role: "super_admin",
    });

    expect(result.success).toBe(true);

    const user = raw.prepare("SELECT role FROM users WHERE id = ?").get(REGULAR_USER_ID) as any;
    expect(user.role).toBe("super_admin");
  });

  it("logs audit action", async () => {
    const caller = adminCaller();
    await caller.admin.updateUserRole({
      userId: REGULAR_USER_ID,
      role: "super_admin",
    });

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN_USER_ID,
        action: "update_user_role",
        targetType: "user",
        targetId: REGULAR_USER_ID,
        metadata: { newRole: "super_admin" },
      })
    );
  });
});

describe("admin.listAllDeployments", () => {
  it("returns all deployments across users", async () => {
    seedDeployment({ id: "dep-a", userId: REGULAR_USER_ID, name: "Bot A" });
    seedDeployment({ id: "dep-b", userId: ADMIN_USER_ID, name: "Bot B" });

    const caller = adminCaller();
    const result = await caller.admin.listAllDeployments({ page: 1, limit: 20 });

    expect(result.deployments).toHaveLength(2);
    expect(result.total).toBe(2);
    const names = result.deployments.map((d: any) => d.name).sort();
    expect(names).toEqual(["Bot A", "Bot B"]);
  });

  it("filters by status", async () => {
    seedDeployment({ id: "dep-run", status: "running" });
    seedDeployment({ id: "dep-stop", status: "stopped" });

    const caller = adminCaller();
    const result = await caller.admin.listAllDeployments({ page: 1, limit: 20, status: "running" });

    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0].status).toBe("running");
  });

  it("filters by search query", async () => {
    seedDeployment({ id: "dep-search-1", name: "Alpha Bot" });
    seedDeployment({ id: "dep-search-2", name: "Beta Bot" });

    const caller = adminCaller();
    const result = await caller.admin.listAllDeployments({ page: 1, limit: 20, search: "Alpha" });

    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0].name).toBe("Alpha Bot");
  });
});

describe("admin.adminStartDeployment", () => {
  it("starts a deployment", async () => {
    seedDeployment({ id: "dep-start", status: "stopped" });

    const { startDeployment } = await import("../../k8s/index.js");

    const caller = adminCaller();
    const result = await caller.admin.adminStartDeployment({ id: "dep-start" });

    expect(result.success).toBe(true);
    expect(startDeployment).toHaveBeenCalledWith("dep-start");
  });

  it("throws NOT_FOUND for non-existent deployment", async () => {
    const caller = adminCaller();
    await expect(
      caller.admin.adminStartDeployment({ id: "nonexistent" })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("admin.adminDeleteDeployment", () => {
  it("deletes deployment", async () => {
    seedDeployment({ id: "dep-del" });

    const { deleteDeployment } = await import("../../k8s/index.js");

    const caller = adminCaller();
    const result = await caller.admin.adminDeleteDeployment({ id: "dep-del" });

    expect(result.success).toBe(true);
    expect(deleteDeployment).toHaveBeenCalledWith("dep-del");

    // Verify DB cleanup
    const dep = raw.prepare("SELECT * FROM deployments WHERE id = ?").get("dep-del");
    expect(dep).toBeUndefined();
  });

  it("logs audit action", async () => {
    seedDeployment({ id: "dep-del-audit" });

    const caller = adminCaller();
    await caller.admin.adminDeleteDeployment({ id: "dep-del-audit" });

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN_USER_ID,
        action: "delete_deployment",
        targetType: "deployment",
        targetId: "dep-del-audit",
      })
    );
  });
});
