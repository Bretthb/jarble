import { mysqlTable, varchar, text, int, timestamp, boolean, uniqueIndex } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  auth0Id: varchar("auth0_id", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  pendingStripeSubscriptionId: varchar("pending_stripe_subscription_id", { length: 255 }),
  freeDeploymentUsed: boolean("free_deployment_used").notNull().default(false),
  freeTrialExpiresAt: timestamp("free_trial_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const deployments = mysqlTable("deployments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  runtime: varchar("runtime", { length: 100 }).notNull().default("openclaw"),
  image: varchar("image", { length: 255 }),
  runtimeCatalogId: int("runtime_catalog_id").references(() => runtimeCatalog.id),
  isFree: boolean("is_free").notNull().default(false),
  monthlyPriceCents: int("monthly_price_cents").notNull().default(0),
  freeExpiresAt: timestamp("free_expires_at"),
  cpuLimit: varchar("cpu_limit", { length: 10 }),
  memoryMb: int("memory_mb"),
  storageMb: int("storage_mb"),
  llmMode: varchar("llm_mode", { length: 20 }).notNull().default("byok"),
  llmProvider: varchar("llm_provider", { length: 30 }).notNull().default("openrouter"),
  llmModel: varchar("llm_model", { length: 100 }),
  llmApiKey: varchar("llm_api_key", { length: 512 }),       // Encrypted API key (AES-256-GCM)
  llmApiKeyId: varchar("llm_api_key_id", { length: 255 }), // OpenRouter key ID (for revocation / usage tracking)
  llmCreditLimitDollars: int("llm_credit_limit_dollars"),  // Monthly spending cap for "included" mode (e.g. 5, 10, 25, 50, 100)
  llmApiKeySourceDeploymentId: varchar("llm_api_key_source_deployment_id", { length: 255 }), // null = owns key, non-null = linked to owner deployment
  systemPrompt: text("system_prompt"),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }), // Links deployment to Stripe subscription
  cancelledAt: timestamp("cancelled_at"),          // When user initiated cancellation
  cancelAtPeriodEnd: timestamp("cancel_at_period_end"), // Billing period end (when deployment auto-stops)
  status: varchar("status", { length: 50 }).notNull().default("creating"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const runtimeCatalog = mysqlTable("runtime_catalog", {
  id: int("id").primaryKey().autoincrement(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("bot"),
  dockerImage: varchar("docker_image", { length: 255 }).notNull(),
  cpuLimit: varchar("cpu_limit", { length: 10 }).notNull().default("2.0"),
  memoryMb: int("memory_mb").notNull().default(2048),
  storageMb: int("storage_mb").notNull().default(30),
  monthlyPriceCents: int("monthly_price_cents").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const platformCredentials = mysqlTable("platform_credentials", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  platformId: varchar("platform_id", { length: 50 }).notNull(), // "discord", "slack", etc.
  credentials: text("credentials").notNull(), // AES-256-GCM encrypted JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  deploymentPlatformIdx: uniqueIndex("uq_deployment_platform").on(table.deploymentId, table.platformId),
}));

// Webhook idempotency tracking — stores processed webhook event IDs to prevent duplicate processing
export const processedWebhookEvents = mysqlTable("processed_webhook_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(), // Stripe event ID (e.g., evt_xxx)
  eventType: varchar("event_type", { length: 100 }).notNull(), // e.g., "checkout.session.completed"
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// Global skills marketplace catalog — all available skills across runtimes
export const skillsCatalog = mysqlTable("skills_catalog", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  runtime: varchar("runtime", { length: 50 }).notNull().default("openclaw"), // which runtime supports it
  config: text("config").notNull(), // JSON skill definition (tool name, params, etc.)
  author: varchar("author", { length: 100 }),
  isOfficial: boolean("is_official").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Join table — which skills are installed on which deployment
export const deploymentSkills = mysqlTable("deployment_skills", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id", { length: 255 }).notNull().references(() => skillsCatalog.id),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentSkillIdx: uniqueIndex("uq_deployment_skill").on(table.deploymentId, table.skillId),
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  deployments: many(deployments),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  user: one(users, { fields: [deployments.userId], references: [users.id] }),
  runtimeCatalogEntry: one(runtimeCatalog, { fields: [deployments.runtimeCatalogId], references: [runtimeCatalog.id] }),
  platformCredentials: many(platformCredentials),
}));

export const runtimeCatalogRelations = relations(runtimeCatalog, ({ many }) => ({
  deployments: many(deployments),
}));

export const platformCredentialsRelations = relations(platformCredentials, ({ one }) => ({
  deployment: one(deployments, { fields: [platformCredentials.deploymentId], references: [deployments.id] }),
}));

export const skillsCatalogRelations = relations(skillsCatalog, ({ many }) => ({
  deploymentSkills: many(deploymentSkills),
}));

export const deploymentSkillsRelations = relations(deploymentSkills, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentSkills.deploymentId], references: [deployments.id] }),
  skill: one(skillsCatalog, { fields: [deploymentSkills.skillId], references: [skillsCatalog.id] }),
}));
