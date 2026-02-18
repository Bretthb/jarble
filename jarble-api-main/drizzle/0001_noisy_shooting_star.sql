CREATE TABLE `deployment_skills` (
	`id` varchar(255) NOT NULL,
	`deployment_id` varchar(255) NOT NULL,
	`skill_id` varchar(255) NOT NULL,
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deployment_skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_deployment_skill` UNIQUE(`deployment_id`,`skill_id`)
);
--> statement-breakpoint
CREATE TABLE `skills_catalog` (
	`id` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`runtime` varchar(50) NOT NULL DEFAULT 'openclaw',
	`config` text NOT NULL,
	`author` varchar(100),
	`is_official` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `skills_catalog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `deployment_skills` ADD CONSTRAINT `deployment_skills_deployment_id_deployments_id_fk` FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deployment_skills` ADD CONSTRAINT `deployment_skills_skill_id_skills_catalog_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skills_catalog`(`id`) ON DELETE no action ON UPDATE no action;