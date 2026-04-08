/**
 * Custom Postgres migrator for Jarble (replaces drizzle-kit migrate).
 *
 * Why custom: the prod DB's `__drizzle_migrations` table only contains a
 * single `"schema-pushed-directly"` marker (from an old `drizzle-kit push`).
 * Drizzle's standard migrator sees that marker and short-circuits — it never
 * applies any of the numbered .sql files in `drizzle-pg/`. As a result every
 * new schema change had to be applied by hand. JAR-50 hit this directly.
 *
 * What this script does:
 *   1. Connect to DATABASE_URL.
 *   2. Ensure a `_jarble_applied_migrations` tracking table exists. This is
 *      separate from drizzle's `__drizzle_migrations` so we don't fight with
 *      whatever marker that table has.
 *   3. On first run, if the tracking table is EMPTY AND drizzle's marker is
 *      present, BACKFILL the tracking table with every current .sql file in
 *      `drizzle-pg/`. The schema is already at that state — we just need the
 *      tracker to know it. Future runs will only apply newer files.
 *   4. For each .sql file in `drizzle-pg/`, if it's not in the tracking table,
 *      execute it (each `--> statement-breakpoint` separates statements) and
 *      record it as applied.
 *
 * Called by entrypoint / Dockerfile CMD before the API server starts.
 * Safe to run on every pod startup — already-applied migrations are skipped.
 *
 * If a migration fails, the process exits non-zero so the pod crashes
 * before serving traffic. K8s will then restart it (and the failed migration
 * stays unrecorded so it'll retry on the next start).
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

// In the Docker image, migrations are at /app/drizzle-pg/.
// Locally (via tsx), they're at ./drizzle-pg/ relative to the API root.
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? "./drizzle-pg";

const TRACKING_TABLE = "_jarble_applied_migrations";

async function main() {
  console.log(`[migrate] Connecting to PostgreSQL...`);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // 1. Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
        filename varchar(255) PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      );
    `);

    // 2. Get list of migration files (sorted)
    const allFiles = readdirSync(migrationsFolder)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (allFiles.length === 0) {
      console.log("[migrate] No migration files found, nothing to do.");
      return;
    }

    // 3. Get already-applied migrations from tracking table
    const appliedRes = await client.query(`SELECT filename FROM ${TRACKING_TABLE}`);
    const appliedSet = new Set<string>(appliedRes.rows.map((r) => r.filename));

    // 4. Backfill on first run: if tracking table is empty AND the legacy
    //    drizzle.__drizzle_migrations table exists with the schema-pushed
    //    marker, assume the schema is already at the state of all .sql files
    //    and mark them all applied.
    if (appliedSet.size === 0) {
      let legacyMarker = false;
      try {
        const legacy = await client.query(
          `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'schema-pushed-directly' LIMIT 1`,
        );
        legacyMarker = legacy.rowCount !== null && legacy.rowCount > 0;
      } catch {
        // Legacy table may not exist on a brand-new DB. That's fine.
      }

      if (legacyMarker) {
        console.log(
          `[migrate] First run with legacy schema-pushed marker — backfilling ${allFiles.length} migration files as already applied.`,
        );
        for (const f of allFiles) {
          await client.query(`INSERT INTO ${TRACKING_TABLE} (filename) VALUES ($1)`, [f]);
          appliedSet.add(f);
        }
      } else {
        console.log(
          "[migrate] Empty tracking table and no legacy marker — assuming a fresh database. Will apply all migrations.",
        );
      }
    }

    // 5. Apply any unapplied migrations in order
    const pending = allFiles.filter((f) => !appliedSet.has(f));
    if (pending.length === 0) {
      console.log(`[migrate] Up to date (${allFiles.length} files tracked, 0 pending).`);
      return;
    }

    console.log(`[migrate] Applying ${pending.length} pending migration(s)...`);
    for (const filename of pending) {
      const filePath = join(migrationsFolder, filename);
      const sql = readFileSync(filePath, "utf8");

      console.log(`[migrate]   → ${filename}`);

      // Drizzle uses `--> statement-breakpoint` to separate statements; some
      // statements (e.g. CREATE INDEX) cannot run inside an explicit
      // transaction block. Run statements one at a time, ignoring the
      // breakpoint marker.
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.match(/^--/));

      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (err: any) {
          // Idempotency: ignore "already exists" errors so a partially-
          // applied migration can be retried safely. Any other failure
          // bubbles up and crashes the process.
          const msg = String(err?.message || err);
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column") ||
            msg.includes("does not exist") // for IF EXISTS drops re-run
          ) {
            console.warn(`[migrate]     skip (already applied): ${msg.split("\n")[0]}`);
          } else {
            throw err;
          }
        }
      }

      await client.query(`INSERT INTO ${TRACKING_TABLE} (filename) VALUES ($1)`, [filename]);
      console.log(`[migrate]     ✓`);
    }

    console.log(`[migrate] All migrations applied (${pending.length} new, ${appliedSet.size + pending.length} total).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
});
