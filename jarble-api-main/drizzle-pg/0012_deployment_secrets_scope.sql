-- Add scope column to deployment_secrets for credential visibility control
ALTER TABLE "deployment_secrets" ADD COLUMN "scope" varchar(20) NOT NULL DEFAULT 'shared';
