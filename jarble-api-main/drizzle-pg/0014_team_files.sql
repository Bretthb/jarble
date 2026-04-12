-- Team Files: S3-backed file sharing between agent team members
CREATE TABLE IF NOT EXISTS "team_files" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "flow_id" varchar(255) NOT NULL,
  "session_id" varchar(255) NOT NULL,
  "filename" varchar(500) NOT NULL,
  "mime_type" varchar(255),
  "size_bytes" integer NOT NULL,
  "s3_key" varchar(1000) NOT NULL,
  "uploaded_by_deployment_id" varchar(255),
  "uploaded_by_node_id" varchar(255),
  "user_id" varchar(255) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_team_files_flow_session" ON "team_files" ("flow_id", "session_id");
CREATE INDEX IF NOT EXISTS "idx_team_files_user" ON "team_files" ("user_id");
