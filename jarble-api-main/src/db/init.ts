/**
 * Database initialization — Postgres only.
 * Seeding is handled by seed.pg.ts (run separately via entrypoint.sh).
 * This function is a no-op kept for backward compatibility with the startup sequence.
 */
import { logger } from "../utils/logger.js";

export async function initDatabase() {
  // Postgres schema is managed via Drizzle migrations (db:push / db:migrate).
  // Seed data is handled by seed.pg.ts.
  logger.info("Database: PostgreSQL (Neon) — schema managed via Drizzle migrations");
}
