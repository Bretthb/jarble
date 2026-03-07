/**
 * Seed PostgreSQL with runtime catalog and skills.
 * Called by entrypoint.sh after migrations, before the API server starts.
 * Idempotent — skips if data already exists.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.pg.js";
import { nanoid } from "nanoid";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed] DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  console.log("[seed] Connecting to PostgreSQL...");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const db = drizzle(client, { schema });

  // ── Runtime Catalog ──────────────────────────────────────────────────
  const existingRuntime = await db.query.runtimeCatalog.findFirst();
  if (existingRuntime) {
    console.log("[seed] Runtime catalog already seeded, skipping.");
  } else {
    console.log("[seed] Seeding runtime catalog...");
    await db.insert(schema.runtimeCatalog).values([
      {
        slug: "openclaw",
        name: "OpenClaw",
        description: "AI-powered WhatsApp assistant with conversation memory and tool use",
        category: "bot",
        dockerImage: "ghcr.io/jarble-ai/openclaw:latest",
        cpuLimit: "2.0",
        memoryMb: 2048,
        storageMb: 30,
        monthlyPriceCents: 2740,
      },
      {
        slug: "zeroclaw",
        name: "ZeroClaw",
        description: "Lightweight zero-config chatbot for quick deployment",
        category: "bot",
        dockerImage: "ghcr.io/jarble-ai/zeroclaw:latest",
        cpuLimit: "2.0",
        memoryMb: 2048,
        storageMb: 30,
        monthlyPriceCents: 2740,
      },
    ]);
    console.log("[seed] Seeded 2 runtimes.");
  }

  // ── Skills Catalog ──────────────────────────────────────────────────
  const existingSkill = await db.query.skillsCatalog.findFirst();
  if (existingSkill) {
    console.log("[seed] Skills catalog already seeded, skipping.");
  } else {
    console.log("[seed] Seeding skills catalog...");
    await db.insert(schema.skillsCatalog).values([
      { id: nanoid(), name: "Web Search", description: "Search the web for real-time information", runtime: "openclaw", config: JSON.stringify({ tool: "web_search", params: { maxResults: 5 } }), author: "Jarble", isOfficial: true },
      { id: nanoid(), name: "Weather", description: "Get current weather for any location", runtime: "openclaw", config: JSON.stringify({ tool: "weather", params: { units: "metric" } }), author: "Jarble", isOfficial: true },
      { id: nanoid(), name: "Calculator", description: "Perform math calculations", runtime: "openclaw", config: JSON.stringify({ tool: "calculator" }), author: "Jarble", isOfficial: true },
      { id: nanoid(), name: "Wikipedia", description: "Look up information from Wikipedia", runtime: "openclaw", config: JSON.stringify({ tool: "wikipedia", params: { language: "en" } }), author: "Jarble", isOfficial: true },
      { id: nanoid(), name: "Translator", description: "Translate text between languages", runtime: "openclaw", config: JSON.stringify({ tool: "translator" }), author: "Jarble", isOfficial: true },
    ]);
    console.log("[seed] Seeded 5 skills.");
  }

  console.log("[seed] Done.");
  await client.end();
}

main().catch((err) => {
  console.error("[seed] Seed failed:", err);
  process.exit(1);
});
