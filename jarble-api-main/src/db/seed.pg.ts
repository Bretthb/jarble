import pg from "pg";

const SEED_SQL = `
INSERT INTO runtime_catalog (slug, name, description, category, docker_image, cpu_limit, memory_mb, storage_mb, monthly_price_cents)
VALUES
  ('openclaw', 'OpenClaw', 'AI-powered WhatsApp assistant with conversation memory and tool use', 'bot', 'ghcr.io/jarble-ai/openclaw:latest', '2.0', 2048, 30, 0),
  ('zeroclaw', 'ZeroClaw', 'Lightweight zero-config chatbot for quick deployment', 'bot', 'ghcr.io/jarble-ai/zeroclaw:latest', '2.0', 2048, 30, 0)
ON CONFLICT (slug) DO NOTHING;
`;

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[seed] DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  await pool.query(SEED_SQL);
  console.log("[seed] Runtime catalog seeded");
  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
