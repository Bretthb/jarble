import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
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
  role: text("role").notNull().default("user"),
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
  deploymentType: text("deployment_type").notNull().default("agent"), // "agent" | "container" | "website" — determines K8s scheduling
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
  messagingOnly: integer("messaging_only", { mode: "boolean" }).notNull().default(false),
  managedBy: text("managed_by").notNull().default("legacy"),  // "legacy" | "operator"
  isolationLevel: text("isolation_level").notNull().default("standard"),  // "standard" | "gvisor" | "kata"
  isPlatform: integer("is_platform", { mode: "boolean" }).notNull().default(false),  // Platform-owned agent (bypasses subscription/storage enforcement)
  resourceTier: text("resource_tier"),  // Named resource preset: "small" | "medium" | "large"
  themeConfig: text("theme_config"),  // JSON ThemeConfig — per-deployment custom theme
  // Fork & public profile fields
  forkedFromId: text("forked_from_id"),  // Source deployment ID (null = original)
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  forkCount: integer("fork_count").notNull().default(0),
  featuredAt: text("featured_at"),  // Non-null = featured in explore gallery
  specialties: text("specialties"),  // JSON array of domain slugs
  bio: text("bio"),  // Public description of what this bot does
  showcasePrompts: text("showcase_prompts"),  // JSON array of example prompts
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  userIdIdx: index("idx_deployments_user_id").on(table.userId),
  statusIdx: index("idx_deployments_status").on(table.status),
  isPublicIdx: index("idx_deployments_is_public").on(table.isPublic),
}));

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
  isPlatform: integer("is_platform", { mode: "boolean" }).notNull().default(false),
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
  statusIdx: index("idx_marketplace_components_status").on(table.status),
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


// ── Package Tables ────────────────────────────────────────────────────────

export const marketplaceServices = sqliteTable("marketplace_packages", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pkg")),
  creatorId: text("creator_id").notNull().references(() => creatorProfiles.id),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  hostingModel: text("hosting_model").notNull(),
  instructionSnippet: text("instruction_snippet"),
  remoteApiEndpoint: text("remote_api_endpoint"),
  remoteApiConfig: text("remote_api_config"),       // JSON PackageCard for remote/hybrid
  remoteHealth: text("remote_health").default("unknown"), // healthy | degraded | offline | unknown
  remoteLastCheck: text("remote_last_check"),
  creatorDeploymentId: text("creator_deployment_id"),  // links service to creator's deployment for skill execution
  status: text("status").notNull().default("draft"),
  pricingModel: text("pricing_model").notNull().default("free"),
  priceUsdCents: integer("price_usd_cents").notNull().default(0),
  isPlatform: integer("is_platform", { mode: "boolean" }).notNull().default(false),
  totalInstalls: integer("total_installs").notNull().default(0),
  avgRating: text("avg_rating"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  creatorPackageNameIdx: uniqueIndex("uq_creator_package_name").on(table.creatorId, table.name),
}));

export const serviceComponents = sqliteTable("package_components", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pkc")),
  packageId: text("package_id").notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id),
}, (table) => ({
  packageComponentIdx: uniqueIndex("uq_package_component").on(table.packageId, table.componentId),
}));

export const serviceSkills = sqliteTable("package_skills", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pks")),
  packageId: text("package_id").notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skillsCatalog.id),
}, (table) => ({
  packageSkillIdx: uniqueIndex("uq_package_skill").on(table.packageId, table.skillId),
}));

export const serviceInstalls = sqliteTable("package_installs", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pki")),
  packageId: text("package_id").notNull().references(() => marketplaceServices.id),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  installedAt: text("installed_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentPackageIdx: uniqueIndex("uq_deployment_package").on(table.deploymentId, table.packageId),
}));

// Stores HMAC signing secrets and handshake state for remote/hybrid package installs
export const serviceCredentials = sqliteTable("package_credentials", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pkc")),
  packageInstallId: text("package_install_id").notNull().references(() => serviceInstalls.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull().references(() => marketplaceServices.id),
  signingSecret: text("signing_secret").notNull(), // Encrypted HMAC-SHA256 signing secret
  previousSigningSecret: text("previous_signing_secret"), // Previous secret, accepted during grace period
  previousSecretExpiresAt: text("previous_secret_expires_at"), // ISO 8601 — after this, only new secret is accepted
  handshakeStatus: text("handshake_status").notNull().default("pending"), // "pending" | "completed" | "failed"
  handshakeError: text("handshake_error"),
  remoteInstallId: text("remote_install_id"), // ID returned by creator's endpoint
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentPackageCredIdx: uniqueIndex("uq_deployment_package_cred").on(table.deploymentId, table.packageId),
}));

// ── Persona Templates ─────────────────────────────────────────────────────

export const personaTemplates = sqliteTable("persona_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(), // "general" | "business" | "technical" | "creative" | "education"
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  recommendedTools: text("recommended_tools"), // JSON array of tool names
  defaultTheme: text("default_theme"), // JSON ThemeConfig
  suggestedLlm: text("suggested_llm"), // e.g. "claude-sonnet-4-20250514"
  icon: text("icon"), // emoji or icon name
  exampleConversation: text("example_conversation"), // JSON array of example messages
  showcasePrompts: text("showcase_prompts"), // JSON array of example user prompts
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

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
}));

// ── Chat History Tables ───────────────────────────────────────────────────

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  thinkingText: text("thinking_text"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// ── Audit Logs ──────────────────────────────────────────────────────────

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: text("metadata"),
  ipAddress: text("ip_address"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const betaSignups = sqliteTable("beta_signups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  experience: text("experience"),
  useCase: text("use_case"),
  status: text("status").notNull().default("pending"),
  invitedAt: text("invited_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// ── Orchestration Flows ──────────────────────────────────────────────────

export const orchestrationFlows = sqliteTable("orchestration_flows", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  definition: text("definition").notNull(),  // JSON: { nodes: FlowNode[], edges: FlowEdge[] }
  status: text("status").notNull().default("draft"),  // draft | published | archived
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  forkCount: integer("fork_count").notNull().default(0),
  forkedFromId: text("forked_from_id"),
  entryNodeId: text("entry_node_id"),
  teamType: text("team_type").notNull().default("hierarchy"),  // hierarchy | pipeline | collaborative
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  userIdIdx: index("idx_orch_flows_user_id").on(table.userId),
  statusIdx: index("idx_orch_flows_status").on(table.status),
  isPublicIdx: index("idx_orch_flows_is_public").on(table.isPublic),
}));

export const flowExecutions = sqliteTable("flow_executions", {
  id: text("id").primaryKey(),
  flowId: text("flow_id").notNull().references(() => orchestrationFlows.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),  // pending | running | completed | failed | cancelled
  stepResults: text("step_results"),  // JSON: Record<string, { status, result, error, durationMs }>
  totalCreditsCharged: integer("total_credits_charged").notNull().default(0),
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  flowIdIdx: index("idx_flow_exec_flow_id").on(table.flowId),
  userIdIdx: index("idx_flow_exec_user_id").on(table.userId),
  statusIdx: index("idx_flow_exec_status").on(table.status),
}));

// ── Orchestration Flow Relations ─────────────────────────────────────────

export const orchestrationFlowsRelations = relations(orchestrationFlows, ({ one, many }) => ({
  user: one(users, { fields: [orchestrationFlows.userId], references: [users.id] }),
  forkedFrom: one(orchestrationFlows, { fields: [orchestrationFlows.forkedFromId], references: [orchestrationFlows.id] }),
  executions: many(flowExecutions),
}));

export const flowExecutionsRelations = relations(flowExecutions, ({ one }) => ({
  flow: one(orchestrationFlows, { fields: [flowExecutions.flowId], references: [orchestrationFlows.id] }),
  user: one(users, { fields: [flowExecutions.userId], references: [users.id] }),
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
export const serviceUsage = sqliteTable("package_usage", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("pku")),
  packageInstallId: text("package_install_id").notNull().references(() => serviceInstalls.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull(),
  packageId: text("package_id").notNull(),
  skillName: text("skill_name").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  billingCycleStart: text("billing_cycle_start").notNull(), // ISO date, first of month
  recordedAt: text("recorded_at").notNull().$defaultFn(now),
});

export const serviceUsageRelations = relations(serviceUsage, ({ one }) => ({
  packageInstall: one(serviceInstalls, { fields: [serviceUsage.packageInstallId], references: [serviceInstalls.id] }),
}));

// ── Service Proxy Resilience Tables ────────────────────────────────────────

// Per-deployment+service rate limit counters (shared across API replicas)
export const serviceRateLimits = sqliteTable("service_rate_limits", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("srl")),
  deploymentId: text("deployment_id").notNull(),
  serviceId: text("service_id").notNull(),
  windowType: text("window_type").notNull(), // "minute" | "day"
  windowStart: text("window_start").notNull(), // Unix ms as string
  count: integer("count").notNull().default(0),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentServiceWindowIdx: uniqueIndex("uq_srl_deployment_service_window").on(
    table.deploymentId, table.serviceId, table.windowType, table.windowStart,
  ),
}));

// Per-service circuit breaker state (shared across API replicas)
export const serviceCircuitBreakers = sqliteTable("service_circuit_breakers", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("scb")),
  serviceId: text("service_id").notNull().unique(),
  state: text("state").notNull().default("CLOSED"), // CLOSED | OPEN | HALF_OPEN
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastFailureAt: text("last_failure_at"), // Unix ms as string
  openedAt: text("opened_at"), // Unix ms as string
  halfOpenClaimedBy: text("half_open_claimed_by"), // Replica ID
  halfOpenClaimedAt: text("half_open_claimed_at"), // Unix ms, 30s timeout
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

// Push-based heartbeat records from creator services
export const serviceHeartbeats = sqliteTable("service_heartbeats", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("shb")),
  serviceId: text("service_id").notNull().unique(),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull().default(60000),
  payload: text("payload"), // JSON metadata
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

// API keys for external agent/mesh access
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("ak")),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(), // Human-readable label (e.g. "My Python Script")
  keyHash: text("key_hash").notNull().unique(), // SHA-256 hash of the key (key itself never stored)
  keyPrefix: text("key_prefix").notNull(), // First 8 chars of key for identification (e.g. "jrbl_abc1")
  scopes: text("scopes").notNull().default("mesh:read,mesh:write"), // Comma-separated scope list
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  rateLimitPerDay: integer("rate_limit_per_day").notNull().default(10000),
  lastUsedAt: text("last_used_at"),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: text("expires_at"), // Optional expiration (ISO string)
  revokedAt: text("revoked_at"), // Non-null = revoked
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  userIdIdx: index("idx_api_keys_user_id").on(table.userId),
  keyHashIdx: uniqueIndex("idx_api_keys_key_hash").on(table.keyHash),
}));

// Async job queue for long-running skill executions
export const serviceAsyncJobs = sqliteTable("service_async_jobs", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("sjb")),
  deploymentId: text("deployment_id").notNull(),
  serviceId: text("service_id").notNull(),
  skillName: text("skill_name").notNull(),
  status: text("status").notNull().default("pending"), // pending | completed | failed
  requestBody: text("request_body").notNull(), // JSON
  responseBody: text("response_body"), // JSON
  responseStatus: integer("response_status"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  completedAt: text("completed_at"),
  expiresAt: text("expires_at").notNull(),
}, (table) => ({
  deploymentIdIdx: index("idx_service_async_jobs_deployment_id").on(table.deploymentId),
  expiresAtIdx: index("idx_service_async_jobs_expires_at").on(table.expiresAt),
}));

// ── Domain Taxonomy & Benchmark Tables ────────────────────────────────────

// Hierarchical domain categories for deployment specialization
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("dom")),
  name: text("name").notNull(),  // slug: "stock-analysis"
  displayName: text("display_name").notNull(),
  description: text("description"),
  parentId: text("parent_id"),  // self-ref, null = root category
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  parentIdx: index("idx_domains_parent").on(table.parentId),
  nameIdx: uniqueIndex("uq_domains_name").on(table.name),
}));

// Per-user ratings of deployments within a domain
export const deploymentRatings = sqliteTable("deployment_ratings", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("drt")),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  domainId: text("domain_id").notNull().references(() => domains.id),
  userId: text("user_id").notNull().references(() => users.id),
  accuracy: integer("accuracy").notNull(),  // 1-5
  helpfulness: integer("helpfulness").notNull(),  // 1-5
  creativity: integer("creativity").notNull(),  // 1-5
  comment: text("comment"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  userDeploymentDomainIdx: uniqueIndex("uq_deployment_rating").on(table.userId, table.deploymentId, table.domainId),
  deploymentDomainIdx: index("idx_drt_deployment_domain").on(table.deploymentId, table.domainId),
}));

// Materialized aggregate scores per deployment+domain (recomputed on new rating)
export const deploymentDomainScores = sqliteTable("deployment_domain_scores", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("dds")),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  domainId: text("domain_id").notNull().references(() => domains.id),
  avgAccuracy: integer("avg_accuracy"),  // 100-500 scaled (e.g. 425 = 4.25)
  avgHelpfulness: integer("avg_helpfulness"),
  avgCreativity: integer("avg_creativity"),
  overallScore: integer("overall_score"),  // avg of the three, scaled 100-500
  ratingCount: integer("rating_count").notNull().default(0),
  confidence: text("confidence").notNull().default("low"),  // "low" | "medium" | "high"
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentDomainIdx: uniqueIndex("uq_dds_deployment_domain").on(table.deploymentId, table.domainId),
  domainScoreIdx: index("idx_dds_domain_score").on(table.domainId, table.overallScore),
}));

// Raw benchmark samples from service proxy calls (~5% sampling)
export const serviceBenchmarkSamples = sqliteTable("service_benchmark_samples", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("sbs")),
  serviceId: text("service_id").notNull(),
  skillName: text("skill_name").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  statusCode: integer("status_code").notNull(),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  responseSizeBytes: integer("response_size_bytes"),
  sampledAt: text("sampled_at").notNull().$defaultFn(now),
}, (table) => ({
  serviceSkillIdx: index("idx_sbs_service_skill").on(table.serviceId, table.skillName),
  sampledAtIdx: index("idx_sbs_sampled_at").on(table.sampledAt),
}));

// Materialized aggregate metrics per service+skill+period
export const serviceBenchmarkAggregates = sqliteTable("service_benchmark_aggregates", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("sba")),
  serviceId: text("service_id").notNull(),
  skillName: text("skill_name").notNull(),
  period: text("period").notNull(),  // "24h" | "7d" | "30d"
  latencyP50: integer("latency_p50"),
  latencyP95: integer("latency_p95"),
  latencyP99: integer("latency_p99"),
  uptimePercent: integer("uptime_percent"),  // 0-10000 scaled (e.g. 9975 = 99.75%)
  errorRate: integer("error_rate"),  // 0-10000 scaled
  avgResponseSize: integer("avg_response_size"),
  sampleCount: integer("sample_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  serviceSkillPeriodIdx: uniqueIndex("uq_sba_service_skill_period").on(table.serviceId, table.skillName, table.period),
}));

// Service reviews (mirrors componentReviews)
export const serviceReviews = sqliteTable("service_reviews", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("srv")),
  serviceId: text("service_id").notNull().references(() => marketplaceServices.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),  // 1-5
  title: text("title"),
  body: text("body"),
  creatorResponse: text("creator_response"),
  creatorRespondedAt: text("creator_responded_at"),
  helpful: integer("helpful").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
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
export const agentCredits = sqliteTable("agent_credits", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("acr")),
  userId: text("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),        // positive = credit, negative = debit
  balance: integer("balance").notNull(),       // running balance after this transaction
  reason: text("reason").notNull(),            // "purchase", "agent_call", "earnings", "refund"
  reference: text("reference"),                // stripe payment ID, call ID, etc.
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  userIdIdx: index("idx_agent_credits_user_id").on(table.userId),
}));

// Agent-to-agent call tracking
export const agentCalls = sqliteTable("agent_calls", {
  id: text("id").primaryKey().$defaultFn(() => generateMarketplaceId("acl")),
  callerDeploymentId: text("caller_deployment_id").notNull().references(() => deployments.id),
  calleeDeploymentId: text("callee_deployment_id").notNull().references(() => deployments.id),
  skillName: text("skill_name").notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending, completed, failed, refunded
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  callerIdx: index("idx_agent_calls_caller").on(table.callerDeploymentId),
  calleeIdx: index("idx_agent_calls_callee").on(table.calleeDeploymentId),
}));

// ── Managed Nodes (Auto-scaling) ─────────────────────────────────────────

export const managedNodes = sqliteTable("managed_nodes", {
  id: text("id").primaryKey(),
  hetznerServerId: integer("hetzner_server_id").notNull(),
  hetznerVolumeId: integer("hetzner_volume_id").notNull(),
  nodeName: text("node_name").notNull(),
  nodeIp: text("node_ip").notNull(),
  serverType: text("server_type").notNull().default("cpx21"),
  status: text("status").notNull().default("provisioning"),
  monthlyCostCents: integer("monthly_cost_cents").notNull().default(1220),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  readyAt: text("ready_at"),
  deletedAt: text("deleted_at"),
}, (table) => ({
  statusIdx: index("idx_managed_nodes_status").on(table.status),
  hetznerServerIdx: uniqueIndex("uq_managed_nodes_hetzner_server").on(table.hetznerServerId),
}));

// ── Agent Credits & Calls Relations ───────────────────────────────────

export const agentCreditsRelations = relations(agentCredits, ({ one }) => ({
  user: one(users, { fields: [agentCredits.userId], references: [users.id] }),
}));

export const agentCallsRelations = relations(agentCalls, ({ one }) => ({
  callerDeployment: one(deployments, { fields: [agentCalls.callerDeploymentId], references: [deployments.id] }),
  calleeDeployment: one(deployments, { fields: [agentCalls.calleeDeploymentId], references: [deployments.id] }),
}));

// ── Deployment Subagents ──────────────────────────────────────────────────

export const deploymentSubagents = sqliteTable("deployment_subagents", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),  // auto-generated from name, unique per deployment
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model"),  // null = default AGENT_LLM_MODEL
  triggerType: text("trigger_type").notNull().default("manual"),  // manual | auto | conditional
  triggerConfig: text("trigger_config"),  // JSON
  tools: text("tools"),  // JSON array of allowed tool names, null = all
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  forkedFromId: text("forked_from_id"),
  forkCount: integer("fork_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentIdIdx: index("idx_deployment_subagents_deployment_id").on(table.deploymentId),
  deploymentSlugIdx: uniqueIndex("uq_deployment_subagents_deployment_slug").on(table.deploymentId, table.slug),
  isPublicIdx: index("idx_deployment_subagents_is_public").on(table.isPublic),
}));

export const deploymentSubagentsRelations = relations(deploymentSubagents, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentSubagents.deploymentId], references: [deployments.id] }),
  forkedFrom: one(deploymentSubagents, { fields: [deploymentSubagents.forkedFromId], references: [deploymentSubagents.id] }),
}));
