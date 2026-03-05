/**
 * Package Health Check Service
 *
 * Periodically pings the health endpoints of remote/hybrid packages
 * and updates their remoteHealth + remoteLastCheck fields in the DB.
 *
 * Health statuses:
 *   - "healthy"  — endpoint returned HTTP 200 within 10s
 *   - "degraded" — endpoint returned a non-200 response
 *   - "offline"  — request timed out or failed entirely
 */

import { db, tables, dbDate } from "../db/index.js";
import { eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger.js";

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic package health check service.
 * Runs immediately on startup, then every `intervalMs` (default 5 minutes).
 */
export function startPackageHealthCheck(intervalMs = 5 * 60 * 1000): void {
  if (healthCheckInterval) return;

  logger.info({ intervalMs }, "Starting package health check service");

  // Run immediately, then on interval
  void checkAllPackages();
  healthCheckInterval = setInterval(() => void checkAllPackages(), intervalMs);
}

/**
 * Stop the periodic health check service.
 */
export function stopPackageHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

async function checkAllPackages(): Promise<void> {
  try {
    const packages = await db.query.marketplacePackages.findMany({
      where: sql`${tables.marketplacePackages.status} = 'published' AND ${tables.marketplacePackages.hostingModel} IN ('remote', 'hybrid')`,
    });

    for (const pkg of packages) {
      await checkPackageHealth(pkg);
    }

    if (packages.length > 0) {
      logger.info({ count: packages.length }, "Package health check completed");
    }
  } catch (err) {
    logger.error({ err }, "Package health check failed");
  }
}

async function checkPackageHealth(pkg: any): Promise<void> {
  let healthUrl: string | undefined;

  try {
    if (pkg.remoteApiConfig) {
      const config = JSON.parse(pkg.remoteApiConfig);
      healthUrl = config.healthEndpoint || `${config.endpoint}/health`;
    } else if (pkg.remoteApiEndpoint) {
      healthUrl = `${pkg.remoteApiEndpoint}/health`;
    }
  } catch {
    // Invalid config JSON — skip
  }

  if (!healthUrl) {
    return; // No endpoint to check
  }

  let health: "healthy" | "degraded" | "offline" = "offline";

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    health = response.ok ? "healthy" : "degraded";
  } catch {
    health = "offline";
  }

  await db
    .update(tables.marketplacePackages)
    .set({
      remoteHealth: health,
      remoteLastCheck: dbDate(),
    } as any)
    .where(eq(tables.marketplacePackages.id, pkg.id));

  if (health !== "healthy") {
    logger.warn(
      { packageId: pkg.id, health, healthUrl },
      "Package health check: not healthy",
    );
  }
}
