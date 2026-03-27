import { pgTable, varchar, text, integer, timestamp, boolean, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  role: varchar("role", { length: 20 }).notNull().default("user"),
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
  deploymentType: varchar("deployment_type", { length: 20 }).notNull().default("agent"), // "agent" | "container" | "website" — determines K8s scheduling
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
  messagingOnly: boolean("messaging_only").notNull().default(false),
  managedBy: varchar("managed_by", { length: 20 }).notNull().default("legacy"),  // "legacy" | "operator"
  isolationLevel: varchar("isolation_level", { length: 20 }).notNull().default("standard"),  // "standard" | "gvisor" | "kata"
  isPlatform: boolean("is_platform").notNull().default(false),  // Platform-owned agent (bypasses subscription/storage enforcement)
  resourceTier: varchar("resource_tier", { length: 20 }),  // Named resource preset: "small" | "medium" | "large"
  themeConfig: text("theme_config"),  // JSON ThemeConfig — per-deployment custom theme
  // Fork & public profile fields
  forkedFromId: varchar("forked_from_id", { length: 255 }),
  isPublic: boolean("is_public").notNull().default(false),
  forkCount: integer("fork_count").notNull().default(0),
  featuredAt: timestamp("featured_at"),
  specialties: text("specialties"),  // JSON array of domain slugs
  bio: text("bio"),
  showcasePrompts: text("showcase_prompts"),  // JSON array of example prompts
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_deployments_user_id").on(table.userId),
  statusIdx: index("idx_deployments_status").on(table.status),
  isPublicIdx: index("idx_deployments_is_public").on(table.isPublic),
}));

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
  isPlatform: boolean("is_platform").notNull().default(false),
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
  statusIdx: index("idx_marketplace_components_status").on(table.status),
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


// ── Package Tables ────────────────────────────────────────────────────────

export const marketplaceServices = pgTable("marketplace_packages", {
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
  priceUsdCents: integer("price_usd_cents").notNull().default(0),
  isPlatform: boolean("is_platform").notNull().default(false),
  totalInstalls: integer("total_installs").notNull().default(0),
  avgRating: varchar("avg_rating", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  creatorPackageNameIdx: uniqueIndex("uq_creator_package_name").on(table.creatorId, table.name),
}));

export const serviceComponents = pgTable("package_components", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pkc")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  componentId: varchar("component_id", { length: 255 }).notNull().references(() => marketplaceComponents.id),
}, (table) => ({
  packageComponentIdx: uniqueIndex("uq_package_component").on(table.packageId, table.componentId),
}));

export const serviceSkills = pgTable("package_skills", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pks")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id", { length: 255 }).notNull().references(() => skillsCatalog.id),
}, (table) => ({
  packageSkillIdx: uniqueIndex("uq_package_skill").on(table.packageId, table.skillId),
}));

export const serviceInstalls = pgTable("package_installs", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pki")),
  packageId: varchar("package_id", { length: 255 }).notNull().references(() => marketplaceServices.id),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentPackageIdx: uniqueIndex("uq_deployment_package").on(table.deploymentId, table.packageId),
}));

// Stores HMAC signing secrets and handshake state for remote/hybrid package installs
export const serviceCredentials = pgTable("package_credentials", {
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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  subagents: many(deploymentSubagents),
  flowMemberships: many(flowDeploymentMemberships),
}));

// ── Chat History Tables ───────────────────────────────────────────────────

export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull().default("New conversation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 255 }).primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  thinkingText: text("thinking_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Audit Logs ──────────────────────────────────────────────────────────

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }),
  targetId: varchar("target_id", { length: 255 }),
  metadata: text("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const betaSignups = pgTable("beta_signups", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  experience: varchar("experience", { length: 50 }),
  useCase: text("use_case"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  invitedAt: timestamp("invited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
export const serviceUsage = pgTable("package_usage", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("pku")),
  packageInstallId: varchar("package_install_id", { length: 255 }).notNull().references(() => serviceInstalls.id, { onDelete: "cascade" }),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  packageId: varchar("package_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  billingCycleStart: varchar("billing_cycle_start", { length: 10 }).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const serviceUsageRelations = relations(serviceUsage, ({ one }) => ({
  packageInstall: one(serviceInstalls, { fields: [serviceUsage.packageInstallId], references: [serviceInstalls.id] }),
}));

// ── Service Proxy Resilience Tables ────────────────────────────────────────

// Per-deployment+service rate limit counters (shared across API replicas)
export const serviceRateLimits = pgTable("service_rate_limits", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("srl")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  windowType: varchar("window_type", { length: 10 }).notNull(), // "minute" | "day"
  windowStart: varchar("window_start", { length: 20 }).notNull(), // Unix ms as string
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  deploymentServiceWindowIdx: uniqueIndex("uq_srl_deployment_service_window").on(
    table.deploymentId, table.serviceId, table.windowType, table.windowStart,
  ),
}));

// Per-service circuit breaker state (shared across API replicas)
export const serviceCircuitBreakers = pgTable("service_circuit_breakers", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("scb")),
  serviceId: varchar("service_id", { length: 255 }).notNull().unique(),
  state: varchar("state", { length: 20 }).notNull().default("CLOSED"), // CLOSED | OPEN | HALF_OPEN
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastFailureAt: varchar("last_failure_at", { length: 20 }), // Unix ms as string
  openedAt: varchar("opened_at", { length: 20 }), // Unix ms as string
  halfOpenClaimedBy: varchar("half_open_claimed_by", { length: 255 }), // Replica ID
  halfOpenClaimedAt: varchar("half_open_claimed_at", { length: 20 }), // Unix ms, 30s timeout
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Push-based heartbeat records from creator services
export const serviceHeartbeats = pgTable("service_heartbeats", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("shb")),
  serviceId: varchar("service_id", { length: 255 }).notNull().unique(),
  lastHeartbeatAt: timestamp("last_heartbeat_at").notNull(),
  heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull().default(60000),
  payload: text("payload"), // JSON metadata
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// API keys for external agent/mesh access
export const apiKeys = pgTable("api_keys", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("ak")),
  userId: varchar("user_id", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  scopes: varchar("scopes", { length: 500 }).notNull().default("mesh:read,mesh:write"),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  rateLimitPerDay: integer("rate_limit_per_day").notNull().default(10000),
  lastUsedAt: timestamp("last_used_at"),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_api_keys_user_id").on(table.userId),
  keyHashIdx: uniqueIndex("idx_api_keys_key_hash").on(table.keyHash),
}));

// Async job queue for long-running skill executions
export const serviceAsyncJobs = pgTable("service_async_jobs", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("sjb")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | completed | failed
  requestBody: text("request_body").notNull(), // JSON
  responseBody: text("response_body"), // JSON
  responseStatus: integer("response_status"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  deploymentIdIdx: index("idx_service_async_jobs_deployment_id").on(table.deploymentId),
  expiresAtIdx: index("idx_service_async_jobs_expires_at").on(table.expiresAt),
}));

// ── Domain Taxonomy & Benchmark Tables ────────────────────────────────────

export const domains = pgTable("domains", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("dom")),
  name: varchar("name", { length: 100 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  parentId: varchar("parent_id", { length: 255 }),
  icon: varchar("icon", { length: 100 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  parentIdx: index("idx_domains_parent").on(table.parentId),
  nameIdx: uniqueIndex("uq_domains_name").on(table.name),
}));

export const deploymentRatings = pgTable("deployment_ratings", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("drt")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  domainId: varchar("domain_id", { length: 255 }).notNull().references(() => domains.id),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  accuracy: integer("accuracy").notNull(),
  helpfulness: integer("helpfulness").notNull(),
  creativity: integer("creativity").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userDeploymentDomainIdx: uniqueIndex("uq_deployment_rating").on(table.userId, table.deploymentId, table.domainId),
  deploymentDomainIdx: index("idx_drt_deployment_domain").on(table.deploymentId, table.domainId),
}));

export const deploymentDomainScores = pgTable("deployment_domain_scores", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("dds")),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  domainId: varchar("domain_id", { length: 255 }).notNull().references(() => domains.id),
  avgAccuracy: integer("avg_accuracy"),
  avgHelpfulness: integer("avg_helpfulness"),
  avgCreativity: integer("avg_creativity"),
  overallScore: integer("overall_score"),
  ratingCount: integer("rating_count").notNull().default(0),
  confidence: varchar("confidence", { length: 10 }).notNull().default("low"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  deploymentDomainIdx: uniqueIndex("uq_dds_deployment_domain").on(table.deploymentId, table.domainId),
  domainScoreIdx: index("idx_dds_domain_score").on(table.domainId, table.overallScore),
}));

export const serviceBenchmarkSamples = pgTable("service_benchmark_samples", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("sbs")),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  statusCode: integer("status_code").notNull(),
  success: boolean("success").notNull().default(true),
  responseSizeBytes: integer("response_size_bytes"),
  sampledAt: timestamp("sampled_at").defaultNow().notNull(),
}, (table) => ({
  serviceSkillIdx: index("idx_sbs_service_skill").on(table.serviceId, table.skillName),
  sampledAtIdx: index("idx_sbs_sampled_at").on(table.sampledAt),
}));

export const serviceBenchmarkAggregates = pgTable("service_benchmark_aggregates", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("sba")),
  serviceId: varchar("service_id", { length: 255 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  period: varchar("period", { length: 10 }).notNull(),
  latencyP50: integer("latency_p50"),
  latencyP95: integer("latency_p95"),
  latencyP99: integer("latency_p99"),
  uptimePercent: integer("uptime_percent"),
  errorRate: integer("error_rate"),
  avgResponseSize: integer("avg_response_size"),
  sampleCount: integer("sample_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  serviceSkillPeriodIdx: uniqueIndex("uq_sba_service_skill_period").on(table.serviceId, table.skillName, table.period),
}));

export const serviceReviews = pgTable("service_reviews", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("srv")),
  serviceId: varchar("service_id", { length: 255 }).notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  rating: integer("rating").notNull(),
  title: varchar("title", { length: 255 }),
  body: text("body"),
  creatorResponse: text("creator_response"),
  creatorRespondedAt: timestamp("creator_responded_at"),
  helpful: integer("helpful").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userServiceReviewIdx: uniqueIndex("uq_user_service_review").on(table.userId, table.serviceId),
}));

// ── Benchmark Relations ─────────────────────────────────────────────────

export const domainsRelations = relations(domains, ({ many }) => ({
  ratings: many(deploymentRatings),
  scores: many(deploymentDomainScores),
}));

export const deploymentRatingsRelations = relations(deploymentRatings, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentRatings.deploymentId], references: [deployments.id] }),
  domain: one(domains, { fields: [deploymentRatings.domainId], references: [domains.id] }),
  user: one(users, { fields: [deploymentRatings.userId], references: [users.id] }),
}));

export const deploymentDomainScoresRelations = relations(deploymentDomainScores, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentDomainScores.deploymentId], references: [deployments.id] }),
  domain: one(domains, { fields: [deploymentDomainScores.domainId], references: [domains.id] }),
}));

export const serviceReviewsRelations = relations(serviceReviews, ({ one }) => ({
  service: one(marketplaceServices, { fields: [serviceReviews.serviceId], references: [marketplaceServices.id] }),
  user: one(users, { fields: [serviceReviews.userId], references: [users.id] }),
}));

// ── Agent Credits & Calls Tables ──────────────────────────────────────

// Append-only credits ledger
export const agentCredits = pgTable("agent_credits", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("acr")),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  amount: integer("amount").notNull(),        // positive = credit, negative = debit
  balance: integer("balance").notNull(),       // running balance after this transaction
  reason: varchar("reason", { length: 50 }).notNull(),  // "purchase", "agent_call", "earnings", "refund"
  reference: varchar("reference", { length: 255 }),      // stripe payment ID, call ID, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_agent_credits_user_id").on(table.userId),
}));

// Agent-to-agent call tracking
export const agentCalls = pgTable("agent_calls", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("acl")),
  callerDeploymentId: varchar("caller_deployment_id", { length: 255 }).notNull().references(() => deployments.id),
  calleeDeploymentId: varchar("callee_deployment_id", { length: 255 }).notNull().references(() => deployments.id),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, completed, failed, refunded
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  callerIdx: index("idx_agent_calls_caller").on(table.callerDeploymentId),
  calleeIdx: index("idx_agent_calls_callee").on(table.calleeDeploymentId),
}));

// ── Agent Credits & Calls Relations ───────────────────────────────────

export const agentCreditsRelations = relations(agentCredits, ({ one }) => ({
  user: one(users, { fields: [agentCredits.userId], references: [users.id] }),
}));

export const agentCallsRelations = relations(agentCalls, ({ one }) => ({
  callerDeployment: one(deployments, { fields: [agentCalls.callerDeploymentId], references: [deployments.id] }),
  calleeDeployment: one(deployments, { fields: [agentCalls.calleeDeploymentId], references: [deployments.id] }),
}));

// ── Persona Templates ─────────────────────────────────────────────────────

export const personaTemplates = pgTable("persona_templates", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  category: varchar("category", { length: 64 }).notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  recommendedTools: text("recommended_tools"),
  defaultTheme: text("default_theme"),
  suggestedLlm: varchar("suggested_llm", { length: 255 }),
  icon: varchar("icon", { length: 32 }),
  exampleConversation: text("example_conversation"),
  showcasePrompts: text("showcase_prompts"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Orchestration Flows ──────────────────────────────────────────────────

export const orchestrationFlows = pgTable("orchestration_flows", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  definition: text("definition").notNull(),  // JSON: { nodes: FlowNode[], edges: FlowEdge[] }
  status: varchar("status", { length: 20 }).notNull().default("draft"),  // draft | published | archived
  isPublic: boolean("is_public").notNull().default(false),
  forkCount: integer("fork_count").notNull().default(0),
  forkedFromId: varchar("forked_from_id", { length: 255 }),
  entryNodeId: varchar("entry_node_id", { length: 255 }),
  teamType: varchar("team_type", { length: 20 }).notNull().default("hierarchy"),  // hierarchy | pipeline | collaborative
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_orch_flows_user_id").on(table.userId),
  statusIdx: index("idx_orch_flows_status").on(table.status),
  isPublicIdx: index("idx_orch_flows_is_public").on(table.isPublic),
}));

export const flowExecutions = pgTable("flow_executions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  flowId: varchar("flow_id", { length: 255 }).notNull().references(() => orchestrationFlows.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),  // pending | running | completed | failed | cancelled
  stepResults: text("step_results"),  // JSON: Record<string, { status, result, error, durationMs }>
  totalCreditsCharged: integer("total_credits_charged").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  flowIdIdx: index("idx_flow_exec_flow_id").on(table.flowId),
  userIdIdx: index("idx_flow_exec_user_id").on(table.userId),
  statusIdx: index("idx_flow_exec_status").on(table.status),
}));

// ── Managed Nodes (Auto-scaling) ─────────────────────────────────────────

export const managedNodes = pgTable("managed_nodes", {
  id: varchar("id", { length: 255 }).primaryKey(),
  hetznerServerId: integer("hetzner_server_id").notNull(),
  hetznerVolumeId: integer("hetzner_volume_id").notNull(),
  nodeName: varchar("node_name", { length: 255 }).notNull(),
  nodeIp: varchar("node_ip", { length: 45 }).notNull(),
  serverType: varchar("server_type", { length: 50 }).notNull().default("cpx21"),
  status: varchar("status", { length: 30 }).notNull().default("provisioning"),
  monthlyCostCents: integer("monthly_cost_cents").notNull().default(1220),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readyAt: timestamp("ready_at"),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  statusIdx: index("idx_managed_nodes_status").on(table.status),
  hetznerServerIdx: uniqueIndex("uq_managed_nodes_hetzner_server").on(table.hetznerServerId),
}));

// ── Orchestration Flow Relations ─────────────────────────────────────────

export const orchestrationFlowsRelations = relations(orchestrationFlows, ({ one, many }) => ({
  user: one(users, { fields: [orchestrationFlows.userId], references: [users.id] }),
  forkedFrom: one(orchestrationFlows, { fields: [orchestrationFlows.forkedFromId], references: [orchestrationFlows.id] }),
  executions: many(flowExecutions),
  memberships: many(flowDeploymentMemberships),
}));

export const flowExecutionsRelations = relations(flowExecutions, ({ one }) => ({
  flow: one(orchestrationFlows, { fields: [flowExecutions.flowId], references: [orchestrationFlows.id] }),
  user: one(users, { fields: [flowExecutions.userId], references: [users.id] }),
}));

// ── Deployment Subagents ──────────────────────────────────────────────────

export const deploymentSubagents = pgTable("deployment_subagents", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),  // auto-generated from name, unique per deployment
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  model: varchar("model", { length: 100 }),  // null = default AGENT_LLM_MODEL
  triggerType: varchar("trigger_type", { length: 20 }).notNull().default("manual"),  // manual | auto | conditional
  triggerConfig: text("trigger_config"),  // JSON
  tools: text("tools"),  // JSON array of allowed tool names, null = all
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  source: varchar("source", { length: 20 }).notNull().default("custom"),  // "custom" | "platform" | "delegation"
  isPublic: boolean("is_public").notNull().default(false),
  forkedFromId: varchar("forked_from_id", { length: 255 }),
  forkCount: integer("fork_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  deploymentIdIdx: index("idx_deployment_subagents_deployment_id").on(table.deploymentId),
  deploymentSlugIdx: uniqueIndex("uq_deployment_subagents_deployment_slug").on(table.deploymentId, table.slug),
  isPublicIdx: index("idx_deployment_subagents_is_public").on(table.isPublic),
}));

export const deploymentSubagentsRelations = relations(deploymentSubagents, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentSubagents.deploymentId], references: [deployments.id] }),
  forkedFrom: one(deploymentSubagents, { fields: [deploymentSubagents.forkedFromId], references: [deploymentSubagents.id] }),
}));

// ── Flow ↔ Deployment Memberships ────────────────────────────────────────
// Denormalized join table: efficiently query "which flows contain this deployment?"

export const flowDeploymentMemberships = pgTable("flow_deployment_memberships", {
  id: varchar("id", { length: 255 }).primaryKey(),
  flowId: varchar("flow_id", { length: 255 }).notNull().references(() => orchestrationFlows.id, { onDelete: "cascade" }),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  nodeId: varchar("node_id", { length: 255 }).notNull(),  // The node ID within the flow definition
  role: varchar("role", { length: 100 }),  // The node's role in the flow
  isEntryPoint: boolean("is_entry_point").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  flowDeploymentNodeIdx: uniqueIndex("uq_flow_deployment_node").on(table.flowId, table.deploymentId, table.nodeId),
  deploymentIdIdx: index("idx_flow_dep_membership_deployment_id").on(table.deploymentId),
  flowIdIdx: index("idx_flow_dep_membership_flow_id").on(table.flowId),
}));

export const flowDeploymentMembershipsRelations = relations(flowDeploymentMemberships, ({ one }) => ({
  flow: one(orchestrationFlows, { fields: [flowDeploymentMemberships.flowId], references: [orchestrationFlows.id] }),
  deployment: one(deployments, { fields: [flowDeploymentMemberships.deploymentId], references: [deployments.id] }),
}));
