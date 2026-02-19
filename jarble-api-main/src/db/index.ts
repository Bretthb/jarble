import { drizzle as drizzleMysql, MySql2Database } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import pg from "pg";
import * as mysqlSchema from "./schema.js";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";
import path from "path";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

// Resolve provider: legacy USE_SQLITE takes precedence, then DB_PROVIDER
const resolveProvider = (): "mysql" | "postgres" | "sqlite" => {
  if (env.USE_SQLITE === "true" || env.USE_SQLITE === "1") return "sqlite";
  return env.DB_PROVIDER;
};

export const DB_PROVIDER = resolveProvider();
export const USE_SQLITE = DB_PROVIDER === "sqlite";

// Use MySql2Database as the canonical type — all three Drizzle clients share
// the same relational query API at runtime, so the cast is safe. This avoids
// TypeScript union-type issues where method signatures become incompatible.
export type DbClient = MySql2Database<typeof mysqlSchema>;

let db: DbClient;
let sqliteRaw: Database.Database | null = null;

if (DB_PROVIDER === "sqlite") {
  // File-based SQLite for local testing (persists across server restarts)
  const dbPath = path.resolve("local.db");
  sqliteRaw = new Database(dbPath);
  const sqliteDb = drizzleSqlite(sqliteRaw, { schema: sqliteSchema });
  db = sqliteDb as unknown as DbClient;
  logger.info({ path: dbPath }, "Using file-based SQLite database");
} else if (DB_PROVIDER === "postgres") {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Postgres");
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const pgDb = drizzlePg(pool, { schema: pgSchema });
  db = pgDb as unknown as DbClient;
  logger.info("Using PostgreSQL database");
} else {
  // Default: MySQL
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when not using SQLite");
  }
  const pool = mysql.createPool(env.DATABASE_URL);
  db = drizzleMysql(pool, { schema: mysqlSchema, mode: "default" });
  logger.info("Using MySQL database");
}

export { db, sqliteRaw };
export { mysqlSchema, sqliteSchema, pgSchema };
// Keep backward-compatible "schema" export pointing to MySQL
export { mysqlSchema as schema };

// For SQLite init
export const sqliteDb = DB_PROVIDER === "sqlite"
  ? (db as unknown as ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>)
  : null;

// Export the active schema tables for use in queries.
// Each provider uses its own table definitions to ensure correct SQL generation.
function getActiveTables() {
  if (DB_PROVIDER === "sqlite") {
    return { users: sqliteSchema.users, deployments: sqliteSchema.deployments, runtimeCatalog: sqliteSchema.runtimeCatalog, platformCredentials: sqliteSchema.platformCredentials, processedWebhookEvents: sqliteSchema.processedWebhookEvents, skillsCatalog: sqliteSchema.skillsCatalog, deploymentSkills: sqliteSchema.deploymentSkills };
  }
  if (DB_PROVIDER === "postgres") {
    return { users: pgSchema.users, deployments: pgSchema.deployments, runtimeCatalog: pgSchema.runtimeCatalog, platformCredentials: pgSchema.platformCredentials, processedWebhookEvents: pgSchema.processedWebhookEvents, skillsCatalog: pgSchema.skillsCatalog, deploymentSkills: pgSchema.deploymentSkills };
  }
  return { users: mysqlSchema.users, deployments: mysqlSchema.deployments, runtimeCatalog: mysqlSchema.runtimeCatalog, platformCredentials: mysqlSchema.platformCredentials, processedWebhookEvents: mysqlSchema.processedWebhookEvents, skillsCatalog: mysqlSchema.skillsCatalog, deploymentSkills: mysqlSchema.deploymentSkills };
}

export const tables = getActiveTables();
