-- Add per-deployment delegation budget cap
ALTER TABLE "deployments" ADD COLUMN "max_budget_cents" integer;
