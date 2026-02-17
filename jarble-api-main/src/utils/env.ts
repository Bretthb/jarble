import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3001").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  // Database provider: "mysql" | "postgres" | "sqlite" (in-memory, dev only)
  DB_PROVIDER: z.enum(["mysql", "postgres", "sqlite"]).default("mysql"),
  USE_SQLITE: z.string().optional(), // Legacy — same as DB_PROVIDER=sqlite
  DATABASE_URL: z.string().optional(), // Required when not using SQLite
  
  // Auth0 - optional for testing, required for production
  AUTH0_DOMAIN: z.string().default("test.auth0.com"),
  AUTH0_AUDIENCE: z.string().default("https://api.jarble.ai"),
  
  // OpenRouter - optional for testing
  OPENROUTER_API_KEY: z.string().default("sk-test-key"),
  // OpenRouter Management API key (for provisioning tenant keys — "Included Credits" feature)
  OPENROUTER_MANAGEMENT_KEY: z.string().optional(),

  // Encryption key for API keys stored in DB (32 bytes as hex = 64 chars)
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Optional in dev (keys stored as plaintext), required in production
  API_KEY_ENCRYPTION_KEY: z.string().length(64).optional(),
  
  // Auth0 M2M — for webhook authentication from Auth0 Actions
  AUTH0_M2M_SECRET: z.string().optional(),

  // Auth0 Management API — for resending verification emails
  // Create an M2M application in Auth0 with "update:users" permission
  AUTH0_MGMT_CLIENT_ID: z.string().optional(),
  AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),

  // Stripe — all optional, Stripe features disabled if not set
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),
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
