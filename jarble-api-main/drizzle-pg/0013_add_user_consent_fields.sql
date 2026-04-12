-- JAR-TOS: Add Terms of Service + Privacy Policy acknowledgment tracking
-- to the users table.
--
-- All three columns are intentionally nullable. Existing users are NOT
-- backfilled. A null value on tos_accepted_at is the signal that the
-- returning-user consent modal must block navigation until the user
-- accepts the current version. The tos_version column stores which
-- version of the terms the user agreed to so a future version bump
-- can force re-acceptance.
ALTER TABLE "users" ADD COLUMN "tos_accepted_at" timestamp;
ALTER TABLE "users" ADD COLUMN "tos_version" varchar(32);
ALTER TABLE "users" ADD COLUMN "privacy_accepted_at" timestamp;
