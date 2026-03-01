/**
 * Initialize in-memory SQLite database (creates tables + seeds)
 * Called at startup when USE_SQLITE=true
 */
import { sqliteDb, sqliteRaw, sqliteSchema, USE_SQLITE } from "./index.js";
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
  ];
  for (const skill of skills) {
    await sqliteDb.insert(sqliteSchema.skillsCatalog).values(skill);
  }

  logger.info("Seeded: 2 runtimes, 1 user, 1 deployment, 5 skills");

  // Seed marketplace data
  await seedMarketplaceData(sqliteDb, userId, deploymentId);
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
