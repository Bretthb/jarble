import { pgTable, varchar, text, integer, timestamp, boolean, serial, uniqueIndex, index, bigint, jsonb } from "drizzle-orm/pg-core";
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
  // Terms of Service + Privacy Policy acknowledgment gate.
  // Nullable by design: we do NOT backfill existing users. A null
  // tosAcceptedAt on an authenticated user is the signal that the
  // returning-user consent modal must block all navigation until they
  // accept. tosVersion captures which version of the terms they agreed
  // to so a future version bump can force re-acceptance without losing
  // the audit trail of the previous one.
  tosAcceptedAt: timestamp("tos_accepted_at"),
  tosVersion: varchar("tos_version", { length: 32 }),
  privacyAcceptedAt: timestamp("privacy_accepted_at"),
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
  visibility: varchar("visibility", { length: 20 }).default("all"),  // "all" = every org member sees it, "admin" = owner + admin only
  /**
   * JAR memory-scoping (foundation): how the bot's long-term memory layer
   * behaves across sessions. The actual enforcement of `session` mode lives
   * in the OpenClaw runtime handler + MCP server (separate follow-up PRs);
   * this column stores the user's choice and the chat surface displays a
   * disclosure banner derived from it. See
   * `docs/audits/memory-scoping-decision.md` for the design.
   *
   * Values:
   *   - "global"  (default) — current behavior, persists across sessions
   *                            and platforms (web/Telegram/Discord/etc.)
   *   - "session"            — bot is instructed to scope memories to the
   *                            current session id; Jarble MCP store
   *                            partitions store.json by session
   *   - "off"                — memory tools removed from the prompt; MCP
   *                            memory tools no-op
   */
  memoryScope: varchar("memory_scope", { length: 20 }).notNull().default("global"),
  /** Per-deployment delegation budget cap in cents. null = unlimited (falls back to global circuit breaker). */
  maxBudgetCents: integer("max_budget_cents"),
  /** Which flow/team is active for delegation when chatting. null = auto-detect (first membership). */
  activeFlowId: varchar("active_flow_id", { length: 255 }),
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

// Deployment secrets — generic key/value secrets stored by users or agents, injected as pod env vars
export const deploymentSecrets = pgTable("deployment_secrets", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 128 }).notNull(), // env var name, e.g. "MY_API_KEY"
  value: text("value").notNull(), // AES-256-GCM encrypted (server-side for shared/bot, client-side for user scope)
  source: varchar("source", { length: 20 }).notNull().default("user"), // "user" | "agent"
  /**
   * Credential scope:
   * - "shared" (default): both bot and user can access. Server-side encrypted. Injected as pod env var.
   * - "bot": only the bot can access. Server-side encrypted. Injected as pod env var but hidden from user dashboard.
   * - "user": user-only. Client-side encrypted with Web Crypto API. Server stores opaque blob it CANNOT decrypt. NOT injected into pod.
   */
  scope: varchar("scope", { length: 20 }).notNull().default("shared"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  deploymentKeyIdx: uniqueIndex("uq_deployment_secret_key").on(table.deploymentId, table.key),
}));

// Webhook idempotency tracking - stores processed webhook event IDs to prevent duplicate processing
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(), // Stripe event ID (e.g., evt_xxx)
  eventType: varchar("event_type", { length: 100 }).notNull(), // e.g., "checkout.session.completed"
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// Global skills marketplace catalog - all available skills across runtimes
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

// Join table - which skills are installed on which deployment
export const deploymentSkills = pgTable("deployment_skills", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull().references(() => deployments.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id", { length: 255 }).notNull().references(() => skillsCatalog.id),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
}, (table) => ({
  deploymentSkillIdx: uniqueIndex("uq_deployment_skill").on(table.deploymentId, table.skillId),
}));

// Flow chat persistence (team chat conversations)
export const flowChatSessions = pgTable("flow_chat_sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  flowId: varchar("flow_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull().default("Team Chat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const flowChatMessages = pgTable("flow_chat_messages", {
  id: varchar("id", { length: 255 }).primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(), // 'user', 'assistant', 'delegation_result', 'synthesis'
  content: text("content").notNull(),
  sourceNodeId: varchar("source_node_id", { length: 255 }), // which flow node produced this
  sourceDeploymentId: varchar("source_deployment_id", { length: 255 }), // which deployment
  delegationToolName: varchar("delegation_tool_name", { length: 255 }), // e.g. "delegate_to_specialist"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  deployments: many(deployments),
  orgMemberships: many(orgMembers),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  user: one(users, { fields: [deployments.userId], references: [users.id] }),
  org: one(organizations, { fields: [deployments.orgId], references: [organizations.id] }),
  runtimeCatalogEntry: one(runtimeCatalog, { fields: [deployments.runtimeCatalogId], references: [runtimeCatalog.id] }),
  platformCredentials: many(platformCredentials),
  subagents: many(deploymentSubagents),
  flowMemberships: many(flowDeploymentMemberships),
  deploymentSecrets: many(deploymentSecrets),
}));

export const deploymentSecretsRelations = relations(deploymentSecrets, ({ one }) => ({
  deployment: one(deployments, { fields: [deploymentSecrets.deploymentId], references: [deployments.id] }),
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



// ── Agent Calls Table ─────────────────────────────────────────────────

// Agent-to-agent call tracking + orchestration span store.
//
// This table has two hats:
//   1. Domain table — caller/callee/skill/status/credits for billing rollups
//      and the "who delegated to whom" audit trail. This is the shape that
//      already existed.
//   2. OpenTelemetry-compatible span store — adds trace_id / span_id /
//      parent_span_id / span_name / attributes so it can also power the
//      cross-pod delegation tree visualisation described in
//      `docs/audits/orchestration-observability-plan.md` without us having
//      to keep two tables in sync.
//
// Columns added in JAR-50 (Phase 1) for the observability rollout:
//   - parent_call_id, depth, kind   → fractal delegation topology
//   - trace_id, span_id, parent_span_id, span_name, span_kind, service_name
//   - pod_name, user_id, org_id     → filtering + per-user audit queries
//   - start_ns, end_ns, duration_ms → high-res timing for debug drawer
//   - status_code, attributes       → OTel-compatible span shape
//
// Root span rows (one per user chat turn) carry parent_span_id = NULL and
// may also carry a null callee_deployment_id when the root hasn't delegated
// yet — that's why both caller/callee were loosened to nullable. Existing
// readers already handle the row and only care about non-null cases.
export const agentCalls = pgTable("agent_calls", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => generateMarketplaceId("acl")),
  callerDeploymentId: varchar("caller_deployment_id", { length: 255 }).references(() => deployments.id),
  calleeDeploymentId: varchar("callee_deployment_id", { length: 255 }).references(() => deployments.id),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, completed, failed, refunded
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  // ── Fractal delegation topology (aligned with feature/fractal-n-level-delegation) ──
  parentCallId: varchar("parent_call_id", { length: 40 }),
  depth: integer("depth").notNull().default(0),
  kind: varchar("kind", { length: 16 }).notNull().default("delegation"), // delegation | chat_turn | tool | flow_step | llm

  // ── OpenTelemetry span identity ──
  traceId: varchar("trace_id", { length: 32 }),
  spanId: varchar("span_id", { length: 16 }),
  parentSpanId: varchar("parent_span_id", { length: 16 }),
  spanName: varchar("span_name", { length: 128 }),
  spanKind: varchar("span_kind", { length: 24 }).notNull().default("internal"),
  serviceName: varchar("service_name", { length: 64 }),
  podName: varchar("pod_name", { length: 128 }),

  // ── Audit / filter fields ──
  userId: varchar("user_id", { length: 255 }),
  orgId: varchar("org_id", { length: 255 }),
  sessionId: varchar("session_id", { length: 255 }),

  // ── Timing (Phase 1 uses milliseconds; Phase 2 OTel may add _ns columns later) ──
  startMs: bigint("start_ms", { mode: "number" }),
  endMs: bigint("end_ms", { mode: "number" }),
  durationMs: integer("duration_ms"),

  // ── OTel-compatible span status + attribute bag ──
  statusCode: varchar("status_code", { length: 8 }).notNull().default("ok"), // ok | error
  attributes: jsonb("attributes").notNull().default({}),
}, (table) => ({
  callerIdx: index("idx_agent_calls_caller").on(table.callerDeploymentId),
  calleeIdx: index("idx_agent_calls_callee").on(table.calleeDeploymentId),
  parentCallIdx: index("idx_agent_calls_parent_call_id").on(table.parentCallId),
  traceIdx: index("idx_agent_calls_trace_id").on(table.traceId),
  traceParentIdx: index("idx_agent_calls_trace_parent").on(table.traceId, table.parentSpanId),
  parentSpanIdx: index("idx_agent_calls_parent_span_id").on(table.parentSpanId),
  userStartIdx: index("idx_agent_calls_user_start").on(table.userId, table.startMs),
  spanNameStartIdx: index("idx_agent_calls_span_name_start").on(table.spanName, table.startMs),
  spanIdUniqueIdx: uniqueIndex("uq_agent_calls_span_id").on(table.spanId),
}));

// ── Agent Calls Relations ─────────────────────────────────────────────

export const agentCallsRelations = relations(agentCalls, ({ one }) => ({
  callerDeployment: one(deployments, { fields: [agentCalls.callerDeploymentId], references: [deployments.id] }),
  calleeDeployment: one(deployments, { fields: [agentCalls.calleeDeploymentId], references: [deployments.id] }),
  parentCall: one(agentCalls, { fields: [agentCalls.parentCallId], references: [agentCalls.id], relationName: "parentChild" }),
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

// ── Lifecycle Jobs (Durable async work queue for deploy/start/restart) ───
//
// Replaces fire-and-forget IIFEs in the deployment router. Each row represents
// a durable unit of K8s lifecycle work — "create", "start", or "restart" —
// that must survive API pod restarts. A background worker polls the queue,
// picks up pending jobs with SELECT ... FOR UPDATE SKIP LOCKED, and runs the
// readiness-poll state machine. Failures are retried with exponential backoff
// up to `maxAttempts`.
export const lifecycleJobs = pgTable("lifecycle_jobs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // "create" | "start" | "restart"
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | running | completed | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  // Opaque JSON payload of pre-computed inputs (initialConfigs, secret entries,
  // gateway token, managedBy, deployConfig). For `start`/`restart` jobs the
  // worker can reconstruct most fields from the deployment row; for `create`
  // we persist the rendered configs + gateway token so they are not lost on
  // crash.
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  runAfter: timestamp("run_after").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  pollingIdx: index("idx_lifecycle_jobs_status_run_after").on(table.status, table.runAfter),
  deploymentIdx: index("idx_lifecycle_jobs_deployment_id").on(table.deploymentId),
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

// ── Organizations ─────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  ownerId: varchar("owner_id", { length: 255 }).notNull().references(() => users.id),
  avatarUrl: varchar("avatar_url", { length: 512 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  billingEmail: varchar("billing_email", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orgMembers = pgTable("org_members", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orgId: varchar("org_id", { length: 255 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  role: varchar("role", { length: 20 }).notNull().default("member"),  // "owner" | "admin" | "member"
  invitedBy: varchar("invited_by", { length: 255 }).references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  orgUserIdx: uniqueIndex("uq_org_member_user").on(table.orgId, table.userId),
}));

export const orgInvites = pgTable("org_invites", {
  id: varchar("id", { length: 255 }).primaryKey(),
  orgId: varchar("org_id", { length: 255 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  token: varchar("token", { length: 255 }).notNull().unique(),
  invitedBy: varchar("invited_by", { length: 255 }).notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),  // "pending" | "accepted" | "expired"
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgEmailIdx: uniqueIndex("uq_org_invite_email").on(table.orgId, table.email),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members: many(orgMembers),
  invites: many(orgInvites),
  deployments: many(deployments),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(organizations, { fields: [orgMembers.orgId], references: [organizations.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
  invitedByUser: one(users, { fields: [orgMembers.invitedBy], references: [users.id] }),
}));

export const orgInvitesRelations = relations(orgInvites, ({ one }) => ({
  org: one(organizations, { fields: [orgInvites.orgId], references: [organizations.id] }),
  invitedByUser: one(users, { fields: [orgInvites.invitedBy], references: [users.id] }),
}));

export const flowChatSessionsRelations = relations(flowChatSessions, ({ many }) => ({
  messages: many(flowChatMessages),
}));

export const flowChatMessagesRelations = relations(flowChatMessages, ({ one }) => ({
  session: one(flowChatSessions, { fields: [flowChatMessages.sessionId], references: [flowChatSessions.id] }),
}));

// ── Promo Codes ─────────────────────────────────────────────────────────

export const promoCodes = pgTable("promo_codes", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => `promo_${alphanumeric()}`),
  code: varchar("code", { length: 50 }).notNull().unique(),
  discountType: varchar("discount_type", { length: 20 }).notNull().default("fixed"),
  discountAmount: integer("discount_amount").notNull(),
  maxUses: integer("max_uses"),
  maxUsesPerUser: integer("max_uses_per_user").notNull().default(1),
  currentUses: integer("current_uses").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  active: boolean("active").notNull().default(true),
  createdBy: varchar("created_by", { length: 255 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promoRedemptions = pgTable("promo_redemptions", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => `red_${alphanumeric()}`),
  promoCodeId: varchar("promo_code_id", { length: 255 }).notNull().references(() => promoCodes.id),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  deploymentId: varchar("deployment_id", { length: 255 }).references(() => deployments.id),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});

// ── Team Files ──────────────────────────────────────────────────────────
// Metadata tracking for S3-backed files shared between team members.
// S3 is source of truth for content; DB tracks metadata for queries.

export const teamFiles = pgTable("team_files", {
  id: varchar("id", { length: 255 }).primaryKey(),
  flowId: varchar("flow_id", { length: 255 }).notNull(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }),
  sizeBytes: integer("size_bytes").notNull(),
  s3Key: varchar("s3_key", { length: 1000 }).notNull(),
  uploadedByDeploymentId: varchar("uploaded_by_deployment_id", { length: 255 }),
  uploadedByNodeId: varchar("uploaded_by_node_id", { length: 255 }),
  userId: varchar("user_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => ({
  flowSessionIdx: index("idx_team_files_flow_session").on(table.flowId, table.sessionId),
  userIdx: index("idx_team_files_user").on(table.userId),
}));

// ── Announcements ───────────────────────────────────────────────────────
// Site-wide banners published by admins. One active announcement shows
// at a time; front-end renders on every authenticated page.

export const announcements = pgTable("announcements", {
  id: varchar("id", { length: 255 }).primaryKey().$defaultFn(() => `ann_${alphanumeric()}`),
  message: varchar("message", { length: 280 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("info"),
  active: boolean("active").notNull().default(true),
  dismissible: boolean("dismissible").notNull().default(true),
  audience: varchar("audience", { length: 20 }).notNull().default("all"),
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  createdBy: varchar("created_by", { length: 255 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
