/**
 * Initialize in-memory SQLite database (creates tables + seeds)
 * Called at startup when USE_SQLITE=true
 */
import { sqliteDb, sqliteRaw, sqliteSchema, USE_SQLITE } from "./index.js";
import { generateMarketplaceId } from "./schema.sqlite.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

// SQL to create tables (mirrors schema.sqlite.ts)
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
    isolation_level TEXT DEFAULT 'standard' NOT NULL,
    theme_config TEXT,
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
`;

export async function initDatabase() {
  if (!USE_SQLITE) {
    return; // MySQL/Postgres mode - nothing to init
  }

  if (!sqliteRaw || !sqliteDb) {
    throw new Error("SQLite connection not initialized");
  }

  // Create tables
  logger.info("Creating SQLite tables");
  sqliteRaw.exec(CREATE_TABLES_SQL);

  // Migrations for existing DBs (ALTER TABLE is idempotent with IF NOT EXISTS on columns)
  try {
    const cols = sqliteRaw.pragma("table_info(deployments)") as Array<{ name: string }>;
    const colNames = new Set(cols.map((c: any) => c.name));
    if (!colNames.has("theme_config")) {
      sqliteRaw.exec("ALTER TABLE deployments ADD COLUMN theme_config TEXT");
      logger.info("Added theme_config column to deployments");
    }
  } catch (err) {
    logger.warn({ err }, "Theme config migration skipped (may already exist)");
  }

  // Migration: add fork & public profile columns to deployments
  try {
    const cols = sqliteRaw.pragma("table_info(deployments)") as Array<{ name: string }>;
    const colNames = new Set(cols.map((c: any) => c.name));
    const newCols: Array<[string, string]> = [
      ["forked_from_id", "ALTER TABLE deployments ADD COLUMN forked_from_id TEXT"],
      ["is_public", "ALTER TABLE deployments ADD COLUMN is_public INTEGER DEFAULT 0 NOT NULL"],
      ["fork_count", "ALTER TABLE deployments ADD COLUMN fork_count INTEGER DEFAULT 0 NOT NULL"],
      ["featured_at", "ALTER TABLE deployments ADD COLUMN featured_at TEXT"],
      ["specialties", "ALTER TABLE deployments ADD COLUMN specialties TEXT"],
      ["bio", "ALTER TABLE deployments ADD COLUMN bio TEXT"],
      ["showcase_prompts", "ALTER TABLE deployments ADD COLUMN showcase_prompts TEXT"],
    ];
    for (const [name, sql] of newCols) {
      if (!colNames.has(name)) {
        sqliteRaw.exec(sql);
        logger.info(`Added ${name} column to deployments`);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Deployment fork/public columns migration skipped (may already exist)");
  }

  // Migration: ensure 'general' domain exists
  try {
    sqliteRaw.exec(`
      INSERT OR IGNORE INTO domains (id, name, display_name, description, icon, sort_order, created_at)
      VALUES ('dom_general', 'general', 'General', 'General-purpose bots and assistants', '⭐', 0, datetime('now'))
    `);
  } catch (err) {
    logger.warn({ err }, "General domain migration skipped");
  }

  // Seed with test data
  logger.info("Seeding test data");
  await seedDatabase();
}

async function seedDatabase() {
  if (!sqliteDb) return;

  // Check if already seeded
  const existingRuntime = await sqliteDb.query.runtimeCatalog.findFirst();
  if (existingRuntime) {
    logger.info("Database already seeded, skipping");
    return;
  }

  // Seed runtime catalog (2 runtimes — pricing TBD)
  // NOTE: storageMb values are in GB (historical naming — column is "storage_mb" but unit is GB)
  const runtimes = [
    {
      slug: "openclaw",
      name: "OpenClaw",
      description: "AI-powered WhatsApp assistant with conversation memory and tool use",
      category: "bot",
      dockerImage: "ghcr.io/jarble-ai/openclaw:latest",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 30,
      monthlyPriceCents: 0,
    },
    {
      slug: "zeroclaw",
      name: "ZeroClaw",
      description: "Lightweight zero-config chatbot for quick deployment",
      category: "bot",
      dockerImage: "ghcr.io/jarble-ai/zeroclaw:latest",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 30,
      monthlyPriceCents: 0,
    },
  ];

  for (const runtime of runtimes) {
    await sqliteDb.insert(sqliteSchema.runtimeCatalog).values(runtime);
  }

  // Create test user (free deployment already used)
  const userId = nanoid();
  await sqliteDb.insert(sqliteSchema.users).values({
    id: userId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: "auth0|test123",
    emailVerified: true,
    stripeCustomerId: "cus_test123",
    freeDeploymentUsed: true,
  });

  // Create test deployment (free trial, OpenClaw, expires in 7 days)
  const deploymentId = nanoid();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await sqliteDb.insert(sqliteSchema.deployments).values({
    id: deploymentId,
    userId,
    name: "My First Deployment",
    description: "A test deployment for development",
    runtime: "openclaw",
    runtimeCatalogId: 1,
    isFree: true,
    monthlyPriceCents: 0,
    freeExpiresAt: expiresAt,
    llmMode: "byok",
    llmProvider: "openrouter",
    llmModel: "openrouter/auto",
    status: "running",
  });

  // Seed sample skills marketplace catalog
  const skills = [
    { id: nanoid(), name: "Web Search", description: "Search the web for real-time information", runtime: "openclaw", config: JSON.stringify({ tool: "web_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Weather", description: "Get current weather for any location", runtime: "openclaw", config: JSON.stringify({ tool: "weather", params: { units: "metric" } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Calculator", description: "Perform math calculations", runtime: "openclaw", config: JSON.stringify({ tool: "calculator" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Wikipedia", description: "Look up information from Wikipedia", runtime: "openclaw", config: JSON.stringify({ tool: "wikipedia", params: { language: "en" } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Translator", description: "Translate text between languages", runtime: "openclaw", config: JSON.stringify({ tool: "translator" }), author: "Jarble", isOfficial: true },
    // 16 new MCP tools — free, no API keys needed
    { id: nanoid(), name: "Web Fetch", description: "Read and extract text content from any URL", runtime: "openclaw", config: JSON.stringify({ tool: "web_fetch", params: { maxLength: 10000 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "News Search", description: "Search recent news articles", runtime: "openclaw", config: JSON.stringify({ tool: "news_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Hacker News", description: "Search Hacker News stories and discussions", runtime: "openclaw", config: JSON.stringify({ tool: "hacker_news", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "GitHub Search", description: "Search GitHub public repositories", runtime: "openclaw", config: JSON.stringify({ tool: "github_search", params: { maxResults: 5, sort: "stars" } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "npm Search", description: "Search npm packages", runtime: "openclaw", config: JSON.stringify({ tool: "npm_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Academic Search", description: "Search arXiv for academic papers and research", runtime: "openclaw", config: JSON.stringify({ tool: "academic_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Dictionary", description: "Look up word definitions, phonetics, and usage examples", runtime: "openclaw", config: JSON.stringify({ tool: "dictionary" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Currency Exchange", description: "Get live currency exchange rates (ECB data)", runtime: "openclaw", config: JSON.stringify({ tool: "currency_exchange" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Timezone", description: "Get current time in any timezone worldwide", runtime: "openclaw", config: JSON.stringify({ tool: "timezone" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Country Info", description: "Look up country information (population, capital, currency, etc.)", runtime: "openclaw", config: JSON.stringify({ tool: "country_info" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Open Library", description: "Search for books by title, author, or subject", runtime: "openclaw", config: JSON.stringify({ tool: "open_library", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Code Runner", description: "Execute JavaScript code snippets safely", runtime: "openclaw", config: JSON.stringify({ tool: "code_runner", params: { timeout: 5000 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "URL Metadata", description: "Extract title, description, and preview image from any URL", runtime: "openclaw", config: JSON.stringify({ tool: "url_metadata" }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "RSS Reader", description: "Read RSS and Atom feeds from any source", runtime: "openclaw", config: JSON.stringify({ tool: "rss_reader", params: { maxItems: 10 } }), author: "Jarble", isOfficial: true },
    { id: nanoid(), name: "Image Search", description: "Search for images on the web", runtime: "openclaw", config: JSON.stringify({ tool: "image_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
  ];
  for (const skill of skills) {
    await sqliteDb.insert(sqliteSchema.skillsCatalog).values(skill);
  }

  // Seed domain taxonomy
  const existingDomain = await sqliteDb.query.domains.findFirst();
  let domainCount = 0;
  if (!existingDomain) {
    const domainSeeds = [
      { name: "general", displayName: "General", description: "General-purpose bots and assistants", icon: "\u2B50", sortOrder: 0 },
      { name: "finance", displayName: "Finance", description: "Financial analysis, trading, and planning", icon: "\u{1F4B0}", sortOrder: 1 },
      { name: "coding", displayName: "Coding", description: "Programming, debugging, and software development", icon: "\u{1F4BB}", sortOrder: 2 },
      { name: "data-analysis", displayName: "Data Analysis", description: "Data visualization, statistics, and BI", icon: "\u{1F4CA}", sortOrder: 3 },
      { name: "creative-writing", displayName: "Creative Writing", description: "Fiction, poetry, and content creation", icon: "\u270D\uFE0F", sortOrder: 4 },
      { name: "customer-support", displayName: "Customer Support", description: "Help desk and customer service", icon: "\u{1F3A7}", sortOrder: 5 },
      { name: "education", displayName: "Education", description: "Tutoring, learning, and exam prep", icon: "\u{1F4DA}", sortOrder: 6 },
      { name: "research", displayName: "Research", description: "Academic and market research", icon: "\u{1F52C}", sortOrder: 7 },
      { name: "marketing", displayName: "Marketing", description: "Content marketing, SEO, and campaigns", icon: "\u{1F4E2}", sortOrder: 8 },
      { name: "legal", displayName: "Legal", description: "Contract review and compliance", icon: "\u2696\uFE0F", sortOrder: 9 },
      { name: "healthcare", displayName: "Healthcare", description: "Health information and wellness", icon: "\u{1F3E5}", sortOrder: 10 },
      { name: "gaming", displayName: "Gaming", description: "Game design, strategy, and entertainment", icon: "\u{1F3AE}", sortOrder: 11 },
      { name: "music", displayName: "Music", description: "Music theory, production, and analysis", icon: "\u{1F3B5}", sortOrder: 12 },
      { name: "weather", displayName: "Weather", description: "Weather forecasting and climate", icon: "\u{1F324}\uFE0F", sortOrder: 13 },
      { name: "news", displayName: "News", description: "News aggregation and analysis", icon: "\u{1F4F0}", sortOrder: 14 },
      { name: "travel", displayName: "Travel", description: "Travel planning and recommendations", icon: "\u2708\uFE0F", sortOrder: 15 },
      { name: "food", displayName: "Food", description: "Recipes, nutrition, and restaurant recommendations", icon: "\u{1F37D}\uFE0F", sortOrder: 16 },
      { name: "fitness", displayName: "Fitness", description: "Workout plans and exercise guidance", icon: "\u{1F4AA}", sortOrder: 17 },
      { name: "productivity", displayName: "Productivity", description: "Task management and workflow optimization", icon: "\u{1F4CB}", sortOrder: 18 },
      { name: "entertainment", displayName: "Entertainment", description: "Movies, TV, books, and pop culture", icon: "\u{1F3AC}", sortOrder: 19 },
      { name: "science", displayName: "Science", description: "Scientific exploration and explanation", icon: "\u{1F9EA}", sortOrder: 20 },
    ];

    for (const domain of domainSeeds) {
      await sqliteDb.insert(sqliteSchema.domains).values({
        id: generateMarketplaceId("dom"),
        ...domain,
      });
    }
    domainCount = domainSeeds.length;
  } else {
    // Migration: ensure 'general' domain exists for existing DBs
    const generalDomain = await sqliteDb.query.domains.findFirst({
      where: eq(sqliteSchema.domains.name, "general"),
    });
    if (!generalDomain) {
      await sqliteDb.insert(sqliteSchema.domains).values({
        id: generateMarketplaceId("dom"),
        name: "general",
        displayName: "General",
        description: "General-purpose bots and assistants",
        icon: "\u2B50",
        sortOrder: 0,
      });
      logger.info("Added missing 'general' domain");
    }
  }

  logger.info(`Seeded: 2 runtimes, 1 user, 1 deployment, 21 skills, ${domainCount} domains`);

  // Seed persona templates
  await seedPersonaTemplates(sqliteDb);

  // Seed marketplace data
  await seedMarketplaceData(sqliteDb, userId, deploymentId);
}

async function seedPersonaTemplates(db: NonNullable<typeof sqliteDb>) {
  const existing = await db.query.personaTemplates.findFirst();
  if (existing) {
    logger.info("Persona templates already seeded, skipping");
    return;
  }

  const personas = [
    // ── General ──
    {
      id: nanoid(),
      name: "General Assistant",
      slug: "general-assistant",
      category: "general",
      description: "A helpful, knowledgeable AI assistant ready for any task",
      systemPrompt: "You are a versatile and knowledgeable AI assistant. You help users with a wide range of tasks including answering questions, brainstorming ideas, writing content, and solving problems. Be clear, concise, and friendly. When uncertain, say so honestly and suggest where the user might find more information.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F916}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "Help me plan a weekend trip to a new city",
        "Explain quantum computing in simple terms",
        "Write a professional email declining a meeting",
        "What are the pros and cons of remote work?",
      ]),
      sortOrder: 0,
    },
    {
      id: nanoid(),
      name: "Research Analyst",
      slug: "research-analyst",
      category: "general",
      description: "Deep research, fact-checking, and comprehensive analysis",
      systemPrompt: "You are a meticulous research analyst. Your approach involves gathering evidence, cross-referencing sources, and providing well-structured analysis. Always cite your reasoning, distinguish between established facts and your inferences, and present multiple perspectives on complex topics. Use structured formats like bullet points and tables when presenting findings.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F50D}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "Compare the top 5 project management tools for small teams",
        "What are the latest trends in renewable energy adoption?",
        "Analyze the impact of AI on the job market in the next 5 years",
        "Research the history and current state of space exploration",
      ]),
      sortOrder: 1,
    },
    // ── Business ──
    {
      id: nanoid(),
      name: "Sales Coach",
      slug: "sales-coach",
      category: "business",
      description: "B2B/B2C sales strategy, objection handling, pipeline management",
      systemPrompt: "You are an experienced sales coach with deep expertise in both B2B and B2C sales. You help with crafting pitches, handling objections, managing pipelines, and improving close rates. Use real-world examples and proven frameworks like SPIN selling, Challenger Sale, and MEDDIC. Be encouraging but direct when giving feedback. Always focus on value-based selling over pressure tactics.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F4B0}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "flat" }),
      showcasePrompts: JSON.stringify([
        "Help me craft a cold outreach email for a SaaS product",
        "How do I handle the objection: 'We don't have budget right now'?",
        "Create a discovery call script for enterprise prospects",
        "What metrics should I track in my sales pipeline?",
      ]),
      sortOrder: 2,
    },
    {
      id: nanoid(),
      name: "Customer Support",
      slug: "customer-support",
      category: "business",
      description: "Empathetic support agent with escalation protocols",
      systemPrompt: "You are a professional and empathetic customer support agent. Always acknowledge the customer's frustration before jumping to solutions. Follow a structured approach: listen, empathize, diagnose, solve, and follow up. When you can't resolve an issue, clearly explain the escalation path. Use simple language, avoid jargon, and always maintain a calm, helpful tone even with difficult requests.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F3A7}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "flat" }),
      showcasePrompts: JSON.stringify([
        "Draft a response to a customer complaining about a delayed shipment",
        "How should I handle an angry customer demanding a refund?",
        "Create a FAQ template for a new product launch",
        "Write an escalation policy for tier 1 support agents",
      ]),
      sortOrder: 3,
    },
    {
      id: nanoid(),
      name: "Marketing Strategist",
      slug: "marketing-strategist",
      category: "business",
      description: "Content strategy, SEO, campaign planning, analytics",
      systemPrompt: "You are a seasoned marketing strategist with expertise in digital marketing, content strategy, SEO, social media, and campaign analytics. You help create data-driven marketing plans, optimize content for search engines, craft compelling copy, and analyze campaign performance. Stay current with marketing trends and platform algorithm changes. Always tie recommendations back to measurable business outcomes.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F4E2}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "Create a 3-month content calendar for a B2B SaaS startup",
        "How do I improve my website's SEO for competitive keywords?",
        "Write 5 variations of ad copy for a product launch",
        "Analyze this campaign's metrics and suggest improvements",
      ]),
      sortOrder: 4,
    },
    // ── Technical ──
    {
      id: nanoid(),
      name: "Full-Stack Developer",
      slug: "full-stack-developer",
      category: "technical",
      description: "Code review, architecture, debugging, best practices",
      systemPrompt: "You are a senior full-stack developer with expertise in modern web technologies including TypeScript, React, Node.js, Python, databases, and cloud infrastructure. You write clean, well-tested code and follow SOLID principles. When reviewing code, provide specific actionable feedback. When debugging, think systematically about root causes. Always consider security, performance, and maintainability in your recommendations.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F4BB}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "terminal" }),
      showcasePrompts: JSON.stringify([
        "Review this React component for performance issues",
        "Design a database schema for a multi-tenant SaaS app",
        "Help me debug this async/await issue in Node.js",
        "What's the best way to implement authentication in a Next.js app?",
      ]),
      sortOrder: 5,
    },
    {
      id: nanoid(),
      name: "DevOps Engineer",
      slug: "devops-engineer",
      category: "technical",
      description: "CI/CD, Docker, Kubernetes, cloud infrastructure",
      systemPrompt: "You are a DevOps engineer experienced with CI/CD pipelines, containerization, orchestration, and cloud platforms (AWS, GCP, Azure). You help with Dockerfiles, Kubernetes manifests, Terraform configs, GitHub Actions, and monitoring setups. Prioritize reliability, security, and cost optimization. Explain infrastructure decisions clearly and always consider disaster recovery and rollback strategies.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u2699\uFE0F",
      defaultTheme: JSON.stringify({ preset: "default", skin: "terminal" }),
      showcasePrompts: JSON.stringify([
        "Write a Dockerfile for a Node.js app with multi-stage build",
        "Set up a GitHub Actions CI/CD pipeline with testing and deployment",
        "How do I implement zero-downtime deployments with Kubernetes?",
        "Design a monitoring and alerting strategy for a microservices architecture",
      ]),
      sortOrder: 6,
    },
    {
      id: nanoid(),
      name: "Data Scientist",
      slug: "data-scientist",
      category: "technical",
      description: "Statistical analysis, ML model evaluation, data visualization",
      systemPrompt: "You are a data scientist skilled in statistics, machine learning, and data visualization. You help with exploratory data analysis, model selection, feature engineering, and interpreting results. Explain statistical concepts clearly and always consider the practical implications of your analysis. Use appropriate metrics, validate assumptions, and communicate uncertainty honestly. Recommend visualization approaches that tell compelling data stories.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F4CA}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "What ML model should I use for customer churn prediction?",
        "Help me design an A/B test for a new feature rollout",
        "Explain the difference between correlation and causation with examples",
        "How do I handle missing data in a large dataset?",
      ]),
      sortOrder: 7,
    },
    // ── Creative ──
    {
      id: nanoid(),
      name: "Creative Writer",
      slug: "creative-writer",
      category: "creative",
      description: "Stories, scripts, poetry, creative brainstorming",
      systemPrompt: "You are a talented creative writer with a flair for storytelling, vivid imagery, and compelling characters. You help with fiction, screenwriting, poetry, blog posts, and creative brainstorming. Adapt your tone and style to the genre and audience. Offer constructive feedback on existing work, suggest narrative techniques, and help overcome writer's block. Be imaginative but also practical about structure and pacing.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u270D\uFE0F",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "Write the opening paragraph of a mystery novel set in Tokyo",
        "Help me develop a compelling villain for my fantasy story",
        "Give me 10 unique blog post ideas about sustainable living",
        "Write a short poem about the changing of seasons",
      ]),
      sortOrder: 8,
    },
    {
      id: nanoid(),
      name: "UX Designer",
      slug: "ux-designer",
      category: "creative",
      description: "User research, wireframing, design critique, accessibility",
      systemPrompt: "You are a UX designer with deep expertise in user-centered design, information architecture, and accessibility. You help with user research planning, wireframe feedback, usability heuristic evaluations, and design system decisions. Always advocate for the end user while balancing business goals. Consider accessibility (WCAG guidelines), responsive design, and inclusive design practices in all recommendations.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F3A8}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "glass" }),
      showcasePrompts: JSON.stringify([
        "Critique the onboarding flow for a mobile banking app",
        "What user research methods work best for a B2B product?",
        "Help me create a design system for a startup's dashboard",
        "How do I make a data-heavy table accessible on mobile?",
      ]),
      sortOrder: 9,
    },
    {
      id: nanoid(),
      name: "Brand Strategist",
      slug: "brand-strategist",
      category: "creative",
      description: "Brand voice, visual identity, positioning, storytelling",
      systemPrompt: "You are a brand strategist who helps companies define and refine their brand identity. You excel at brand positioning, voice and tone guidelines, competitive differentiation, and brand storytelling. Help craft mission statements, taglines, and brand narratives that resonate with target audiences. Consider brand consistency across all touchpoints and how brand strategy connects to business objectives.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F3AF}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "flat" }),
      showcasePrompts: JSON.stringify([
        "Help me define a brand voice for a health-tech startup",
        "Write a brand positioning statement for a premium coffee brand",
        "How do I differentiate my brand in a crowded market?",
        "Create a brand storytelling framework for investor presentations",
      ]),
      sortOrder: 10,
    },
    // ── Education ──
    {
      id: nanoid(),
      name: "Tutor",
      slug: "tutor",
      category: "education",
      description: "Patient explanations, Socratic method, adaptive difficulty",
      systemPrompt: "You are a patient and encouraging tutor who adapts to each student's learning level. Use the Socratic method — ask guiding questions rather than giving answers directly. Break complex topics into manageable steps, use analogies and real-world examples, and check understanding frequently. Celebrate progress and normalize mistakes as part of learning. Adjust difficulty based on the student's responses.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F4DA}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "flat" }),
      showcasePrompts: JSON.stringify([
        "Explain calculus derivatives like I'm in high school",
        "Help me understand the causes of World War I",
        "Quiz me on basic organic chemistry concepts",
        "I'm struggling with essay structure — can you help?",
      ]),
      sortOrder: 11,
    },
    {
      id: nanoid(),
      name: "Language Teacher",
      slug: "language-teacher",
      category: "education",
      description: "Conversation practice, grammar, vocabulary building",
      systemPrompt: "You are a friendly and patient language teacher. Help students practice conversation, improve grammar, expand vocabulary, and understand cultural context. Gently correct mistakes by repeating the correct form naturally in your response. Adjust your language complexity to match the student's level. Use spaced repetition concepts for vocabulary and encourage the student to express ideas even if imperfectly. Support learning in any language the student requests.",
      suggestedLlm: "anthropic/claude-sonnet-4-20250514",
      icon: "\u{1F30D}",
      defaultTheme: JSON.stringify({ preset: "default", skin: "flat" }),
      showcasePrompts: JSON.stringify([
        "Let's have a beginner conversation in Spanish about food",
        "Explain the difference between ser and estar with examples",
        "Give me 10 useful Japanese phrases for traveling",
        "Help me practice past tense in French through a story",
      ]),
      sortOrder: 12,
    },
  ];

  for (const persona of personas) {
    await db.insert(sqliteSchema.personaTemplates).values(persona);
  }

  logger.info(`Seeded ${personas.length} persona templates`);
}

async function seedMarketplaceData(
  db: NonNullable<typeof sqliteDb>,
  userId: string,
  deploymentId: string,
) {
  // Idempotency check
  const existing = await db.query.creatorProfiles.findFirst();
  if (existing) {
    logger.info("Marketplace already seeded, skipping");
    return;
  }

  const creatorId = nanoid();
  const now = new Date().toISOString();

  // 1. Creator profile for the test user
  await db.insert(sqliteSchema.creatorProfiles).values({
    id: creatorId,
    userId,
    displayName: "Jarble Official",
    bio: "Official components from the Jarble team",
    isVerified: true,
  });

  // 2. Three sample components (free, template tier, published)
  const components = [
    {
      id: `cmp_seed_dashboard`,
      creatorId: userId,
      name: "sales_dashboard",
      displayName: "Sales Dashboard",
      description: "A comprehensive sales dashboard with key metrics and charts",
      tier: "template",
      category: "dashboard",
      tags: JSON.stringify(["sales", "metrics", "dashboard"]),
      pricingModel: "free",
      status: "published",
      publishedAt: now,
      totalInstalls: 1,
      averageRating: 500,
      ratingCount: 1,
    },
    {
      id: `cmp_seed_chart`,
      creatorId: userId,
      name: "analytics_chart",
      displayName: "Analytics Chart",
      description: "Interactive analytics chart with multiple visualization types",
      tier: "template",
      category: "chart",
      tags: JSON.stringify(["analytics", "chart", "visualization"]),
      pricingModel: "free",
      status: "published",
      publishedAt: now,
    },
    {
      id: `cmp_seed_form`,
      creatorId: userId,
      name: "contact_form",
      displayName: "Contact Form",
      description: "A customizable contact form with validation",
      tier: "template",
      category: "form",
      tags: JSON.stringify(["form", "contact", "input"]),
      pricingModel: "free",
      status: "published",
      publishedAt: now,
    },
  ];

  for (const comp of components) {
    await db.insert(sqliteSchema.marketplaceComponents).values(comp);
  }

  // 3. One version per component (v1.0.0)
  const versions = [
    {
      id: `ver_seed_dashboard`,
      componentId: `cmp_seed_dashboard`,
      version: "1.0.0",
      changelog: "Initial release",
      packageUrl: "local://seed/sales_dashboard/1.0.0",
      packageSizeBytes: 2048,
      manifestHash: "sha256-seed-dashboard",
    },
    {
      id: `ver_seed_chart`,
      componentId: `cmp_seed_chart`,
      version: "1.0.0",
      changelog: "Initial release",
      packageUrl: "local://seed/analytics_chart/1.0.0",
      packageSizeBytes: 1536,
      manifestHash: "sha256-seed-chart",
    },
    {
      id: `ver_seed_form`,
      componentId: `cmp_seed_form`,
      version: "1.0.0",
      changelog: "Initial release",
      packageUrl: "local://seed/contact_form/1.0.0",
      packageSizeBytes: 1024,
      manifestHash: "sha256-seed-form",
    },
  ];

  for (const ver of versions) {
    await db.insert(sqliteSchema.componentVersions).values(ver);
  }

  // 4. One install (sales_dashboard on test deployment)
  await db.insert(sqliteSchema.componentInstalls).values({
    id: `inst_seed_dashboard`,
    componentId: `cmp_seed_dashboard`,
    versionId: `ver_seed_dashboard`,
    deploymentId,
    userId,
  });

  // 5. One review (5 stars on sales_dashboard)
  await db.insert(sqliteSchema.componentReviews).values({
    id: `rev_seed_dashboard`,
    componentId: `cmp_seed_dashboard`,
    userId,
    rating: 5,
    title: "Great dashboard component",
    body: "Easy to use and looks great out of the box.",
  });

  logger.info("Seeded marketplace: 1 creator, 3 components, 3 versions, 1 install, 1 review");
}
