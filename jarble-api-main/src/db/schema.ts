import { mysqlTable, varchar, text, int, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { customAlphabet } from "nanoid";

// Prefixed ID generator for marketplace tables
const alphanumeric = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const generateMarketplaceId = (prefix: string) => `${prefix}_${alphanumeric()}`;

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
  messagingOnly: boolean("messaging_only").notNull().default(false),
  managedBy: varchar("managed_by", { length: 20 }).notNull().default("legacy"),  // "legacy" | "operator"
  themeConfig: text("theme_config"),  // JSON ThemeConfig — per-deployment custom theme
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_deployments_user_id").on(table.userId),
  statusIdx: index("idx_deployments_status").on(table.status),
}));

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

// ── Marketplace Tables ──────────────────────────────────────────────────────

// Creator accounts for marketplace
export const creatorProfiles = mysqlTable("creator_profiles", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id).unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  bio: text("bio"),
  websiteUrl: varchar("website_url", { length: 512 }),
  avatarUrl: varchar("avatar_url", { length: 512 }),
  stripeConnectAccountId: varchar("stripe_connect_account_id", { length: 255 }),
  stripeConnectOnboarded: boolean("stripe_connect_onboarded").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  totalEarningsCents: int("total_earnings_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// Published components in the marketplace
export const marketplaceComponents = mysqlTable("marketplace_components", {
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
  priceUsdCents: int("price_usd_cents").notNull().default(0),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  stripeProductId: varchar("stripe_product_id", { length: 255 }),
  currentVersion: varchar("current_version", { length: 20 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  reviewNotes: text("review_notes"),
  totalInstalls: int("total_installs").notNull().default(0),
  totalRevenueCents: int("total_revenue_cents").notNull().default(0),
  averageRating: int("average_rating"), // 1-500 scaled (e.g. 450 = 4.50 stars)
  ratingCount: int("rating_count").notNull().default(0),
  featuredAt: timestamp("featured_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  creatorNameIdx: uniqueIndex("uq_creator_component_name").on(table.creatorId, table.name),
  statusIdx: index("idx_marketplace_components_status").on(table.status),
}));

// Component version history
export const componentVersions = mysqlTable("component_versions", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("ver")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 20 }).notNull(), // semver
  changelog: text("changelog"),
  packageUrl: varchar("package_url", { length: 512 }).notNull(), // S3/R2 key
  packageSizeBytes: int("package_size_bytes").notNull(),
  manifestHash: varchar("manifest_hash", { length: 64 }).notNull(), // SHA-256
  status: varchar("status", { length: 20 }).notNull().default("published"),
  downloadCount: int("download_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  componentVersionIdx: uniqueIndex("uq_component_version").on(table.componentId, table.version),
}));

// Which deployments have which marketplace components installed
export const componentInstalls = mysqlTable("component_installs", {
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
export const componentPurchases = mysqlTable("component_purchases", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pur")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  amountCents: int("amount_cents").notNull(),
  platformFeeCents: int("platform_fee_cents").notNull(),
  creatorPayoutCents: int("creator_payout_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => ({
  userComponentPurchaseIdx: uniqueIndex("uq_user_component_purchase").on(table.userId, table.componentId),
}));

// Ratings and reviews for marketplace components
export const componentReviews = mysqlTable("component_reviews", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("rev")),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  rating: int("rating").notNull(), // 1-5
  title: varchar("title", { length: 255 }),
  body: text("body"),
  creatorResponse: text("creator_response"),
  creatorRespondedAt: timestamp("creator_responded_at"),
  helpful: int("helpful").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userComponentReviewIdx: uniqueIndex("uq_user_component_review").on(table.userId, table.componentId),
}));


// ── Package Tables ────────────────────────────────────────────────────────

export const marketplaceServices = mysqlTable("marketplace_packages", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pkg")),
  creatorId: varchar("creator_id", { length: 255 }).notNull().references(() => creatorProfiles.id),
  name: varchar("name", { length: 100 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  hostingModel: varchar("hosting_model", { length: 20 }).notNull(),
  instructionSnippet: text("instruction_snippet"),
  remoteApiEndpoint: varchar("remote_api_endpoint", { length: 500 }),
  remoteApiConfig: text("remote_api_config"),       // JSON PackageCard for remote/hybrid
  remoteHealth: varchar("remote_health", { length: 20 }).default("unknown"), // healthy | degraded | offline | unknown
  remoteLastCheck: timestamp("remote_last_check"),
  creatorDeploymentId: varchar("creator_deployment_id", { length: 255 }),  // links service to creator's deployment for skill execution
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  pricingModel: varchar("pricing_model", { length: 20 }).notNull().default("free"),
  priceUsdCents: int("price_usd_cents").notNull().default(0),
  totalInstalls: int("total_installs").notNull().default(0),
  avgRating: varchar("avg_rating", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  creatorPackageNameIdx: uniqueIndex("uq_creator_package_name").on(table.creatorId, table.name),
}));

export const serviceComponents = mysqlTable("package_components", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pkc")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id),
}, (table) => ({
  packageComponentIdx: uniqueIndex("uq_package_component").on(table.packageId, table.componentId),
}));

export const serviceSkills = mysqlTable("package_skills", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pks")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id", { length: 255 }).notNull().references(() => skillsCatalog.id),
}, (table) => ({
  packageSkillIdx: uniqueIndex("uq_package_skill").on(table.packageId, table.skillId),
}));

export const serviceInstalls = mysqlTable("package_installs", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pki")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentPackageIdx: uniqueIndex("uq_deployment_package").on(table.deploymentId, table.packageId),
}));

// Stores HMAC signing secrets and handshake state for remote/hybrid package installs
export const serviceCredentials = mysqlTable("package_credentials", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pkc")),
  packageInstallId: varchar("package_install_id", { length: 255 }).notNull().references(() => serviceInstalls.id, { onDelete: "cascade" }),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id),
  signingSecret: text("signing_secret").notNull(), // Encrypted HMAC-SHA256 signing secret
  previousSigningSecret: text("previous_signing_secret"), // Previous secret, accepted during grace period
  previousSecretExpiresAt: timestamp("previous_secret_expires_at"), // After this, only new secret is accepted
  handshakeStatus: varchar("handshake_status", { length: 20 }).notNull().default("pending"), // "pending" | "completed" | "failed"
  handshakeError: text("handshake_error"),
  remoteInstallId: varchar("remote_install_id", { length: 255 }), // ID returned by creator's endpoint
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  deploymentPackageCredIdx: uniqueIndex("uq_deployment_package_cred").on(table.deploymentId, table.packageId),
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

// ── Package Relations ─────────────────────────────────────────────────────

export const marketplaceServicesRelations = relations(marketplaceServices, ({ one, many }) => ({
  creator: one(creatorProfiles, { fields: [marketplaceServices.creatorId], references: [creatorProfiles.id] }),
  components: many(serviceComponents),
  skills: many(serviceSkills),
  installs: many(serviceInstalls),
}));

export const serviceComponentsRelations = relations(serviceComponents, ({ one }) => ({
  package: one(marketplaceServices, { fields: [serviceComponents.packageId], references: [marketplaceServices.id] }),
  component: one(marketplaceComponents, { fields: [serviceComponents.componentId], references: [marketplaceComponents.id] }),
}));

export const serviceSkillsRelations = relations(serviceSkills, ({ one }) => ({
  package: one(marketplaceServices, { fields: [serviceSkills.packageId], references: [marketplaceServices.id] }),
  skill: one(skillsCatalog, { fields: [serviceSkills.skillId], references: [skillsCatalog.id] }),
}));

export const serviceInstallsRelations = relations(serviceInstalls, ({ one }) => ({
  package: one(marketplaceServices, { fields: [serviceInstalls.packageId], references: [marketplaceServices.id] }),
  deployment: one(deployments, { fields: [serviceInstalls.deploymentId], references: [deployments.id] }),
  user: one(users, { fields: [serviceInstalls.userId], references: [users.id] }),
}));

export const serviceCredentialsRelations = relations(serviceCredentials, ({ one }) => ({
  packageInstall: one(serviceInstalls, { fields: [serviceCredentials.packageInstallId], references: [serviceInstalls.id] }),
  deployment: one(deployments, { fields: [serviceCredentials.deploymentId], references: [deployments.id] }),
  package: one(marketplaceServices, { fields: [serviceCredentials.packageId], references: [marketplaceServices.id] }),
}));

// Tracks per-skill request counts per billing cycle for metered usage
export const serviceUsage = mysqlTable("package_usage", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pku")),
  packageInstallId: varchar("package_install_id", { length: 255 }).notNull().references(() => serviceInstalls.id, { onDelete: "cascade" }),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  packageId: varchar("package_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  requestCount: int("request_count").notNull().default(0),
  billingCycleStart: varchar("billing_cycle_start", { length: 10 }).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const serviceUsageRelations = relations(serviceUsage, ({ one }) => ({
  packageInstall: one(serviceInstalls, { fields: [serviceUsage.packageInstallId], references: [serviceInstalls.id] }),
}));

// ── Service Proxy Resilience Tables ────────────────────────────────────────

// Per-deployment+service rate limit counters (shared across API replicas)
export const serviceRateLimits = mysqlTable("service_rate_limits", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("srl")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  windowType: varchar("window_type", { length: 10 }).notNull(), // "minute" | "day"
  windowStart: varchar("window_start", { length: 20 }).notNull(), // Unix ms as string (bigint compat)
  count: int("count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  deploymentServiceWindowIdx: uniqueIndex("uq_srl_deployment_service_window").on(
    table.deploymentId, table.serviceId, table.windowType, table.windowStart,
  ),
}));

// Per-service circuit breaker state (shared across API replicas)
export const serviceCircuitBreakers = mysqlTable("service_circuit_breakers", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("scb")),
  serviceId: varchar("service_id", { length: 255 }).notNull().unique(),
  state: varchar("state", { length: 20 }).notNull().default("CLOSED"), // CLOSED | OPEN | HALF_OPEN
  consecutiveFailures: int("consecutive_failures").notNull().default(0),
  lastFailureAt: varchar("last_failure_at", { length: 20 }), // Unix ms as string
  openedAt: varchar("opened_at", { length: 20 }), // Unix ms as string
  halfOpenClaimedBy: varchar("half_open_claimed_by", { length: 255 }), // Replica ID
  halfOpenClaimedAt: varchar("half_open_claimed_at", { length: 20 }), // Unix ms, 30s timeout
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// Push-based heartbeat records from creator services
export const serviceHeartbeats = mysqlTable("service_heartbeats", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("shb")),
  serviceId: varchar("service_id", { length: 255 }).notNull().unique(),
  lastHeartbeatAt: timestamp("last_heartbeat_at").notNull(),
  heartbeatIntervalMs: int("heartbeat_interval_ms").notNull().default(60000),
  payload: text("payload"), // JSON metadata
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// Async job queue for long-running skill executions
export const serviceAsyncJobs = mysqlTable("service_async_jobs", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("sjb")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | completed | failed
  requestBody: text("request_body").notNull(), // JSON
  responseBody: text("response_body"), // JSON
  responseStatus: int("response_status"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  deploymentIdIdx: index("idx_service_async_jobs_deployment_id").on(table.deploymentId),
  expiresAtIdx: index("idx_service_async_jobs_expires_at").on(table.expiresAt),
}));
