import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3001").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  
  // Database - MySQL or in-memory SQLite
  USE_SQLITE: z.string().optional(), // "true" for in-memory SQLite (testing)
  DATABASE_URL: z.string().optional(), // Required when not using SQLite
  
  // Auth0 - optional for testing, required for production
  AUTH0_DOMAIN: z.string().default("test.auth0.com"),
  AUTH0_AUDIENCE: z.string().default("https://api.jarble.ai"),
  
  // OpenRouter - optional for testing
  OPENROUTER_API_KEY: z.string().default("sk-test-key"),
  
  // Stripe is optional for initial testing
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
