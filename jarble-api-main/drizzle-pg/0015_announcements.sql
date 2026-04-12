-- JAR-75: site-wide announcement banners.
-- One active announcement renders at the top of every authenticated page.
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" varchar(255) PRIMARY KEY,
  "message" varchar(280) NOT NULL,
  "severity" varchar(20) NOT NULL DEFAULT 'info',
  "active" boolean NOT NULL DEFAULT true,
  "dismissible" boolean NOT NULL DEFAULT true,
  "audience" varchar(20) NOT NULL DEFAULT 'all',
  "starts_at" timestamp,
  "ends_at" timestamp,
  "created_by" varchar(255) REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Supports the "most recent active in-window" query that fires on every page load.
CREATE INDEX IF NOT EXISTS "announcements_active_idx"
  ON "announcements" ("active", "created_at" DESC);
