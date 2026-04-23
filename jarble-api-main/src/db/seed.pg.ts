/**
 * Seed PostgreSQL with runtime catalog and skills.
 * Called by entrypoint.sh after migrations, before the API server starts.
 * Idempotent - skips if data already exists.
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
        description: "AI agent with web chat, conversation memory, MCP tools, and multi-platform support",
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
        // JAR-123 — updated with the actual shape from upstream. Rust
        // gateway binary (~3.4 MB) with 22+ AI providers, SQLite memory,
        // bundled React admin dashboard. No skills or system-prompt;
        // lightweight / cost-optimized tier.
        description: "Lightweight Rust runtime — 22+ AI providers, SQLite memory, bundled admin dashboard. Ideal for cost-sensitive deployments that don't need OpenClaw's skills marketplace.",
        category: "bot",
        dockerImage: "ghcr.io/jarble-ai/zeroclaw:latest",
        cpuLimit: "1.0",
        memoryMb: 1024,
        storageMb: 20,
        monthlyPriceCents: 1490,
      },
      {
        // JAR-101 — dummy "echo" runtime used as the plug-and-play
        // validation. Deliberately trivial (no LLM, no platforms, no
        // system prompt). The handler lives at runtimes/handlers/echo.ts;
        // the actual echo server image is a follow-up. Hidden-by-default
        // in the wizard via a non-zero isActive could be added later if
        // needed; for now leaving active so it is visible for QA.
        slug: "echo",
        name: "Echo (dev)",
        description: "No-op echo runtime — for platform validation only. Accepts a message and streams back a fixed response. Not intended for end-user deployments.",
        category: "bot",
        dockerImage: "ghcr.io/jarble-ai/echo:latest",
        cpuLimit: "0.25",
        memoryMb: 128,
        storageMb: 5,
        monthlyPriceCents: 0,
      },
    ]);
    console.log("[seed] Seeded 3 runtimes.");
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
