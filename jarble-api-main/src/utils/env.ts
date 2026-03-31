import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3001").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  // Database provider: "mysql" | "postgres" | "sqlite" (in-memory, dev only)
  DB_PROVIDER: z.enum(["mysql", "postgres", "sqlite"]).default("mysql"),
  USE_SQLITE: z.string().optional(), // Legacy - same as DB_PROVIDER=sqlite
  DATABASE_URL: z.string().optional(), // Required when not using SQLite
  
  // Auth0 - optional for testing, required for production
  AUTH0_DOMAIN: z.string().default("test.auth0.com"),
  AUTH0_AUDIENCE: z.string().default("https://api.jarble.ai"),
  
  // OpenRouter - optional for testing
  OPENROUTER_API_KEY: z.string().default("sk-test-key"),
  // OpenRouter Management API key (for provisioning tenant keys - "Included Credits" feature)
  OPENROUTER_MANAGEMENT_KEY: z.string().optional(),

  // Encryption key for API keys stored in DB (32 bytes as hex = 64 chars)
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Optional in dev (keys stored as plaintext), required in production
  API_KEY_ENCRYPTION_KEY: z.string().length(64).optional(),
  
  // Auth0 M2M - for webhook authentication from Auth0 Actions
  AUTH0_M2M_SECRET: z.string().optional(),

  // Auth0 Management API - for resending verification emails
  // Create an M2M application in Auth0 with "update:users" permission
  AUTH0_MGMT_CLIENT_ID: z.string().optional(),
  AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),

  // Config webhook - shared secret for pod-to-API config-changed callbacks
  CONFIG_WEBHOOK_SECRET: z.string().optional(),

  // Tambo Agent - shared secret for Tambo Cloud → Jarble API auth
  TAMBO_AGENT_SECRET: z.string().optional(),

  // Management agent LLM - the chat agent uses its own key, not the deployment's
  // Falls back to OPENROUTER_API_KEY if not set
  AGENT_LLM_API_KEY: z.string().optional(),
  AGENT_LLM_PROVIDER: z.enum(["anthropic", "openai", "openrouter", "google"]).optional(),
  AGENT_LLM_MODEL: z.string().optional(),
  PLANNER_LLM_MODEL: z.string().optional(), // Cheaper/faster model for dashboard planner (defaults to AGENT_LLM_MODEL)

  // Sentry - optional, error tracking disabled if not set
  SENTRY_DSN: z.string().optional(),

  // Chat WebSocket control channel - optional, disabled by default
  ENABLE_CHAT_WS: z.string().optional(),

  // Mesh gateway - shared secret for internal service-proxy authentication.
  // If not set, a random token is generated per process (safe when mesh gateway
  // and service proxy run in the same process).
  MESH_GATEWAY_SECRET: z.string().optional(),

  // Admin user IDs - comma-separated Auth0 user IDs for marketplace moderation
  ADMIN_USER_IDS: z.string().optional().default(""),

  // Resend - transactional email service, disabled if not set
  RESEND_API_KEY: z.string().optional().default(""),

  // Stripe - all optional, Stripe features disabled if not set
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
}).refine((data) => {
  // DATABASE_URL required unless using SQLite
  if (data.USE_SQLITE !== "true" && data.USE_SQLITE !== "1" && !data.DATABASE_URL) {
    return false;
  }
  return true;
}, {
  message: "DATABASE_URL is required when not using SQLite",
});

export const env = envSchema.parse(process.env);

// Enforce critical env vars in production - fail fast at startup
if (env.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!env.API_KEY_ENCRYPTION_KEY) missing.push("API_KEY_ENCRYPTION_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!env.AUTH0_M2M_SECRET) missing.push("AUTH0_M2M_SECRET");
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}
