import { drizzle as drizzleMysql, MySql2Database } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import * as sqliteSchema from "./schema.sqlite.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export const USE_SQLITE = env.USE_SQLITE === "true" || env.USE_SQLITE === "1";

// Type is always MySQL for consistency - SQLite is a dev-only fallback
export type DbClient = MySql2Database<typeof schema>;

let db: DbClient;
let sqliteDb: BetterSQLite3Database<typeof sqliteSchema> | null = null;
let sqliteRaw: Database.Database | null = null;

if (USE_SQLITE) {
  // In-memory SQLite for local testing
  sqliteRaw = new Database(":memory:");
  sqliteDb = drizzleSqlite(sqliteRaw, { schema: sqliteSchema });
  db = sqliteDb as unknown as DbClient;
  logger.info("Using in-memory SQLite database");
} else {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when not using SQLite");
  }
  const pool = mysql.createPool(env.DATABASE_URL);
  db = drizzleMysql(pool, { schema, mode: "default" });
  logger.info("Using MySQL database");
}

export { db, sqliteDb, sqliteRaw };
export { schema, sqliteSchema };

// Export the active schema tables for use in queries.
// When using SQLite, we must use the SQLite table definitions
// to avoid MySQL-specific SQL generation (e.g., `now()`).
export const tables = USE_SQLITE
  ? { users: sqliteSchema.users, bots: sqliteSchema.bots, tiers: sqliteSchema.tiers }
  : { users: schema.users, bots: schema.bots, tiers: schema.tiers };
