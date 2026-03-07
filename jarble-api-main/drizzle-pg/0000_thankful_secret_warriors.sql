CREATE TABLE "component_installs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"component_id" varchar(255) NOT NULL,
	"version_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"pinned_version" varchar(20),
	"auto_update" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp,
	"installed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_purchases" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"component_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"amount_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"creator_payout_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "component_reviews" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"component_id" varchar(255) NOT NULL,
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
CREATE TABLE "component_versions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"component_id" varchar(255) NOT NULL,
	"version" varchar(20) NOT NULL,
	"changelog" text,
	"package_url" varchar(512) NOT NULL,
	"package_size_bytes" integer NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"bio" text,
	"website_url" varchar(512),
	"avatar_url" varchar(512),
	"stripe_connect_account_id" varchar(255),
	"stripe_connect_onboarded" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"total_earnings_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "deployment_skills" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"skill_id" varchar(255) NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"runtime" varchar(100) DEFAULT 'openclaw' NOT NULL,
	"image" varchar(255),
	"runtime_catalog_id" integer,
	"is_free" boolean DEFAULT false NOT NULL,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"free_expires_at" timestamp,
	"cpu_limit" varchar(10),
	"memory_mb" integer,
	"storage_mb" integer,
	"llm_mode" varchar(20) DEFAULT 'byok' NOT NULL,
	"llm_provider" varchar(30) DEFAULT 'openrouter' NOT NULL,
	"llm_model" varchar(100),
	"llm_api_key" varchar(512),
	"llm_api_key_id" varchar(255),
	"llm_credit_limit_dollars" integer,
	"llm_api_key_source_deployment_id" varchar(255),
	"system_prompt" text,
	"stripe_subscription_id" varchar(255),
	"cancelled_at" timestamp,
	"cancel_at_period_end" timestamp,
	"status" varchar(50) DEFAULT 'creating' NOT NULL,
	"error" text,
	"messaging_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_components" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"creator_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"bot_description" text,
	"tier" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"tags" text,
	"icon" varchar(512),
	"props_schema" text,
	"example_props" text,
	"example_prompts" text,
	"pricing_model" varchar(20) DEFAULT 'free' NOT NULL,
	"price_usd_cents" integer DEFAULT 0 NOT NULL,
	"stripe_price_id" varchar(255),
	"stripe_product_id" varchar(255),
	"current_version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"review_notes" text,
	"total_installs" integer DEFAULT 0 NOT NULL,
	"total_revenue_cents" integer DEFAULT 0 NOT NULL,
	"average_rating" integer,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"featured_at" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"platform_id" varchar(50) NOT NULL,
	"credentials" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" varchar(255) PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"category" varchar(50) DEFAULT 'bot' NOT NULL,
	"docker_image" varchar(255) NOT NULL,
	"cpu_limit" varchar(10) DEFAULT '2.0' NOT NULL,
	"memory_mb" integer DEFAULT 2048 NOT NULL,
	"storage_mb" integer DEFAULT 30 NOT NULL,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_catalog_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "skills_catalog" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"runtime" varchar(50) DEFAULT 'openclaw' NOT NULL,
	"config" text NOT NULL,
	"author" varchar(100),
	"is_official" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"auth0_id" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" varchar(255),
	"pending_stripe_subscription_id" varchar(255),
	"free_deployment_used" boolean DEFAULT false NOT NULL,
	"free_trial_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_auth0_id_unique" UNIQUE("auth0_id")
);
--> statement-breakpoint
ALTER TABLE "component_installs" ADD CONSTRAINT "component_installs_component_id_marketplace_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."marketplace_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_installs" ADD CONSTRAINT "component_installs_version_id_component_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."component_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_installs" ADD CONSTRAINT "component_installs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_installs" ADD CONSTRAINT "component_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_purchases" ADD CONSTRAINT "component_purchases_component_id_marketplace_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."marketplace_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_purchases" ADD CONSTRAINT "component_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_reviews" ADD CONSTRAINT "component_reviews_component_id_marketplace_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."marketplace_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_reviews" ADD CONSTRAINT "component_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_versions" ADD CONSTRAINT "component_versions_component_id_marketplace_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."marketplace_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_skills" ADD CONSTRAINT "deployment_skills_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_skills" ADD CONSTRAINT "deployment_skills_skill_id_skills_catalog_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_runtime_catalog_id_runtime_catalog_id_fk" FOREIGN KEY ("runtime_catalog_id") REFERENCES "public"."runtime_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_components" ADD CONSTRAINT "marketplace_components_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_component" ON "component_installs" USING btree ("deployment_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_component_purchase" ON "component_purchases" USING btree ("user_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_component_review" ON "component_reviews" USING btree ("user_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_component_version" ON "component_versions" USING btree ("component_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_skill" ON "deployment_skills" USING btree ("deployment_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_component_name" ON "marketplace_components" USING btree ("creator_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_platform" ON "platform_credentials" USING btree ("deployment_id","platform_id");