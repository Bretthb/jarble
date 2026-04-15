import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as pgSchema from "./schema.pg.js";
import { logger } from "../utils/logger.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pgDb = drizzle(pool, { schema: pgSchema });
logger.info("Using PostgreSQL database (Neon)");

export const db = pgDb;
export type DbClient = typeof pgDb;

// Re-export the pg schema for backward compatibility
export { pgSchema };
export { pgSchema as schema };

// Export all tables directly from the pg schema
export const tables = {
  users: pgSchema.users,
  deployments: pgSchema.deployments,
  runtimeCatalog: pgSchema.runtimeCatalog,
  platformCredentials: pgSchema.platformCredentials,
  deploymentSecrets: pgSchema.deploymentSecrets,
  processedWebhookEvents: pgSchema.processedWebhookEvents,
  skillsCatalog: pgSchema.skillsCatalog,
  deploymentSkills: pgSchema.deploymentSkills,
  apiKeys: pgSchema.apiKeys,
  personaTemplates: pgSchema.personaTemplates,
  agentCalls: pgSchema.agentCalls,
  chatSessions: pgSchema.chatSessions,
  chatMessages: pgSchema.chatMessages,
  auditLogs: pgSchema.auditLogs,
  betaSignups: pgSchema.betaSignups,
  orchestrationFlows: pgSchema.orchestrationFlows,
  flowExecutions: pgSchema.flowExecutions,
  deploymentSubagents: pgSchema.deploymentSubagents,
  flowDeploymentMemberships: pgSchema.flowDeploymentMemberships,
  organizations: pgSchema.organizations,
  orgMembers: pgSchema.orgMembers,
  orgInvites: pgSchema.orgInvites,
  flowChatSessions: pgSchema.flowChatSessions,
  flowChatMessages: pgSchema.flowChatMessages,
  promoCodes: pgSchema.promoCodes,
  promoRedemptions: pgSchema.promoRedemptions,
  teamFiles: pgSchema.teamFiles,
  announcements: pgSchema.announcements,
  managedNodes: pgSchema.managedNodes,
  lifecycleJobs: pgSchema.lifecycleJobs,
};

/**
 * Create a date value compatible with both Postgres timestamp columns (Date)
 * and SQLite text columns (ISO string) used in the test mirror.
 * Returns a Date for Postgres, ISO string for SQLite.
 */
export function dbDate(date: Date = new Date()): any {
  // In test environment, SQLite text columns need ISO strings.
  // In production (Postgres), timestamp columns need Date objects.
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return date.toISOString();
  }
  return date;
}

/**
 * Extract the number of affected rows from a Drizzle update/delete result.
 * Postgres returns `{ rowCount }` via node-postgres.
 */
export function getRowsAffected(result: any): number {
  if (result?.rowCount != null) return result.rowCount;
  if (result?.rowsAffected != null) return result.rowsAffected;
  return 0;
}
