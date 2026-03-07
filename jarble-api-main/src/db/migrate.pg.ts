/**
 * Run Drizzle migrations against PostgreSQL (Neon).
 * Called by entrypoint.sh before the API server starts.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  console.log("[migrate] Connecting to PostgreSQL...");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const db = drizzle(client);

  // In the Docker image, migrations are at /app/drizzle-pg/
  // Locally (via tsx), they're at ./drizzle-pg/
  const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? "./drizzle-pg";

  console.log(`[migrate] Running migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });

  console.log("[migrate] Migrations complete.");
  await client.end();
}

main().catch((err) => {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
});
