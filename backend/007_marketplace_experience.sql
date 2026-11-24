-- PawBook Marketplace — Phase 6: verified reviews, coupons
-- Safe to run more than once. Requires 003–006.

-- Reviews: verified purchase, title, moderation
ALTER TABLE marketplace_reviews
  ADD COLUMN IF NOT EXISTS title       VARCHAR(120),
  ADD COLUMN IF NOT EXISTS verified    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status      VARCHAR(12) NOT NULL DEFAULT 'published',   -- published, hidden
  ADD COLUMN IF NOT EXISTS order_id    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS mp_reviews_product_idx ON marketplace_reviews (product_id, status);
-- one review per person per product (skipped if old duplicate rows exist)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS mp_reviews_user_product_uq ON marketplace_reviews (product_id, user_id);
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'duplicate reviews exist; unique index not created';
END $$;

-- Coupons (funded by PawBook; sellers are paid the full item price)
CREATE TABLE IF NOT EXISTS marketplace_coupons (
  code            VARCHAR(20)   PRIMARY KEY,                 -- upper case A–Z, 0–9
  description     VARCHAR(160),
  kind            VARCHAR(10)   NOT NULL DEFAULT 'percent',  -- percent, flat
  value           NUMERIC(10,2) NOT NULL CHECK (value > 0),
  min_order       NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount    NUMERIC(10,2),                             -- cap for percent coupons
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  usage_limit     INTEGER,                                   -- total uses, NULL = unlimited
  per_user_limit  INTEGER       NOT NULL DEFAULT 1,
  first_order_only BOOLEAN      NOT NULL DEFAULT FALSE,
  is_public       BOOLEAN       NOT NULL DEFAULT TRUE,       -- shown at checkout
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE marketplace_coupons ADD CONSTRAINT mp_coupons_kind_chk CHECK (kind IN ('percent','flat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_coupon_redemptions (
  id          BIGSERIAL     PRIMARY KEY,
  code        VARCHAR(20)   NOT NULL REFERENCES marketplace_coupons(code) ON UPDATE CASCADE,
  user_id     TEXT          NOT NULL,
  order_id    TEXT          NOT NULL UNIQUE,
  discount    NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mp_coupon_red_code_idx ON marketplace_coupon_redemptions (code, user_id);

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS discount    NUMERIC(10,2) NOT NULL DEFAULT 0;
