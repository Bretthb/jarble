-- JAR-86: Durable lifecycle job queue
-- Replaces fire-and-forget IIFEs in the deployment router with a queue that
-- survives API pod restarts. A background worker polls this table, picks up
-- pending jobs via SELECT ... FOR UPDATE SKIP LOCKED, and runs the K8s
-- readiness-poll state machine previously inlined in the router.

CREATE TABLE IF NOT EXISTS "lifecycle_jobs" (
    "id" varchar(255) PRIMARY KEY NOT NULL,
    "deployment_id" varchar(255) NOT NULL,
    "user_id" varchar(255) NOT NULL,
    "type" varchar(20) NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "last_error" text,
    "payload" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "run_after" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_lifecycle_jobs_status_run_after" ON "lifecycle_jobs" ("status","run_after");
CREATE INDEX IF NOT EXISTS "idx_lifecycle_jobs_deployment_id" ON "lifecycle_jobs" ("deployment_id");
