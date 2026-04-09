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
  creatorProfiles: pgSchema.creatorProfiles,
  marketplaceComponents: pgSchema.marketplaceComponents,
  componentVersions: pgSchema.componentVersions,
  componentInstalls: pgSchema.componentInstalls,
  componentPurchases: pgSchema.componentPurchases,
  componentReviews: pgSchema.componentReviews,
  marketplaceServices: pgSchema.marketplaceServices,
  serviceComponents: pgSchema.serviceComponents,
  serviceSkills: pgSchema.serviceSkills,
  serviceInstalls: pgSchema.serviceInstalls,
  serviceCredentials: pgSchema.serviceCredentials,
  serviceUsage: pgSchema.serviceUsage,
  serviceRateLimits: pgSchema.serviceRateLimits,
  serviceCircuitBreakers: pgSchema.serviceCircuitBreakers,
  serviceHeartbeats: pgSchema.serviceHeartbeats,
  serviceAsyncJobs: pgSchema.serviceAsyncJobs,
  apiKeys: pgSchema.apiKeys,
  domains: pgSchema.domains,
  deploymentRatings: pgSchema.deploymentRatings,
  deploymentDomainScores: pgSchema.deploymentDomainScores,
  serviceBenchmarkSamples: pgSchema.serviceBenchmarkSamples,
  serviceBenchmarkAggregates: pgSchema.serviceBenchmarkAggregates,
  serviceReviews: pgSchema.serviceReviews,
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
};

/**
 * Create a date value for Postgres timestamp columns.
 * Always returns a Date object.
 */
export function dbDate(date: Date = new Date()): Date {
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
