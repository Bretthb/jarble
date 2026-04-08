-- JAR-50: Extend agent_calls into a span-compatible audit table.
--
-- Phase 1 of the orchestration observability plan:
-- docs/audits/orchestration-observability-plan.md
--
-- NOTE: this migration is designed to be a SUPERSET of the agent_calls
-- changes in the parallel fractal-n-level-delegation branch's 0008_*.sql.
-- When that branch rebases, only its promo_codes additions should remain.
-- The `parent_call_id`, `depth`, and `kind` columns are added here too so
-- either migration can land first without conflict.

-- Loosen caller/callee FKs to nullable — root chat turns have no callee
-- until they delegate, and flow-engine internal steps may have no caller.
ALTER TABLE "agent_calls" ALTER COLUMN "caller_deployment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_calls" ALTER COLUMN "callee_deployment_id" DROP NOT NULL;--> statement-breakpoint

-- Fractal delegation topology (aligns with feature/fractal-n-level-delegation)
ALTER TABLE "agent_calls" ADD COLUMN "parent_call_id" varchar(40);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "kind" varchar(16) DEFAULT 'delegation' NOT NULL;--> statement-breakpoint

-- OpenTelemetry span identity
ALTER TABLE "agent_calls" ADD COLUMN "trace_id" varchar(32);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "span_id" varchar(16);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "parent_span_id" varchar(16);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "span_name" varchar(128);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "span_kind" varchar(24) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "service_name" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "pod_name" varchar(128);--> statement-breakpoint

-- Audit / filter fields
ALTER TABLE "agent_calls" ADD COLUMN "user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "org_id" varchar(255);--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "session_id" varchar(255);--> statement-breakpoint

-- Timing (Phase 1 uses milliseconds; Phase 2 OTel may add _ns columns later)
ALTER TABLE "agent_calls" ADD COLUMN "start_ms" bigint;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "end_ms" bigint;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "duration_ms" integer;--> statement-breakpoint

-- OTel-compatible span status + attribute bag
ALTER TABLE "agent_calls" ADD COLUMN "status_code" varchar(8) DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- Indexes that power the recursive delegation tree query,
-- billing rollups, and debug-drawer lookups.
CREATE INDEX "idx_agent_calls_parent_call_id" ON "agent_calls" USING btree ("parent_call_id");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_trace_id" ON "agent_calls" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_trace_parent" ON "agent_calls" USING btree ("trace_id","parent_span_id");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_parent_span_id" ON "agent_calls" USING btree ("parent_span_id");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_user_start" ON "agent_calls" USING btree ("user_id","start_ms");--> statement-breakpoint
CREATE INDEX "idx_agent_calls_span_name_start" ON "agent_calls" USING btree ("span_name","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_calls_span_id" ON "agent_calls" USING btree ("span_id");
