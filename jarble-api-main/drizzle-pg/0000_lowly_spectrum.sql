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
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"auth0_id" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" varchar(255),
	"pending_stripe_subscription_id" varchar(255),
	"pending_stripe_tier" varchar(50),
	"free_deployment_used" boolean DEFAULT false NOT NULL,
	"free_trial_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_auth0_id_unique" UNIQUE("auth0_id")
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_runtime_catalog_id_runtime_catalog_id_fk" FOREIGN KEY ("runtime_catalog_id") REFERENCES "public"."runtime_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployment_platform" ON "platform_credentials" USING btree ("deployment_id","platform_id");