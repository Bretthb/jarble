/**
 * Service Health Check Service
 *
 * Periodically pings the health endpoints of remote/hybrid services
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
import { validateExternalUrl } from "../utils/urlValidation.js";
import { canRequest } from "./circuitBreaker.js";

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic service health check service.
 * Runs immediately on startup, then every `intervalMs` (default 5 minutes).
 */
export function startServiceHealthCheck(intervalMs = 5 * 60 * 1000): void {
  if (healthCheckInterval) return;

  logger.info({ intervalMs }, "Starting service health check service");

  // Run immediately, then on interval
  void checkAllServices();
  healthCheckInterval = setInterval(() => void checkAllServices(), intervalMs);
}

/**
 * Stop the periodic health check service.
 */
export function stopServiceHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

async function checkAllServices(): Promise<void> {
  try {
    const services = await db.query.marketplaceServices.findMany({
      where: sql`${tables.marketplaceServices.status} = 'published' AND ${tables.marketplaceServices.hostingModel} IN ('remote', 'hybrid')`,
    });

    for (const svc of services) {
      await checkServiceHealth(svc);
    }

    if (services.length > 0) {
      logger.info({ count: services.length }, "Service health check completed");
    }
  } catch (err) {
    logger.error({ err }, "Service health check failed");
  }
}

async function checkServiceHealth(svc: any): Promise<void> {
  let healthUrl: string | undefined;

  try {
    if (svc.remoteApiConfig) {
      const config = JSON.parse(svc.remoteApiConfig);
      healthUrl = config.healthEndpoint || `${config.endpoint}/health`;
    } else if (svc.remoteApiEndpoint) {
      healthUrl = `${svc.remoteApiEndpoint}/health`;
    }
  } catch {
    // Invalid config JSON — skip
  }

  if (!healthUrl) {
    return; // No endpoint to check
  }

  // Skip the network call if the circuit breaker is open — the service is
  // already known to be down, so hitting it again is wasteful. Just mark it
  // offline and let the circuit breaker recovery timeout handle re-probing.
  const circuit = canRequest(svc.id);
  if (!circuit.allowed) {
    logger.info(
      { serviceId: svc.id, healthUrl },
      "Service health check: skipping — circuit breaker is OPEN",
    );

    await db
      .update(tables.marketplaceServices)
      .set({
        remoteHealth: "offline",
        remoteLastCheck: dbDate(),
      } as any)
      .where(eq(tables.marketplaceServices.id, svc.id));
    return;
  }

  // SSRF protection: validate the health URL before making the request
  if (!validateExternalUrl(healthUrl)) {
    logger.warn(
      { serviceId: svc.id, healthUrl },
      "Service health check: blocked SSRF — URL points to private/internal network",
    );
    return;
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
    .update(tables.marketplaceServices)
    .set({
      remoteHealth: health,
      remoteLastCheck: dbDate(),
    } as any)
    .where(eq(tables.marketplaceServices.id, svc.id));

  if (health !== "healthy") {
    logger.warn(
      { serviceId: svc.id, health, healthUrl },
      "Service health check: not healthy",
    );
  }
}
