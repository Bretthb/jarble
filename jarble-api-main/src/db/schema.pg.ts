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
  deploymentType: varchar("deployment_type", { length: 20 }).notNull().default("agent"), // "agent" | "container" | "website" - determines K8s scheduling
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
  // Status enum (Wave 4 Layer B — granular per-step lifecycle):
  //   pending | creating | provisioning_node | waiting_volume | pulling_image |
  //   initializing | running | restarting | reloading | stopping | stopped | failed
  // Validated by Zod at the router layer (admin.ts deploymentStatusEnum). Plain
  // varchar(50) here so we can add new transitional values without a migration.
  status: varchar("status", { length: 50 }).notNull().default("creating"),
  error: text("error"),
  messagingOnly: boolean("messaging_only").notNull().default(false),
  managedBy: varchar("managed_by", { length: 20 }).notNull().default("legacy"),  // "legacy" | "operator"
  isolationLevel: varchar("isolation_level", { length: 20 }).notNull().default("standard"),  // "standard" | "gvisor" | "kata"
  isPlatform: boolean("is_platform").notNull().default(false),  // Platform-owned agent (bypasses subscription/storage enforcement)
  resourceTier: varchar("resource_tier", { length: 20 }),  // Named resource preset: "small" | "medium" | "large"
  themeConfig: text("theme_config"),  // JSON ThemeConfig - per-deployment custom theme
  // Fork & public profile fields
  forkedFromId: varchar("forked_from_id", { length: 255 }),
  isPublic: boolean("is_public").notNull().default(false),
  forkCount: integer("fork_count").notNull().default(0),
  featuredAt: timestamp("featured_at"),
  specialties: text("specialties"),  // JSON array of domain slugs
  bio: text("bio"),
  showcasePrompts: text("showcase_prompts"),  // JSON array of example prompts
  orgId: varchar("org_id", { length: 255 }),  // null = personal deployment, non-null = org-owned
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_deployments_user_id").on(table.userId),
  statusIdx: index("idx_deployments_status").on(table.status),
  isPublicIdx: index("idx_deployments_is_public").on(table.isPublic),
  orgIdIdx: index("idx_deployments_org_id").on(table.orgId),
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

// PLACEHOLDER: actual push failed