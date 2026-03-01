import { pgTable, varchar, text, integer, timestamp, boolean, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { customAlphabet } from "nanoid";

// Prefixed ID generator for marketplace tables
const alphanumeric = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const generateMarketplaceId = (prefix: string) => `${prefix}_${alphanumeric()}`;

export const users = pgTable("users", {
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

export const platformCredentials = pgTable("platform_credentials", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  platformId: varchar("platform_id", { length: 50 }).notNull(), // "discord", "slack", etc.
  credentials: text("credentials").notNull(), // AES-256-GCM encrypted JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  deploymentPlatformIdx: uniqueIndex("uq_deployment_platform").on(table.deploymentId, table.platformId),
}));

// Webhook idempotency tracking — stores processed webhook event IDs to prevent duplicate processing
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(), // Stripe event ID (e.g., evt_xxx)
  eventType: varchar("event_type", { length: 100 }).notNull(), // e.g., "checkout.session.completed"
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// Global skills marketplace catalog — all available skills across runtimes
export const skillsCatalog = pgTable("skills_catalog", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  runtime: varchar("runtime", { length: 50 }).notNull().default("openclaw"),
  config: text("config").notNull(),
  author: varchar("author", { length: 100 }),
  isOfficial: boolean("is_official").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Join table — which skills are installed on which deployment
export const deploymentSkills = pgTable("deployment_skills", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id", { length: 255 }).notNull().references(() => skillsCatalog.id),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentSkillIdx: uniqueIndex("uq_deployment_skill").on(table.deploymentId, table.skillId),
}));

// ── Marketplace Tables ──────────────────────────────────────────────────────

// Creator accounts for marketplace
export const creatorProfiles = pgTable("creator_profiles", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id).unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  bio: text("bio"),
  websiteUrl: varchar("website_url", { length: 512 }),
  avatarUrl: varchar("avatar_url", { length: 512 }),
  stripeConnectAccountId: varchar("stripe_connect_account_id", { length: 255 }),
  stripeConnectOnboarded: boolean("stripe_connect_onboarded").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  totalEarningsCents: integer("total_earnings_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Published components in the marketplace
export const marketplaceComponents = pgTable("marketplace_components", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("cmp")),
  creatorId: varchar("creator_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(), // lowercase slug
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  botDescription: text("bot_description"),
  tier: varchar("tier", { length: 20 }).notNull(), // "template" | "sandbox"
  category: varchar("category", { length: 50 }).notNull(),
  tags: text("tags"), // JSON array string
  icon: varchar("icon", { length: 512 }), // URL
  propsSchema: text("props_schema"), // JSON Schema string
  exampleProps: text("example_props"), // JSON string
  examplePrompts: text("example_prompts"), // JSON array string
  pricingModel: varchar("pricing_model", { length: 20 }).notNull().default("free"),
  priceUsdCents: integer("price_usd_cents").notNull().default(0),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  stripeProductId: varchar("stripe_product_id", { length: 255 }),
  currentVersion: varchar("current_version", { length: 20 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  reviewNotes: text("review_notes"),
  totalInstalls: integer("total_installs").notNull().default(0),
  totalRevenueCents: integer("total_revenue_cents").notNull().default(0),
  averageRating: integer("average_rating"), // 1-500 scaled (e.g. 450 = 4.50 stars)
  ratingCount: integer("rating_count").notNull().default(0),
  featuredAt: timestamp("featured_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  creatorNameIdx: uniqueIndex("uq_creator_component_name").on(table.creatorId, table.name),
}));

// Component version history
export const componentVersions = pgTable("component_versions", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("ver")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 20 }).notNull(), // semver
  changelog: text("changelog"),
  packageUrl: varchar("package_url", { length: 512 }).notNull(), // S3/R2 key
  packageSizeBytes: integer("package_size_bytes").notNull(),
  manifestHash: varchar("manifest_hash", { length: 64 }).notNull(), // SHA-256
  status: varchar("status", { length: 20 }).notNull().default("published"),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  componentVersionIdx: uniqueIndex("uq_component_version").on(table.componentId, table.version),
}));

// Which deployments have which marketplace components installed
export const componentInstalls = pgTable("component_installs", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("inst")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id),
  versionId: varchar("version_id", { length: 255 }).notNull().references(() => componentVersions.id),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  pinnedVersion: varchar("pinned_version", { length: 20 }),
  autoUpdate: boolean("auto_update").notNull().default(true),
  syncedAt: timestamp("synced_at"),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentComponentIdx: uniqueIndex("uq_deployment_component").on(table.deploymentId, table.componentId),
}));

// Payment records for marketplace component purchases
export const componentPurchases = pgTable("component_purchases", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pur")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  creatorPayoutCents: integer("creator_payout_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => ({
  userComponentPurchaseIdx: uniqueIndex("uq_user_component_purchase").on(table.userId, table.componentId),
}));

// Ratings and reviews for marketplace components
export const componentReviews = pgTable("component_reviews", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("rev")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  rating: integer("rating").notNull(), // 1-5
  title: varchar("title", { length: 255 }),
  body: text("body"),
  creatorResponse: text("creator_response"),
  creatorRespondedAt: timestamp("creator_responded_at"),
  helpful: integer("helpful").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userComponentReviewIdx: uniqueIndex("uq_user_component_review").on(table.userId, table.componentId),
}));

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  deployments: many(deployments),
  creatorProfile: one(creatorProfiles, { fields: [users.id], references: [creatorProfiles.userId] }),
  marketplaceComponents: many(marketplaceComponents),
  componentInstalls: many(componentInstalls),
  componentPurchases: many(componentPurchases),
  componentReviews: many(componentReviews),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  user: one(users, { fields: [deployments.userId], references: [users.id] }),
  runtimeCatalogEntry: one(runtimeCatalog, { fields: [deployments.runtimeCatalogId], references: [runtimeCatalog.id] }),
  platformCredentials: many(platformCredentials),
  componentInstalls: many(componentInstalls),
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

// ── Marketplace Relations ───────────────────────────────────────────────────

export const creatorProfilesRelations = relations(creatorProfiles, ({ one }) => ({
  user: one(users, { fields: [creatorProfiles.userId], references: [users.id] }),
}));

export const marketplaceComponentsRelations = relations(marketplaceComponents, ({ one, many }) => ({
  creator: one(users, { fields: [marketplaceComponents.creatorId], references: [users.id] }),
  versions: many(componentVersions),
  installs: many(componentInstalls),
  reviews: many(componentReviews),
  purchases: many(componentPurchases),
}));

export const componentVersionsRelations = relations(componentVersions, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentVersions.componentId], references: [marketplaceComponents.id] }),
}));

export const componentInstallsRelations = relations(componentInstalls, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentInstalls.componentId], references: [marketplaceComponents.id] }),
  version: one(componentVersions, { fields: [componentInstalls.versionId], references: [componentVersions.id] }),
  deployment: one(deployments, { fields: [componentInstalls.deploymentId], references: [deployments.id] }),
  user: one(users, { fields: [componentInstalls.userId], references: [users.id] }),
}));

export const componentPurchasesRelations = relations(componentPurchases, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentPurchases.componentId], references: [marketplaceComponents.id] }),
  user: one(users, { fields: [componentPurchases.userId], references: [users.id] }),
}));

export const componentReviewsRelations = relations(componentReviews, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentReviews.componentId], references: [marketplaceComponents.id] }),
  user: one(users, { fields: [componentReviews.userId], references: [users.id] }),
}));
