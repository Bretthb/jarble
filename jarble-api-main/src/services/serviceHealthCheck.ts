/**
 * Service Health Check Service
 *
 * Periodically pings the health endpoints of remote/hybrid services
 * and updates their remoteHealth + remoteLastCheck fields in the DB.
 *
 * Health statuses:
 *   - "healthy"  - endpoint returned HTTP 200 within 10s
 *   - "degraded" - endpoint returned a non-200 response, or heartbeat 2x late
 *   - "offline"  - request timed out or failed entirely, or heartbeat 3x late
 *
 * Supports push-based heartbeats: services with a recent heartbeat skip
 * the pull-based check. Stale heartbeats trigger degraded/offline status.
 */

import { db, tables, dbDate } from "../db/index.js";
import { eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
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
  safeFireAndForget(checkAllServices(), { operation: "checkAllServices" });
  healthCheckInterval = setInterval(() => safeFireAndForget(checkAllServices(), { operation: "checkAllServices" }), intervalMs);
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
    // Check stale heartbeats first
    await checkStaleHeartbeats();

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

/**
 * Check for services with stale heartbeats and update their health status.
 *
 * - 2x interval without heartbeat → mark `degraded`
 * - 3x interval without heartbeat → mark `offline`
 */
async function checkStaleHeartbeats(): Promise<void> {
  try {
    const heartbeats = await db
      .select()
      .from(tables.serviceHeartbeats);

    const now = Date.now();

    for (const hb of heartbeats) {
      const lastBeat = new Date(hb.lastHeartbeatAt as any).getTime();
      const intervalMs = hb.heartbeatIntervalMs;
      const elapsed = now - lastBeat;

      if (elapsed > intervalMs * 3) {
        // 3x interval - offline
        await db
          .update(tables.marketplaceServices)
          .set({
            remoteHealth: "offline",
            remoteLastCheck: dbDate(),
          } as any)
          .where(eq(tables.marketplaceServices.id, hb.serviceId));

        logger.warn(
          { serviceId: hb.serviceId, elapsed, threshold: intervalMs * 3 },
          "Service heartbeat stale: marking offline (3x interval exceeded)",
        );
      } else if (elapsed > intervalMs * 2) {
        // 2x interval - degraded
        await db
          .update(tables.marketplaceServices)
          .set({
            remoteHealth: "degraded",
            remoteLastCheck: dbDate(),
          } as any)
          .where(eq(tables.marketplaceServices.id, hb.serviceId));

        logger.warn(
          { serviceId: hb.serviceId, elapsed, threshold: intervalMs * 2 },
          "Service heartbeat stale: marking degraded (2x interval exceeded)",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale heartbeat check failed");
  }
}

async function checkServiceHealth(svc: any): Promise<void> {
  // Skip pull-based check for services with a recent heartbeat
  try {
    const heartbeats = await db
      .select()
      .from(tables.serviceHeartbeats)
      .where(eq(tables.serviceHeartbeats.serviceId, svc.id))
      .limit(1);

    if (heartbeats.length > 0) {
      const hb = heartbeats[0];
      const lastBeat = new Date(hb.lastHeartbeatAt as any).getTime();
      const intervalMs = hb.heartbeatIntervalMs;

      // If last heartbeat is within the interval, skip pull-based check
      if (Date.now() - lastBeat < intervalMs) {
        return;
      }
    }
  } catch {
    // If heartbeat check fails, fall through to pull-based check
  }

  let healthUrl: string | undefined;

  try {
    if (svc.remoteApiConfig) {
      const config = JSON.parse(svc.remoteApiConfig);
      healthUrl = config.healthEndpoint || `${config.endpoint}/health`;
    } else if (svc.remoteApiEndpoint) {
      healthUrl = `${svc.remoteApiEndpoint}/health`;
    }
  } catch {
    // Invalid config JSON - skip
  }

  if (!healthUrl) {
    return; // No endpoint to check
  }

  // Skip the network call if the circuit breaker is open - the service is
  // already known to be down, so hitting it again is wasteful. Just mark it
  // offline and let the circuit breaker recovery timeout handle re-probing.
  const circuit = await canRequest(svc.id);
  if (!circuit.allowed) {
    logger.info(
      { serviceId: svc.id, healthUrl },
      "Service health check: skipping - circuit breaker is OPEN",
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
      "Service health check: blocked SSRF - URL points to private/internal network",
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
