import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: "./drizzle-pg" });
  console.log("[migrate] Migrations applied successfully");

  await pool.end();
}

runMigrations().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
