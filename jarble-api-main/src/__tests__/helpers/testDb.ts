/**
 * Test database helper - creates a fresh in-memory SQLite DB per test suite.
 *
 * Uses better-sqlite3 (devDependency only) + drizzle-orm to mirror the Postgres
 * production schema. Drizzle abstracts the SQL differences so tests exercise
 * real query logic without requiring a running Postgres server.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./testSchema.sqlite.js";

// Mirrors the full schema from db/init.ts — kept in sync with schema.pg.ts columns.
// This is SQLite DDL used ONLY for tests; production uses Postgres.
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
    deployment_type TEXT DEFAULT 'agent' NOT NULL,
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
    org_id TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id);
  CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
  CREATE INDEX IF NOT EXISTS idx_deployments_is_public ON deployments(is_public);
  CREATE INDEX IF NOT EXISTS idx_deployments_org_id ON deployments(org_id);

  CREATE TABLE IF NOT EXISTS platform_credentials (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL,
    credentials TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_platform ON platform_credentials(deployment_id, platform_id);

  CREATE TABLE IF NOT EXISTS deployment_secrets (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_secret_key ON deployment_secrets(deployment_id, key);

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

  CREATE TABLE IF NOT EXISTS orchestration_flows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    definition TEXT NOT NULL,
    status TEXT DEFAULT 'draft' NOT NULL,
    is_public INTEGER DEFAULT 0 NOT NULL,
    fork_count INTEGER DEFAULT 0 NOT NULL,
    forked_from_id TEXT,
    entry_node_id TEXT,
    team_type TEXT DEFAULT 'hierarchy' NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orch_flows_user_id ON orchestration_flows(user_id);
  CREATE INDEX IF NOT EXISTS idx_orch_flows_status ON orchestration_flows(status);
  CREATE INDEX IF NOT EXISTS idx_orch_flows_is_public ON orchestration_flows(is_public);

  CREATE TABLE IF NOT EXISTS flow_executions (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES orchestration_flows(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT DEFAULT 'pending' NOT NULL,
    step_results TEXT,
    total_credits_charged INTEGER DEFAULT 0 NOT NULL,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_flow_exec_flow_id ON flow_executions(flow_id);
  CREATE INDEX IF NOT EXISTS idx_flow_exec_user_id ON flow_executions(user_id);
  CREATE INDEX IF NOT EXISTS idx_flow_exec_status ON flow_executions(status);

  CREATE TABLE IF NOT EXISTS deployment_subagents (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    model TEXT,
    trigger_type TEXT DEFAULT 'manual' NOT NULL,
    trigger_config TEXT,
    tools TEXT,
    enabled INTEGER DEFAULT 1 NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    source TEXT DEFAULT 'custom' NOT NULL,
    is_public INTEGER DEFAULT 0 NOT NULL,
    forked_from_id TEXT,
    fork_count INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deployment_subagents_deployment_id ON deployment_subagents(deployment_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_subagents_deployment_slug ON deployment_subagents(deployment_id, slug);
  CREATE INDEX IF NOT EXISTS idx_deployment_subagents_is_public ON deployment_subagents(is_public);

  CREATE TABLE IF NOT EXISTS flow_deployment_memberships (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES orchestration_flows(id) ON DELETE CASCADE,
    deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    role TEXT,
    is_entry_point INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_flow_deployment_node ON flow_deployment_memberships(flow_id, deployment_id, node_id);
  CREATE INDEX IF NOT EXISTS idx_flow_dep_membership_deployment_id ON flow_deployment_memberships(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_flow_dep_membership_flow_id ON flow_deployment_memberships(flow_id);

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT DEFAULT 'member' NOT NULL,
    invited_by TEXT REFERENCES users(id),
    joined_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_org_member_user ON org_members(org_id, user_id);

  CREATE TABLE IF NOT EXISTS org_invites (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member' NOT NULL,
    token TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL REFERENCES users(id),
    status TEXT DEFAULT 'pending' NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invite_email ON org_invites(org_id, email);
`;

export interface TestDbContext {
  /** Drizzle ORM instance (typed as SQLite) */
  db: ReturnType<typeof drizzle<typeof sqliteSchema>>;
  /** Raw better-sqlite3 connection (for cleanup) */
  raw: Database.Database;
  /** Seeded test user ID */
  testUserId: string;
  /** Seeded test user auth0Id */
  testAuth0Id: string;
  /** Seeded runtime catalog ID for openclaw */
  openclawCatalogId: number;
}

/**
 * Create a fresh in-memory SQLite database with tables and seed data.
 * Call `raw.close()` in afterAll to clean up.
 */
export function createTestDb(): TestDbContext {
  const raw = new Database(":memory:");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(CREATE_TABLES_SQL);

  const db = drizzle(raw, { schema: sqliteSchema });

  // Seed runtime catalog
  raw.exec(`
    INSERT INTO runtime_catalog (slug, name, description, category, docker_image, cpu_limit, memory_mb, storage_mb, monthly_price_cents)
    VALUES
      ('openclaw', 'OpenClaw', 'AI assistant', 'bot', 'ghcr.io/jarble-ai/openclaw:latest', '2.0', 2048, 30, 0),
      ('zeroclaw', 'ZeroClaw', 'Lightweight bot', 'bot', 'ghcr.io/jarble-ai/zeroclaw:latest', '2.0', 2048, 30, 0);
  `);

  // Seed persona templates
  raw.exec(`
    INSERT INTO persona_templates (id, name, slug, category, description, system_prompt, showcase_prompts, is_active, sort_order)
    VALUES
      ('persona-general', 'General Assistant', 'general-assistant', 'general', 'A helpful AI assistant', 'You are a helpful, knowledgeable AI assistant.', '["Help me with...", "Explain..."]', 1, 0),
      ('persona-dev', 'Full-Stack Developer', 'full-stack-developer', 'technical', 'Code review and architecture', 'You are an expert full-stack developer.', '["Review this code", "Design an API"]', 1, 1),
      ('persona-sales', 'Sales Coach', 'sales-coach', 'business', 'B2B/B2C sales strategy', 'You are an experienced sales coach.', '["Help me close a deal", "Write a pitch"]', 1, 2);
  `);

  // Seed test user (free deployment NOT used - fresh user)
  const testUserId = "test-user-001";
  const testAuth0Id = "auth0|test-integration-001";
  raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('${testUserId}', 'test@jarble.ai', 'Test User', '${testAuth0Id}', 1, 0);
  `);

  return {
    db,
    raw,
    testUserId,
    testAuth0Id,
    openclawCatalogId: 1,
  };
}
