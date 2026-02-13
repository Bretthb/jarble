/**
 * Initialize in-memory SQLite database (creates tables + seeds)
 * Called at startup when USE_SQLITE=true
 */
import { sqliteDb, sqliteRaw, sqliteSchema, USE_SQLITE } from "./index.js";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

// SQL to create tables (mirrors schema.sqlite.ts)
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth0_id TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price TEXT NOT NULL,
    credits_per_month INTEGER NOT NULL,
    features TEXT,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    template TEXT,
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

  // Create tiers
  const tiers = [
    { name: "Free", description: "Get started for free", price: "0", creditsPerMonth: 1000, features: JSON.stringify(["1 bot", "Basic templates", "Community support"]) },
    { name: "Pro", description: "For serious bot builders", price: "19", creditsPerMonth: 10000, features: JSON.stringify(["5 bots", "All templates", "Priority support", "Custom domains"]) },
    { name: "Agency", description: "For teams and agencies", price: "99", creditsPerMonth: 100000, features: JSON.stringify(["Unlimited bots", "White-label", "API access", "Dedicated support"]) },
  ];

  for (const tier of tiers) {
    await sqliteDb.insert(sqliteSchema.tiers).values(tier);
  }

  // Create test user
  const userId = nanoid();
  await sqliteDb.insert(sqliteSchema.users).values({
    id: userId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: "auth0|test123",
    stripeCustomerId: "cus_test123",
  });

  // Create test bot
  await sqliteDb.insert(sqliteSchema.bots).values({
    id: nanoid(),
    userId,
    name: "My First Bot",
    description: "A test bot for development",
    template: "assistant",
    status: "running",
    tierId: 1,
  });

  logger.info("Seeded: 3 tiers, 1 user, 1 bot");
}
