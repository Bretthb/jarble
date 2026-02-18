CREATE TABLE `deployments` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`runtime` varchar(100) NOT NULL DEFAULT 'openclaw',
	`image` varchar(255),
	`runtime_catalog_id` int,
	`is_free` boolean NOT NULL DEFAULT false,
	`monthly_price_cents` int NOT NULL DEFAULT 0,
	`free_expires_at` timestamp,
	`cpu_limit` varchar(10),
	`memory_mb` int,
	`storage_mb` int,
	`llm_mode` varchar(20) NOT NULL DEFAULT 'byok',
	`llm_provider` varchar(30) NOT NULL DEFAULT 'openrouter',
	`llm_model` varchar(100),
	`llm_api_key` varchar(512),
	`llm_api_key_id` varchar(255),
	`llm_credit_limit_dollars` int,
	`llm_api_key_source_deployment_id` varchar(255),
	`system_prompt` text,
	`stripe_subscription_id` varchar(255),
	`cancelled_at` timestamp,
	`cancel_at_period_end` timestamp,
	`status` varchar(50) NOT NULL DEFAULT 'creating',
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deployments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_credentials` (
	`id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`platform_id` varchar(50) NOT NULL,
	`credentials` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deployment_platform` UNIQUE(`deployment_id`,`platform_id`)
);
--> statement-breakpoint
CREATE TABLE `processed_webhook_events` (
	`event_id` varchar(255) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`processed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processed_webhook_events_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `runtime_catalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`category` varchar(50) NOT NULL DEFAULT 'bot',
	`docker_image` varchar(255) NOT NULL,
	`cpu_limit` varchar(10) NOT NULL DEFAULT '2.0',
	`memory_mb` int NOT NULL DEFAULT 2048,
	`storage_mb` int NOT NULL DEFAULT 30,
	`monthly_price_cents` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `runtime_catalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `runtime_catalog_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`auth0_id` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`stripe_customer_id` varchar(255),
	`pending_stripe_subscription_id` varchar(255),
	`free_deployment_used` boolean NOT NULL DEFAULT false,
	`free_trial_expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_auth0_id_unique` UNIQUE(`auth0_id`)
);
--> statement-breakpoint
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_runtime_catalog_id_runtime_catalog_id_fk` FOREIGN KEY (`runtime_catalog_id`) REFERENCES `runtime_catalog`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD CONSTRAINT `platform_credentials_deployment_id_deployments_id_fk` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE cascade ON UPDATE no action;