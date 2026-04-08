CREATE TABLE "promo_codes" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" varchar(20) DEFAULT 'fixed' NOT NULL,
	"discount_amount" integer NOT NULL,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"promo_code_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"deployment_id" varchar(255),
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "parent_call_id" varchar(40);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "kind" varchar(16) DEFAULT 'delegation' NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_calls_parent_call_id" ON "agent_calls" USING btree ("parent_call_id");