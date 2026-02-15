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
    cpu_limit TEXT DEFAULT '0.25' NOT NULL,
    memory_mb INTEGER DEFAULT 512 NOT NULL,
    storage_mb INTEGER DEFAULT 100 NOT NULL,
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
    llm_mode TEXT DEFAULT 'byok' NOT NULL,
    llm_provider TEXT DEFAULT 'openrouter' NOT NULL,
    llm_api_key TEXT,
    status TEXT DEFAULT 'creating' NOT NULL,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
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
  const runtimes = [
    {
      slug: "openclaw",
      name: "OpenClaw",
      description: "AI-powered WhatsApp assistant with conversation memory and tool use",
      category: "bot",
      dockerImage: "ghcr.io/jarble-ai/openclaw:latest",
      cpuLimit: "0.25",
      memoryMb: 512,
      storageMb: 100,
      monthlyPriceCents: 0,
    },
    {
      slug: "zeroclaw",
      name: "ZeroClaw",
      description: "Lightweight zero-config chatbot for quick deployment",
      category: "bot",
      dockerImage: "ghcr.io/jarble-ai/zeroclaw:latest",
      cpuLimit: "0.15",
      memoryMb: 256,
      storageMb: 50,
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
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await sqliteDb.insert(sqliteSchema.deployments).values({
    id: nanoid(),
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
    status: "running",
  });

  logger.info("Seeded: 2 runtimes, 1 user, 1 deployment");
}
