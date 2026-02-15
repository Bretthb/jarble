/**
 * Initialize in-memory SQLite database (creates tables + seeds)
 * Called at startup when USE_SQLITE=true
 */
import { sqliteDb, sqliteRaw, sqliteSchema, USE_SQLITE } from "./index.js";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

// SQL to create tables (mirrors schema.sqlite.ts)
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price TEXT NOT NULL,
    credits_per_month INTEGER NOT NULL,
    max_deployments INTEGER DEFAULT 1 NOT NULL,
    features TEXT,
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
    tier_id INTEGER REFERENCES tiers(id),
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    template TEXT,
    runtime TEXT DEFAULT 'openclaw' NOT NULL,
    image TEXT,
    status TEXT DEFAULT 'creating' NOT NULL,
    error TEXT,
    tier_id INTEGER REFERENCES tiers(id),
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
`;

export async function initDatabase() {
  if (!USE_SQLITE) {
    return; // MySQL mode - nothing to init
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
  const existingTiers = await sqliteDb.query.tiers.findFirst();
  if (existingTiers) {
    logger.info("Database already seeded, skipping");
    return;
  }

  // Create tiers (Free=1, Pro=1, Agency=2 max deployments — pricing TBD)
  const tiers = [
    { name: "Free", description: "Get started for free", price: "0", creditsPerMonth: 1000, maxDeployments: 1, features: JSON.stringify(["1 deployment", "Basic templates", "Community support"]) },
    { name: "Pro", description: "For serious builders", price: "0", creditsPerMonth: 10000, maxDeployments: 1, features: JSON.stringify(["1 deployment", "All templates", "Priority support", "Custom domains"]) },
    { name: "Agency", description: "For teams and agencies", price: "0", creditsPerMonth: 100000, maxDeployments: 2, features: JSON.stringify(["2 deployments", "White-label", "API access", "Dedicated support"]) },
  ];

  for (const tier of tiers) {
    await sqliteDb.insert(sqliteSchema.tiers).values(tier);
  }

  // Create test user (assigned to Free tier by default)
  const userId = nanoid();
  await sqliteDb.insert(sqliteSchema.users).values({
    id: userId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: "auth0|test123",
    emailVerified: true,
    stripeCustomerId: "cus_test123",
    tierId: 1, // Free tier
  });

  // Create test deployment
  await sqliteDb.insert(sqliteSchema.deployments).values({
    id: nanoid(),
    userId,
    name: "My First Deployment",
    description: "A test deployment for development",
    template: "assistant",
    runtime: "openclaw",
    status: "running",
    tierId: 1,
  });

  logger.info("Seeded: 3 tiers, 1 user, 1 deployment");
}
