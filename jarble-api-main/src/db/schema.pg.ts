import { pgTable, varchar, text, integer, timestamp, boolean, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  auth0Id: varchar("auth0_id", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  freeDeploymentUsed: boolean("free_deployment_used").notNull().default(false),
  freeTrialExpiresAt: timestamp("free_trial_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deployments = pgTable("deployments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  runtime: varchar("runtime", { length: 100 }).notNull().default("openclaw"),
  image: varchar("image", { length: 255 }),
  runtimeCatalogId: integer("runtime_catalog_id").references(() => runtimeCatalog.id),
  isFree: boolean("is_free").notNull().default(false),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  freeExpiresAt: timestamp("free_expires_at"),
  cpuLimit: varchar("cpu_limit", { length: 10 }),
  memoryMb: integer("memory_mb"),
  storageMb: integer("storage_mb"),
  llmMode: varchar("llm_mode", { length: 20 }).notNull().default("byok"),
  llmProvider: varchar("llm_provider", { length: 30 }).notNull().default("openrouter"),
  llmModel: varchar("llm_model", { length: 100 }),
  llmApiKey: varchar("llm_api_key", { length: 512 }),       // Encrypted API key (AES-256-GCM)
  llmApiKeyId: varchar("llm_api_key_id", { length: 255 }), // OpenRouter key ID (for revocation / usage tracking)
  llmCreditLimitDollars: integer("llm_credit_limit_dollars"),  // Monthly spending cap for "included" mode (e.g. 5, 10, 25, 50, 100)
  llmApiKeySourceDeploymentId: varchar("llm_api_key_source_deployment_id", { length: 255 }), // null = owns key, non-null = linked to owner deployment
  systemPrompt: text("system_prompt"),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }), // Links deployment to Stripe subscription
  cancelledAt: timestamp("cancelled_at"),          // When user initiated cancellation
  cancelAtPeriodEnd: timestamp("cancel_at_period_end"), // Billing period end (when deployment auto-stops)
  status: varchar("status", { length: 50 }).notNull().default("creating"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const runtimeCatalog = pgTable("runtime_catalog", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("bot"),
  dockerImage: varchar("docker_image", { length: 255 }).notNull(),
  cpuLimit: varchar("cpu_limit", { length: 10 }).notNull().default("2.0"),
  memoryMb: integer("memory_mb").notNull().default(2048),
  storageMb: integer("storage_mb").notNull().default(30),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
