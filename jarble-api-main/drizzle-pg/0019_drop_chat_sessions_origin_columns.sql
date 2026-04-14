-- Drop dead origin_* columns from chat_sessions.
--
-- These were added in 0010_chat_sessions_origin_type.sql but never used by
-- any application code (full-repo grep returned zero references outside the
-- migration file itself). Removing to reduce schema drift from schema.pg.ts.
ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "origin_type";
--> statement-breakpoint
ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "origin_caller_deployment_id";
--> statement-breakpoint
ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "origin_task";
