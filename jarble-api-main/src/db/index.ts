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
// The return is typed as MySQL schema to match DbClient — all three Drizzle
// providers share identical runtime APIs, so the cast is safe and lets us
// use `db.update(tables.X)` etc. without per-call-site `as any` casts.
type ActiveTables = {
  users: typeof mysqlSchema.users;
  deployments: typeof mysqlSchema.deployments;
  runtimeCatalog: typeof mysqlSchema.runtimeCatalog;
  platformCredentials: typeof mysqlSchema.platformCredentials;
  processedWebhookEvents: typeof mysqlSchema.processedWebhookEvents;
  skillsCatalog: typeof mysqlSchema.skillsCatalog;
  deploymentSkills: typeof mysqlSchema.deploymentSkills;
  // Marketplace tables
  creatorProfiles: typeof mysqlSchema.creatorProfiles;
  marketplaceComponents: typeof mysqlSchema.marketplaceComponents;
  componentVersions: typeof mysqlSchema.componentVersions;
  componentInstalls: typeof mysqlSchema.componentInstalls;
  componentPurchases: typeof mysqlSchema.componentPurchases;
  componentReviews: typeof mysqlSchema.componentReviews;
  // Service tables
  marketplaceServices: typeof mysqlSchema.marketplaceServices;
  serviceComponents: typeof mysqlSchema.serviceComponents;
  serviceSkills: typeof mysqlSchema.serviceSkills;
  serviceInstalls: typeof mysqlSchema.serviceInstalls;
  serviceCredentials: typeof mysqlSchema.serviceCredentials;
  serviceUsage: typeof mysqlSchema.serviceUsage;
  // Proxy resilience tables
  serviceRateLimits: typeof mysqlSchema.serviceRateLimits;
  serviceCircuitBreakers: typeof mysqlSchema.serviceCircuitBreakers;
  serviceHeartbeats: typeof mysqlSchema.serviceHeartbeats;
  serviceAsyncJobs: typeof mysqlSchema.serviceAsyncJobs;
  apiKeys: typeof mysqlSchema.apiKeys;
  // Benchmark tables
  domains: typeof mysqlSchema.domains;
  deploymentRatings: typeof mysqlSchema.deploymentRatings;
  deploymentDomainScores: typeof mysqlSchema.deploymentDomainScores;
  serviceBenchmarkSamples: typeof mysqlSchema.serviceBenchmarkSamples;
  serviceBenchmarkAggregates: typeof mysqlSchema.serviceBenchmarkAggregates;
  serviceReviews: typeof mysqlSchema.serviceReviews;
};

function getActiveTables(): ActiveTables {
  if (DB_PROVIDER === "sqlite") {
    return { users: sqliteSchema.users, deployments: sqliteSchema.deployments, runtimeCatalog: sqliteSchema.runtimeCatalog, platformCredentials: sqliteSchema.platformCredentials, processedWebhookEvents: sqliteSchema.processedWebhookEvents, skillsCatalog: sqliteSchema.skillsCatalog, deploymentSkills: sqliteSchema.deploymentSkills, creatorProfiles: sqliteSchema.creatorProfiles, marketplaceComponents: sqliteSchema.marketplaceComponents, componentVersions: sqliteSchema.componentVersions, componentInstalls: sqliteSchema.componentInstalls, componentPurchases: sqliteSchema.componentPurchases, componentReviews: sqliteSchema.componentReviews, marketplaceServices: sqliteSchema.marketplaceServices, serviceComponents: sqliteSchema.serviceComponents, serviceSkills: sqliteSchema.serviceSkills, serviceInstalls: sqliteSchema.serviceInstalls, serviceCredentials: sqliteSchema.serviceCredentials, serviceUsage: sqliteSchema.serviceUsage, serviceRateLimits: sqliteSchema.serviceRateLimits, serviceCircuitBreakers: sqliteSchema.serviceCircuitBreakers, serviceHeartbeats: sqliteSchema.serviceHeartbeats, serviceAsyncJobs: sqliteSchema.serviceAsyncJobs, apiKeys: sqliteSchema.apiKeys, domains: sqliteSchema.domains, deploymentRatings: sqliteSchema.deploymentRatings, deploymentDomainScores: sqliteSchema.deploymentDomainScores, serviceBenchmarkSamples: sqliteSchema.serviceBenchmarkSamples, serviceBenchmarkAggregates: sqliteSchema.serviceBenchmarkAggregates, serviceReviews: sqliteSchema.serviceReviews } as unknown as ActiveTables;
  }
  if (DB_PROVIDER === "postgres") {
    return { users: pgSchema.users, deployments: pgSchema.deployments, runtimeCatalog: pgSchema.runtimeCatalog, platformCredentials: pgSchema.platformCredentials, processedWebhookEvents: pgSchema.processedWebhookEvents, skillsCatalog: pgSchema.skillsCatalog, deploymentSkills: pgSchema.deploymentSkills, creatorProfiles: pgSchema.creatorProfiles, marketplaceComponents: pgSchema.marketplaceComponents, componentVersions: pgSchema.componentVersions, componentInstalls: pgSchema.componentInstalls, componentPurchases: pgSchema.componentPurchases, componentReviews: pgSchema.componentReviews, marketplaceServices: pgSchema.marketplaceServices, serviceComponents: pgSchema.serviceComponents, serviceSkills: pgSchema.serviceSkills, serviceInstalls: pgSchema.serviceInstalls, serviceCredentials: pgSchema.serviceCredentials, serviceUsage: pgSchema.serviceUsage, serviceRateLimits: pgSchema.serviceRateLimits, serviceCircuitBreakers: pgSchema.serviceCircuitBreakers, serviceHeartbeats: pgSchema.serviceHeartbeats, serviceAsyncJobs: pgSchema.serviceAsyncJobs, apiKeys: pgSchema.apiKeys, domains: pgSchema.domains, deploymentRatings: pgSchema.deploymentRatings, deploymentDomainScores: pgSchema.deploymentDomainScores, serviceBenchmarkSamples: pgSchema.serviceBenchmarkSamples, serviceBenchmarkAggregates: pgSchema.serviceBenchmarkAggregates, serviceReviews: pgSchema.serviceReviews } as unknown as ActiveTables;
  }
  return { users: mysqlSchema.users, deployments: mysqlSchema.deployments, runtimeCatalog: mysqlSchema.runtimeCatalog, platformCredentials: mysqlSchema.platformCredentials, processedWebhookEvents: mysqlSchema.processedWebhookEvents, skillsCatalog: mysqlSchema.skillsCatalog, deploymentSkills: mysqlSchema.deploymentSkills, creatorProfiles: mysqlSchema.creatorProfiles, marketplaceComponents: mysqlSchema.marketplaceComponents, componentVersions: mysqlSchema.componentVersions, componentInstalls: mysqlSchema.componentInstalls, componentPurchases: mysqlSchema.componentPurchases, componentReviews: mysqlSchema.componentReviews, marketplaceServices: mysqlSchema.marketplaceServices, serviceComponents: mysqlSchema.serviceComponents, serviceSkills: mysqlSchema.serviceSkills, serviceInstalls: mysqlSchema.serviceInstalls, serviceCredentials: mysqlSchema.serviceCredentials, serviceUsage: mysqlSchema.serviceUsage, serviceRateLimits: mysqlSchema.serviceRateLimits, serviceCircuitBreakers: mysqlSchema.serviceCircuitBreakers, serviceHeartbeats: mysqlSchema.serviceHeartbeats, serviceAsyncJobs: mysqlSchema.serviceAsyncJobs, apiKeys: mysqlSchema.apiKeys, domains: mysqlSchema.domains, deploymentRatings: mysqlSchema.deploymentRatings, deploymentDomainScores: mysqlSchema.deploymentDomainScores, serviceBenchmarkSamples: mysqlSchema.serviceBenchmarkSamples, serviceBenchmarkAggregates: mysqlSchema.serviceBenchmarkAggregates, serviceReviews: mysqlSchema.serviceReviews };
}

export const tables = getActiveTables();

/**
 * Create a date value compatible with the active DB provider.
 * MySQL timestamp columns expect Date objects; SQLite text columns need ISO strings.
 * Use this when setting date values in `.set()` or `.values()` calls.
 */
export function dbDate(date: Date = new Date()): Date {
  // Cast is safe: MySQL gets Date (native), SQLite text columns receive an ISO
  // string at runtime because the SQLite table definition is text-based.
  return (DB_PROVIDER === "sqlite" ? date.toISOString() : date) as unknown as Date;
}
