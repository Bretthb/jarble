CREATE TABLE `component_installs` (
	`id` varchar(255) NOT NULL,
	`component_id` varchar(255) NOT NULL,
	`version_id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`pinned_version` varchar(20),
	`auto_update` boolean NOT NULL DEFAULT true,
	`synced_at` timestamp,
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `component_installs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deployment_component` UNIQUE(`deployment_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `component_purchases` (
	`id` varchar(255) NOT NULL,
	`component_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`stripe_payment_intent_id` varchar(255),
	`stripe_subscription_id` varchar(255),
	`amount_cents` int NOT NULL,
	`platform_fee_cents` int NOT NULL,
	`creator_payout_cents` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`purchased_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	CONSTRAINT `component_purchases_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_component_purchase` UNIQUE(`user_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `component_reviews` (
	`id` varchar(255) NOT NULL,
	`component_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`rating` int NOT NULL,
	`title` varchar(255),
	`body` text,
	`creator_response` text,
	`creator_responded_at` timestamp,
	`helpful` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `component_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_component_review` UNIQUE(`user_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `component_versions` (
	`id` varchar(255) NOT NULL,
	`component_id` varchar(255) NOT NULL,
	`version` varchar(20) NOT NULL,
	`changelog` text,
	`package_url` varchar(512) NOT NULL,
	`package_size_bytes` int NOT NULL,
	`manifest_hash` varchar(64) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'published',
	`download_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `component_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_component_version` UNIQUE(`component_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `creator_profiles` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`bio` text,
	`website_url` varchar(512),
	`avatar_url` varchar(512),
	`stripe_connect_account_id` varchar(255),
	`stripe_connect_onboarded` boolean NOT NULL DEFAULT false,
	`is_verified` boolean NOT NULL DEFAULT false,
	`total_earnings_cents` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `creator_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `creator_profiles_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `marketplace_components` (
	`id` varchar(255) NOT NULL,
	`creator_id` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`bot_description` text,
	`tier` varchar(20) NOT NULL,
	`category` varchar(50) NOT NULL,
	`tags` text,
	`icon` varchar(512),
	`props_schema` text,
	`example_props` text,
	`example_prompts` text,
	`pricing_model` varchar(20) NOT NULL DEFAULT 'free',
	`price_usd_cents` int NOT NULL DEFAULT 0,
	`stripe_price_id` varchar(255),
	`stripe_product_id` varchar(255),
	`current_version` varchar(20) NOT NULL DEFAULT '1.0.0',
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`review_notes` text,
	`total_installs` int NOT NULL DEFAULT 0,
	`total_revenue_cents` int NOT NULL DEFAULT 0,
	`average_rating` int,
	`rating_count` int NOT NULL DEFAULT 0,
	`featured_at` timestamp,
	`published_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketplace_components_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_creator_component_name` UNIQUE(`creator_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `marketplace_packages` (
	`id` varchar(255) NOT NULL,
	`creator_id` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`description` text,
	`hosting_model` varchar(20) NOT NULL,
	`instruction_snippet` text,
	`remote_api_endpoint` varchar(500),
	`remote_api_config` text,
	`remote_health` varchar(20) DEFAULT 'unknown',
	`remote_last_check` timestamp,
	`creator_deployment_id` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`pricing_model` varchar(20) NOT NULL DEFAULT 'free',
	`price_usd_cents` int NOT NULL DEFAULT 0,
	`total_installs` int NOT NULL DEFAULT 0,
	`avg_rating` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketplace_packages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_creator_package_name` UNIQUE(`creator_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `service_async_jobs` (
	`id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`service_id` varchar(255) NOT NULL,
	`skill_name` varchar(100) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`request_body` text NOT NULL,
	`response_body` text,
	`response_status` int,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `service_async_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_circuit_breakers` (
	`id` varchar(255) NOT NULL,
	`service_id` varchar(255) NOT NULL,
	`state` varchar(20) NOT NULL DEFAULT 'CLOSED',
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`last_failure_at` varchar(20),
	`opened_at` varchar(20),
	`half_open_claimed_by` varchar(255),
	`half_open_claimed_at` varchar(20),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_circuit_breakers_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_circuit_breakers_service_id_unique` UNIQUE(`service_id`)
);
--> statement-breakpoint
CREATE TABLE `package_components` (
	`id` varchar(255) NOT NULL,
	`package_id` varchar(255) NOT NULL,
	`component_id` varchar(255) NOT NULL,
	CONSTRAINT `package_components_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_package_component` UNIQUE(`package_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `package_credentials` (
	`id` varchar(255) NOT NULL,
	`package_install_id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`package_id` varchar(255) NOT NULL,
	`signing_secret` text NOT NULL,
	`previous_signing_secret` text,
	`previous_secret_expires_at` timestamp,
	`handshake_status` varchar(20) NOT NULL DEFAULT 'pending',
	`handshake_error` text,
	`remote_install_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `package_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deployment_package_cred` UNIQUE(`deployment_id`,`package_id`)
);
--> statement-breakpoint
CREATE TABLE `service_heartbeats` (
	`id` varchar(255) NOT NULL,
	`service_id` varchar(255) NOT NULL,
	`last_heartbeat_at` timestamp NOT NULL,
	`heartbeat_interval_ms` int NOT NULL DEFAULT 60000,
	`payload` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_heartbeats_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_heartbeats_service_id_unique` UNIQUE(`service_id`)
);
--> statement-breakpoint
CREATE TABLE `package_installs` (
	`id` varchar(255) NOT NULL,
	`package_id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `package_installs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deployment_package` UNIQUE(`deployment_id`,`package_id`)
);
--> statement-breakpoint
CREATE TABLE `service_rate_limits` (
	`id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`service_id` varchar(255) NOT NULL,
	`window_type` varchar(10) NOT NULL,
	`window_start` varchar(20) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_rate_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_srl_deployment_service_window` UNIQUE(`deployment_id`,`service_id`,`window_type`,`window_start`)
);
--> statement-breakpoint
CREATE TABLE `package_skills` (
	`id` varchar(255) NOT NULL,
	`package_id` varchar(255) NOT NULL,
	`skill_id` varchar(255) NOT NULL,
	CONSTRAINT `package_skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_package_skill` UNIQUE(`package_id`,`skill_id`)
);
--> statement-breakpoint
CREATE TABLE `package_usage` (
	`id` varchar(255) NOT NULL,
	`package_install_id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`package_id` varchar(255) NOT NULL,
	`skill_name` varchar(100) NOT NULL,
	`request_count` int NOT NULL DEFAULT 0,
	`billing_cycle_start` varchar(10) NOT NULL,
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `package_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `deployments` ADD `messaging_only` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `managed_by` varchar(20) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `theme_config` text;--> statement-breakpoint
ALTER TABLE `component_installs` ADD CONSTRAINT `component_installs_component_id_marketplace_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `marketplace_components`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_installs` ADD CONSTRAINT `component_installs_version_id_component_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `component_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_installs` ADD CONSTRAINT `component_installs_deployment_id_deployments_id_fk` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_installs` ADD CONSTRAINT `component_installs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_purchases` ADD CONSTRAINT `component_purchases_component_id_marketplace_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `marketplace_components`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_purchases` ADD CONSTRAINT `component_purchases_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_reviews` ADD CONSTRAINT `component_reviews_component_id_marketplace_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `marketplace_components`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_reviews` ADD CONSTRAINT `component_reviews_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `component_versions` ADD CONSTRAINT `component_versions_component_id_marketplace_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `marketplace_components`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creator_profiles` ADD CONSTRAINT `creator_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketplace_components` ADD CONSTRAINT `marketplace_components_creator_id_users_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketplace_packages` ADD CONSTRAINT `marketplace_packages_creator_id_creator_profiles_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `creator_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_components` ADD CONSTRAINT `package_components_package_id_marketplace_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `marketplace_packages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_components` ADD CONSTRAINT `package_components_component_id_marketplace_components_id_fk` FOREIGN KEY (`component_id`) REFERENCES `marketplace_components`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_credentials` ADD CONSTRAINT `package_credentials_package_install_id_package_installs_id_fk` FOREIGN KEY (`package_install_id`) REFERENCES `package_installs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_credentials` ADD CONSTRAINT `package_credentials_deployment_id_deployments_id_fk` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_credentials` ADD CONSTRAINT `package_credentials_package_id_marketplace_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `marketplace_packages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_installs` ADD CONSTRAINT `package_installs_package_id_marketplace_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `marketplace_packages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_installs` ADD CONSTRAINT `package_installs_deployment_id_deployments_id_fk` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_installs` ADD CONSTRAINT `package_installs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_skills` ADD CONSTRAINT `package_skills_package_id_marketplace_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `marketplace_packages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_skills` ADD CONSTRAINT `package_skills_skill_id_skills_catalog_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skills_catalog`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_usage` ADD CONSTRAINT `package_usage_package_install_id_package_installs_id_fk` FOREIGN KEY (`package_install_id`) REFERENCES `package_installs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_marketplace_components_status` ON `marketplace_components` (`status`);--> statement-breakpoint
CREATE INDEX `idx_service_async_jobs_deployment_id` ON `service_async_jobs` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `idx_service_async_jobs_expires_at` ON `service_async_jobs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_deployments_user_id` ON `deployments` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_deployments_status` ON `deployments` (`status`);