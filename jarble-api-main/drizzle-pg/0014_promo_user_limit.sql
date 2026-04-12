-- JAR-47 follow-up: per-user redemption cap on promo codes.
-- Default 1 means each user can redeem a given code once unless admin raises it.
ALTER TABLE "promo_codes"
  ADD COLUMN IF NOT EXISTS "max_uses_per_user" integer NOT NULL DEFAULT 1;

-- Speeds up the per-user redemption count executed on every /validate and checkout call.
CREATE INDEX IF NOT EXISTS "promo_redemptions_code_user_idx"
  ON "promo_redemptions" ("promo_code_id", "user_id");
