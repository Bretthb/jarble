import { db, tables, DB_PROVIDER } from "../db/index.js";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger.js";

const { processedWebhookEvents } = tables;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete processedWebhookEvents older than 30 days.
 * Prevents the idempotency table from growing indefinitely.
 */
export async function cleanupOldWebhookEvents(): Promise<number> {
  try {
    const threshold = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    // All three providers store processedAt as text (ISO string) or timestamp.
    // Drizzle's sql`` template works across all three when comparing as strings.
    const result = await db.delete(processedWebhookEvents)
      .where(sql`${processedWebhookEvents.processedAt} < ${threshold}`);

    const deletedRows =
      (result as any)?.rowsAffected ??
      (result as any)?.changes ??
      (result as any)?.[0]?.affectedRows ??
      0;

    if (deletedRows > 0) {
      logger.info({ deletedRows, threshold, provider: DB_PROVIDER }, "webhookCleanup: purged old webhook events");
    } else {
      logger.debug("webhookCleanup: no old webhook events to purge");
    }

    return deletedRows;
  } catch (err) {
    logger.error({ err }, "webhookCleanup: failed to purge old webhook events");
    return 0;
  }
}

/**
 * Start periodic webhook event cleanup (every 24 hours).
 */
export function startWebhookCleanup(intervalMs: number = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  logger.info({ intervalMs }, "webhookCleanup: starting periodic webhook event cleanup");
  // Run once immediately on startup
  void cleanupOldWebhookEvents();
  return setInterval(() => void cleanupOldWebhookEvents(), intervalMs);
}
