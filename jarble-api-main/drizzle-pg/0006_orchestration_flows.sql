CREATE TABLE IF NOT EXISTS "orchestration_flows" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "definition" text NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "fork_count" integer DEFAULT 0 NOT NULL,
  "forked_from_id" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_orch_flows_user_id" ON "orchestration_flows" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_orch_flows_status" ON "orchestration_flows" ("status");

CREATE TABLE IF NOT EXISTS "flow_executions" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "flow_id" varchar(255) NOT NULL REFERENCES "orchestration_flows"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL REFERENCES "users"("id"),
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "step_results" text,
  "total_credits_charged" integer DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_flow_exec_flow_id" ON "flow_executions" ("flow_id");
CREATE INDEX IF NOT EXISTS "idx_flow_exec_user_id" ON "flow_executions" ("user_id");
