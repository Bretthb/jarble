import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { customAlphabet } from "nanoid";

const now = () => new Date().toISOString();

// Prefixed ID generator for marketplace tables
const alphanumeric = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const generateMarketplaceId = (prefix: string) => `${prefix}_${alphanumeric()}`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  auth0Id: text("auth0_id").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  pendingStripeSubscriptionId: text("pending_stripe_subscription_id"),
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
  llmApiKey: text("llm_api_key"),           // Encrypted API key (AES-256-GCM)
  llmApiKeyId: text("llm_api_key_id"),     // OpenRouter key ID (for revocation / usage tracking)
  llmCreditLimitDollars: integer("llm_credit_limit_dollars"),  // Monthly spending cap for "included" mode (e.g. 5, 10, 25, 50, 100)
  llmApiKeySourceDeploymentId: text("llm_api_key_source_deployment_id"), // null = owns key, non-null = linked to owner deployment
  systemPrompt: text("system_prompt"),
  stripeSubscriptionId: text("stripe_subscription_id"), // Links deployment to Stripe subscription
  cancelledAt: text("cancelled_at"),          // When user initiated cancellation (ISO string)
  cancelAtPeriodEnd: text("cancel_at_period_end"), // Billing period end (when deployment auto-stops, ISO string)
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

export const platformCredentials = sqliteTable("platform_credentials", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  platformId: text("platform_id").notNull(), // "discord", "slack", etc.
  credentials: text("credentials").notNull(), // AES-256-GCM encrypted JSON
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentPlatformIdx: uniqueIndex("uq_deployment_platform").on(table.deploymentId, table.platformId),
}));

// Webhook idempotency tracking — stores processed webhook event IDs to prevent duplicate processing
export const processedWebhookEvents = sqliteTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(), // Stripe event ID (e.g., evt_xxx)
  eventType: text("event_type").notNull(), // e.g., "checkout.session.completed"
  processedAt: text("processed_at").notNull().$defaultFn(now),
});

// Global skills marketplace catalog — all available skills across runtimes
export const skillsCatalog = sqliteTable("skills_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  runtime: text("runtime").notNull().default("openclaw"), // which runtime supports it
  config: text("config").notNull(), // JSON skill definition (tool name, params, etc.)
  author: text("author"),
  isOfficial: integer("is_official", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// Join table — which skills are installed on which deployment
export const deploymentSkills = sqliteTable("deployment_skills", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skillsCatalog.id),
  installedAt: text("installed_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentSkillIdx: uniqueIndex("uq_deployment_skill").on(table.deploymentId, table.skillId),
}));

// ── Marketplace Tables ──────────────────────────────────────────────────────

// Creator accounts for marketplace
export const creatorProfiles = sqliteTable("creator_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id).unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  websiteUrl: text("website_url"),
  avatarUrl: text("avatar_url"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectOnboarded: integer("stripe_connect_onboarded", { mode: "boolean" }).notNull().default(false),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  totalEarningsCents: integer("total_earnings_cents").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

// Published components in the marketplace
export const marketplaceComponents = sqliteTable("marketplace_components", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("cmp")),
  creatorId: text("creator_id").notNull().references(() => users.id),
  name: text("name").notNull(), // lowercase slug
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  botDescription: text("bot_description"),
  tier: text("tier").notNull(), // "template" | "sandbox"
  category: text("category").notNull(),
  tags: text("tags"), // JSON array string
  icon: text("icon"), // URL
  propsSchema: text("props_schema"), // JSON Schema string
  exampleProps: text("example_props"), // JSON string
  examplePrompts: text("example_prompts"), // JSON array string
  pricingModel: text("pricing_model").notNull().default("free"),
  priceUsdCents: integer("price_usd_cents").notNull().default(0),
  stripePriceId: text("stripe_price_id"),
  stripeProductId: text("stripe_product_id"),
  currentVersion: text("current_version").notNull().default("1.0.0"),
  status: text("status").notNull().default("draft"), // draft|submitted|in_review|approved|published|rejected|deprecated
  reviewNotes: text("review_notes"),
  totalInstalls: integer("total_installs").notNull().default(0),
  totalRevenueCents: integer("total_revenue_cents").notNull().default(0),
  averageRating: integer("average_rating"), // 1-500 scaled (e.g. 450 = 4.50 stars)
  ratingCount: integer("rating_count").notNull().default(0),
  featuredAt: text("featured_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  creatorNameIdx: uniqueIndex("uq_creator_component_name").on(table.creatorId, table.name),
}));

// Component version history
export const componentVersions = sqliteTable("component_versions", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("ver")),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  version: text("version").notNull(), // semver
  changelog: text("changelog"),
  packageUrl: text("package_url").notNull(), // S3/R2 key
  packageSizeBytes: integer("package_size_bytes").notNull(),
  manifestHash: text("manifest_hash").notNull(), // SHA-256
  status: text("status").notNull().default("published"),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  componentVersionIdx: uniqueIndex("uq_component_version").on(table.componentId, table.version),
}));

// Which deployments have which marketplace components installed
export const componentInstalls = sqliteTable("component_installs", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("inst")),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id),
  versionId: text("version_id").notNull().references(() => componentVersions.id),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  pinnedVersion: text("pinned_version"),
  autoUpdate: integer("auto_update", { mode: "boolean" }).notNull().default(true),
  syncedAt: text("synced_at"),
  installedAt: text("installed_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentComponentIdx: uniqueIndex("uq_deployment_component").on(table.deploymentId, table.componentId),
}));

// Payment records for marketplace component purchases
export const componentPurchases = sqliteTable("component_purchases", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pur")),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id),
  userId: text("user_id").notNull().references(() => users.id),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  creatorPayoutCents: integer("creator_payout_cents").notNull(),
  status: text("status").notNull().default("active"),
  purchasedAt: text("purchased_at").notNull().$defaultFn(now),
  expiresAt: text("expires_at"),
}, (table) => ({
  userComponentPurchaseIdx: uniqueIndex("uq_user_component_purchase").on(table.userId, table.componentId),
}));

// Ratings and reviews for marketplace components
export const componentReviews = sqliteTable("component_reviews", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("rev")),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(), // 1-5
  title: text("title"),
  body: text("body"),
  creatorResponse: text("creator_response"),
  creatorRespondedAt: text("creator_responded_at"),
  helpful: integer("helpful").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
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
