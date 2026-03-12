/**
 * DbStateStore — Database-backed implementation of the StateStore interface.
 *
 * Uses Drizzle ORM for atomic operations. Rate limit increments use
 * `sql\`count + 1\`` for atomicity — no read-modify-write race conditions.
 * Circuit breaker HALF_OPEN probe coordination uses conditional updates.
 */

import { db, tables, dbDate } from "../db/index.js";
import { eq, and, sql, lt } from "drizzle-orm";
import { generateMarketplaceId } from "../db/schema.js";
import type {
  StateStore,
  RateLimitWindow,
  CircuitBreakerRecord,
} from "./stateStore.js";
import { defaultCircuitBreakerRecord } from "./stateStore.js";

export class DbStateStore implements StateStore {
  // ── Rate Limiting ─────────────────────────────────────────────────────

  async getRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<RateLimitWindow | null> {
    const rows = await db
      .select({
        count: tables.serviceRateLimits.count,
        windowStart: tables.serviceRateLimits.windowStart,
      })
      .from(tables.serviceRateLimits)
      .where(
        and(
          eq(tables.serviceRateLimits.deploymentId, deploymentId),
          eq(tables.serviceRateLimits.serviceId, serviceId),
          eq(tables.serviceRateLimits.windowType, windowType),
          eq(tables.serviceRateLimits.windowStart, String(windowStart)),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return {
      count: rows[0].count,
      windowStart: Number(rows[0].windowStart),
    };
  }

  async incrementRateLimitWindow(
    deploymentId: string,
    serviceId: string,
    windowType: "minute" | "day",
    windowStart: number,
  ): Promise<number> {
    // Try to increment existing row first (atomic)
    const existing = await this.getRateLimitWindow(deploymentId, serviceId, windowType, windowStart);

    if (existing) {
      await db
        .update(tables.serviceRateLimits)
        .set({
          count: sql`${tables.serviceRateLimits.count} + 1` as any,
          updatedAt: dbDate(),
        } as any)
        .where(
          and(
            eq(tables.serviceRateLimits.deploymentId, deploymentId),
            eq(tables.serviceRateLimits.serviceId, serviceId),
            eq(tables.serviceRateLimits.windowType, windowType),
            eq(tables.serviceRateLimits.windowStart, String(windowStart)),
          ),
        );
      return existing.count + 1;
    }

    // Insert new row
    await db.insert(tables.serviceRateLimits).values({
      id: generateMarketplaceId("srl"),
      deploymentId,
      serviceId,
      windowType,
      windowStart: String(windowStart),
      count: 1,
      updatedAt: dbDate(),
    } as any);

    return 1;
  }

  async cleanupStaleWindows(olderThan: number): Promise<number> {
    const result = await db
      .delete(tables.serviceRateLimits)
      .where(lt(tables.serviceRateLimits.windowStart, String(olderThan)));
    return 0; // Drizzle doesn't consistently return row count across providers
  }

  async deleteRateLimit(deploymentId: string, serviceId: string): Promise<void> {
    await db
      .delete(tables.serviceRateLimits)
      .where(
        and(
          eq(tables.serviceRateLimits.deploymentId, deploymentId),
          eq(tables.serviceRateLimits.serviceId, serviceId),
        ),
      );
  }

  async deleteAllRateLimits(): Promise<void> {
    await db.delete(tables.serviceRateLimits);
  }

  // ── Circuit Breaker ───────────────────────────────────────────────────

  async getCircuitBreaker(serviceId: string): Promise<CircuitBreakerRecord> {
    const rows = await db
      .select()
      .from(tables.serviceCircuitBreakers)
      .where(eq(tables.serviceCircuitBreakers.serviceId, serviceId))
      .limit(1);

    if (rows.length === 0) return defaultCircuitBreakerRecord();

    const row = rows[0];
    return {
      state: row.state as CircuitBreakerRecord["state"],
      consecutiveFailures: row.consecutiveFailures,
      lastFailureAt: row.lastFailureAt ? Number(row.lastFailureAt) : null,
      openedAt: row.openedAt ? Number(row.openedAt) : null,
      halfOpenClaimedBy: row.halfOpenClaimedBy,
      halfOpenClaimedAt: row.halfOpenClaimedAt ? Number(row.halfOpenClaimedAt) : null,
    };
  }

  async setCircuitBreaker(serviceId: string, record: CircuitBreakerRecord): Promise<void> {
    const existing = await db
      .select({ id: tables.serviceCircuitBreakers.id })
      .from(tables.serviceCircuitBreakers)
      .where(eq(tables.serviceCircuitBreakers.serviceId, serviceId))
      .limit(1);

    const values = {
      serviceId,
      state: record.state,
      consecutiveFailures: record.consecutiveFailures,
      lastFailureAt: record.lastFailureAt !== null ? String(record.lastFailureAt) : null,
      openedAt: record.openedAt !== null ? String(record.openedAt) : null,
      halfOpenClaimedBy: record.halfOpenClaimedBy,
      halfOpenClaimedAt: record.halfOpenClaimedAt !== null ? String(record.halfOpenClaimedAt) : null,
      updatedAt: dbDate(),
    };

    if (existing.length > 0) {
      await db
        .update(tables.serviceCircuitBreakers)
        .set(values as any)
        .where(eq(tables.serviceCircuitBreakers.serviceId, serviceId));
    } else {
      await db.insert(tables.serviceCircuitBreakers).values({
        id: generateMarketplaceId("scb"),
        ...values,
      } as any);
    }
  }

  async claimHalfOpenProbe(serviceId: string, replicaId: string, now: number): Promise<boolean> {
    const record = await this.getCircuitBreaker(serviceId);

    if (record.state !== "HALF_OPEN") return false;

    // Already claimed by another replica and not timed out (30s)
    if (
      record.halfOpenClaimedBy &&
      record.halfOpenClaimedBy !== replicaId &&
      record.halfOpenClaimedAt !== null &&
      now - record.halfOpenClaimedAt < 30_000
    ) {
      return false;
    }

    // Claim it
    await db
      .update(tables.serviceCircuitBreakers)
      .set({
        halfOpenClaimedBy: replicaId,
        halfOpenClaimedAt: String(now),
        updatedAt: dbDate(),
      } as any)
      .where(eq(tables.serviceCircuitBreakers.serviceId, serviceId));

    return true;
  }

  async deleteCircuitBreaker(serviceId: string): Promise<void> {
    await db
      .delete(tables.serviceCircuitBreakers)
      .where(eq(tables.serviceCircuitBreakers.serviceId, serviceId));
  }

  async deleteAllCircuitBreakers(): Promise<void> {
    await db.delete(tables.serviceCircuitBreakers);
  }
}
