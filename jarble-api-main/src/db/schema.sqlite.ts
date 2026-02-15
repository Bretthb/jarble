import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const now = () => new Date().toISOString();

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  auth0Id: text("auth0_id").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  freeDeploymentUsed: integer("free_deployment_used", { mode: "boolean" }).notNull().default(false),
  freeTrialExpiresAt: text("free_trial_expires_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  runtime: text("runtime").notNull().default("openclaw"),
  image: text("image"),
  runtimeCatalogId: integer("runtime_catalog_id").references(() => runtimeCatalog.id),
  isFree: integer("is_free", { mode: "boolean" }).notNull().default(false),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  freeExpiresAt: text("free_expires_at"),
  cpuLimit: text("cpu_limit"),        // e.g. "2.0" — overrides runtime_catalog default if set
  memoryMb: integer("memory_mb"),     // e.g. 2048 — RAM in MB, overrides runtime_catalog default
  storageMb: integer("storage_mb"),   // e.g. 30 — storage in GB (historical naming), overrides runtime_catalog default
  llmMode: text("llm_mode").notNull().default("byok"), // "included" | "byok"
  llmProvider: text("llm_provider").notNull().default("openrouter"), // "openrouter" | "openai" | "anthropic" | "google"
  llmModel: text("llm_model"), // e.g. "openrouter/auto", "gpt-4o", "claude-sonnet-4-20250514"
  llmApiKey: text("llm_api_key"),
  status: text("status").notNull().default("creating"),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const runtimeCatalog = sqliteTable("runtime_catalog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("bot"),
  dockerImage: text("docker_image").notNull(),
  cpuLimit: text("cpu_limit").notNull().default("2.0"),
  memoryMb: integer("memory_mb").notNull().default(2048),
  storageMb: integer("storage_mb").notNull().default(30),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  deployments: many(deployments),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  user: one(users, { fields: [deployments.userId], references: [users.id] }),
  runtimeCatalogEntry: one(runtimeCatalog, { fields: [deployments.runtimeCatalogId], references: [runtimeCatalog.id] }),
}));

export const runtimeCatalogRelations = relations(runtimeCatalog, ({ many }) => ({
  deployments: many(deployments),
}));
