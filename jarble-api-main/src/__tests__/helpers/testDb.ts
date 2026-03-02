/**
 * Test database helper — creates a fresh in-memory SQLite DB per test suite.
 *
 * Uses better-sqlite3 + drizzle-orm to create the same tables as schema.sqlite.ts,
 * then exposes the db and raw connection for tests.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema.sqlite.js";

// Same CREATE TABLE SQL from db/init.ts — keeps test DB schema in sync
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
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

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

  // Seed test user (free deployment NOT used — fresh user)
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
