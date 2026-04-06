CREATE TABLE "agent_calls" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"caller_deployment_id" varchar(255) NOT NULL,
	"callee_deployment_id" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"request_body" text,
	"response_body" text,
	"latency_ms" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"scopes" varchar(500) DEFAULT 'mesh:read,mesh:write' NOT NULL,
	"rate_limit_per_min" integer DEFAULT 60 NOT NULL,
	"rate_limit_per_day" integer DEFAULT 10000 NOT NULL,
	"last_used_at" timestamp,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "deployment_domain_scores" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"avg_accuracy" integer,
	"avg_helpfulness" integer,
	"avg_creativity" integer,
	"overall_score" integer,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"confidence" varchar(10) DEFAULT 'low' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_ratings" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"accuracy" integer NOT NULL,
	"helpfulness" integer NOT NULL,
	"creativity" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_secrets" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"source" varchar(20) DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_subagents" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"model" varchar(100),
	"trigger_type" varchar(20) DEFAULT 'manual' NOT NULL,
	"trigger_config" text,
	"tools" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" varchar(20) DEFAULT 'custom' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"forked_from_id" varchar(255),
	"fork_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"parent_id" varchar(255),
	"icon" varchar(100),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_chat_messages" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"source_node_id" varchar(255),
	"source_deployment_id" varchar(255),
	"delegation_tool_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_chat_sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"flow_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(255) DEFAULT 'Team Chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_deployment_memberships" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"flow_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"node_id" varchar(255) NOT NULL,
	"role" varchar(100),
	"is_entry_point" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_executions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"flow_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"step_results" text,
	"total_credits_charged" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_nodes" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"hetzner_server_id" integer NOT NULL,
	"hetzner_volume_id" integer NOT NULL,
	"node_name" varchar(255) NOT NULL,
	"node_ip" varchar(45) NOT NULL,
	"server_type" varchar(50) DEFAULT 'cpx21' NOT NULL,
	"status" varchar(30) DEFAULT 'provisioning' NOT NULL,
	"monthly_cost_cents" integer DEFAULT 1220 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "marketplace_packages" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"creator_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"hosting_model" varchar(20) NOT NULL,
	"instruction_snippet" text,
	"remote_api_endpoint" varchar(500),
	"remote_api_config" text,
	"remote_health" varchar(20) DEFAULT 'unknown',
	"remote_last_check" timestamp,
	"creator_deployment_id" varchar(255),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"pricing_model" varchar(20) DEFAULT 'free' NOT NULL,
	"price_usd_cents" integer DEFAULT 0 NOT NULL,
	"is_platform" boolean DEFAULT false NOT NULL,
	"total_installs" integer DEFAULT 0 NOT NULL,
	"avg_rating" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_flows" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"definition" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"fork_count" integer DEFAULT 0 NOT NULL,
	"forked_from_id" varchar(255),
	"entry_node_id" varchar(255),
	"team_type" varchar(20) DEFAULT 'hierarchy' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"org_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"token" varchar(255) NOT NULL,
	"invited_by" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"org_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"invited_by" varchar(255),
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	"avatar_url" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "persona_templates" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"category" varchar(64) NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"recommended_tools" text,
	"default_theme" text,
	"suggested_llm" varchar(255),
	"icon" varchar(32),
	"example_conversation" text,
	"showcase_prompts" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "service_async_jobs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"request_body" text NOT NULL,
	"response_body" text,
	"response_status" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_benchmark_aggregates" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"period" varchar(10) NOT NULL,
	"latency_p50" integer,
	"latency_p95" integer,
	"latency_p99" integer,
	"uptime_percent" integer,
	"error_rate" integer,
	"avg_response_size" integer,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_benchmark_samples" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"latency_ms" integer NOT NULL,
	"status_code" integer NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"response_size_bytes" integer,
	"sampled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_circuit_breakers" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"state" varchar(20) DEFAULT 'CLOSED' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_failure_at" varchar(20),
	"opened_at" varchar(20),
	"half_open_claimed_by" varchar(255),
	"half_open_claimed_at" varchar(20),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_circuit_breakers_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
CREATE TABLE "package_components" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"package_id" varchar(255) NOT NULL,
	"component_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"package_install_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"package_id" varchar(255) NOT NULL,
	"signing_secret" text NOT NULL,
	"previous_signing_secret" text,
	"previous_secret_expires_at" timestamp,
	"handshake_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"handshake_error" text,
	"remote_install_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"last_heartbeat_at" timestamp NOT NULL,
	"heartbeat_interval_ms" integer DEFAULT 60000 NOT NULL,
	"payload" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_heartbeats_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
CREATE TABLE "package_installs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"package_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_rate_limits" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"window_type" varchar(10) NOT NULL,
	"window_start" varchar(20) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_reviews" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"rating" integer NOT NULL,
	"title" varchar(255),
	"body" text,
	"creator_response" text,
	"creator_responded_at" timestamp,
	"helpful" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_skills" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"package_id" varchar(255) NOT NULL,
	"skill_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_usage" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"package_install_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"package_id" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"billing_cycle_start" varchar(10) NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "llm_api_key" SET DATA TYPE varchar(512);--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "is_platform" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "deployment_type" varchar(20) DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "managed_by" varchar(20) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "isolation_level" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "is_platform" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "resource_tier" varchar(20);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "theme_config" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "forked_from_id" varchar(255);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "fork_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "featured_at" timestamp;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "specialties" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "showcase_prompts" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "org_id" varchar(255);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_caller_deployment_id_deployments_id_fk" FOREIGN KEY ("caller_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_callee_deployment_id_deployments_id_fk" FOREIGN KEY ("callee_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_domain_scores" ADD CONSTRAINT "deployment_domain_scores_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_domain_scores" ADD CONSTRAINT "deployment_domain_scores_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_ratings" ADD CONSTRAINT "deployment_ratings_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_ratings" ADD CONSTRAINT "deployment_ratings_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_ratings" ADD CONSTRAINT "deployment_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_secrets" ADD CONSTRAINT "deployment_secrets_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_subagents" ADD CONSTRAINT "deployment_subagents_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_deployment_memberships" ADD CONSTRAINT "flow_deployment_memberships_flow_id_orchestration_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."orchestration_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_deployment_memberships" ADD CONSTRAINT "flow_deployment_memberships_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_id_orchestration_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."orchestration_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_packages" ADD CONSTRAINT "marketplace_packages_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_flows" ADD CONSTRAINT "orchestration_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_components" ADD CONSTRAINT "package_components_package_id_marketplace_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."marketplace_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_components" ADD CONSTRAINT "package_components_component_id_marketplace_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."marketplace_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_credentials" ADD CONSTRAINT "package_credentials_package_install_id_package_installs_id_fk" FOREIGN KEY ("package_install_id") REFERENCES "public"."package_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_credentials" ADD CONSTRAINT "package_credentials_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_credentials" ADD CONSTRAINT "package_credentials_package_id_marketplace_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."marketplace_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_installs" ADD CONSTRAINT "package_installs_package_id_marketplace_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."marketplace_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_installs" ADD CONSTRAINT "package_installs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_installs" ADD CONSTRAINT "package_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reviews" ADD CONSTRAINT "service_reviews_service_id_marketplace_packages_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reviews" ADD CONSTRAINT "service_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_skills" ADD CONSTRAINT "package_skills_package_id_marketplace_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."marketplace_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_skills" ADD CONSTRAINT "package_skills_skill_id_skills_catalog_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usage" ADD CONSTRAINT "package_usage_package_install_id_package_installs_id_fk" FOREIGN KEY ("package_install_id") REFERENCES "public"."package_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_calls_caller" ON "agent_calls" USING btree ("caller_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_callee" ON "agent_calls" USING btree ("callee_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user_id" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_keys_key_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dds_deployment_domain" ON "deployment_domain_scores" USING btree ("deployment_id","domain_id");--> statement-breakpoint
CREATE INDEX "idx_dds_domain_score" ON "deployment_domain_scores" USING btree ("domain_id","overall_score");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_rating" ON "deployment_ratings" USING btree ("user_id","deployment_id","domain_id");--> statement-breakpoint
CREATE INDEX "idx_drt_deployment_domain" ON "deployment_ratings" USING btree ("deployment_id","domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_secret_key" ON "deployment_secrets" USING btree ("deployment_id","key");--> statement-breakpoint
CREATE INDEX "idx_deployment_subagents_deployment_id" ON "deployment_subagents" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_subagents_deployment_slug" ON "deployment_subagents" USING btree ("deployment_id","slug");--> statement-breakpoint
CREATE INDEX "idx_deployment_subagents_is_public" ON "deployment_subagents" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "idx_domains_parent" ON "domains" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_domains_name" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flow_deployment_node" ON "flow_deployment_memberships" USING btree ("flow_id","deployment_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_flow_dep_membership_deployment_id" ON "flow_deployment_memberships" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "idx_flow_dep_membership_flow_id" ON "flow_deployment_memberships" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "idx_flow_exec_flow_id" ON "flow_executions" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "idx_flow_exec_user_id" ON "flow_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_flow_exec_status" ON "flow_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_managed_nodes_status" ON "managed_nodes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_managed_nodes_hetzner_server" ON "managed_nodes" USING btree ("hetzner_server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_package_name" ON "marketplace_packages" USING btree ("creator_id","name");--> statement-breakpoint
CREATE INDEX "idx_orch_flows_user_id" ON "orchestration_flows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orch_flows_status" ON "orchestration_flows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_orch_flows_is_public" ON "orchestration_flows" USING btree ("is_public");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_invite_email" ON "org_invites" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_member_user" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_service_async_jobs_deployment_id" ON "service_async_jobs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "idx_service_async_jobs_expires_at" ON "service_async_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sba_service_skill_period" ON "service_benchmark_aggregates" USING btree ("service_id","skill_name","period");--> statement-breakpoint
CREATE INDEX "idx_sbs_service_skill" ON "service_benchmark_samples" USING btree ("service_id","skill_name");--> statement-breakpoint
CREATE INDEX "idx_sbs_sampled_at" ON "service_benchmark_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_package_component" ON "package_components" USING btree ("package_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_package_cred" ON "package_credentials" USING btree ("deployment_id","package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_package" ON "package_installs" USING btree ("deployment_id","package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_srl_deployment_service_window" ON "service_rate_limits" USING btree ("deployment_id","service_id","window_type","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_service_review" ON "service_reviews" USING btree ("user_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_package_skill" ON "package_skills" USING btree ("package_id","skill_id");--> statement-breakpoint
CREATE INDEX "idx_deployments_user_id" ON "deployments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_deployments_status" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_deployments_is_public" ON "deployments" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "idx_deployments_org_id" ON "deployments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_marketplace_components_status" ON "marketplace_components" USING btree ("status");