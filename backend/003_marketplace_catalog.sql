-- ============================================================================
-- PawBook Migration 003: Marketplace 2.0 — catalogue attributes (Phase 1)
-- Additive only: adds columns/tables, never drops or rewrites existing data.
-- Safe to run more than once.
-- ============================================================================

-- ── Product attributes needed for filters, PDP and pet suitability ─────────
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS brand              VARCHAR(120),
  ADD COLUMN IF NOT EXISTS subcategory        VARCHAR(60),
  ADD COLUMN IF NOT EXISTS pet_types          TEXT[]      NOT NULL DEFAULT '{}',   -- dog, cat, bird, fish, small_pet, other
  ADD COLUMN IF NOT EXISTS life_stages        TEXT[]      NOT NULL DEFAULT '{}',   -- puppy, kitten, adult, senior, all
  ADD COLUMN IF NOT EXISTS tags               TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specs              JSONB       NOT NULL DEFAULT '{}',   -- {"Weight":"3 kg","Material":"Rubber"}
  ADD COLUMN IF NOT EXISTS ingredients        TEXT,
  ADD COLUMN IF NOT EXISTS usage_instructions TEXT,
  ADD COLUMN IF NOT EXISTS variants           JSONB       NOT NULL DEFAULT '[]',   -- [{"label":"3 kg","price":899,"compare_price":999,"stock":10}]
  ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_days      INTEGER     NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_mp_products_active_cat ON marketplace_products (is_active, category);
CREATE INDEX IF NOT EXISTS idx_mp_products_brand      ON marketplace_products (brand);
CREATE INDEX IF NOT EXISTS idx_mp_products_price      ON marketplace_products (price);
CREATE INDEX IF NOT EXISTS idx_mp_products_pet_types  ON marketplace_products USING GIN (pet_types);
CREATE INDEX IF NOT EXISTS idx_mp_products_created    ON marketplace_products (created_at DESC);

-- ── Brands (verified brand stores come in a later phase) ──────────────────
CREATE TABLE IF NOT EXISTS marketplace_brands (
  brand_id     SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL UNIQUE,
  slug         VARCHAR(140) NOT NULL UNIQUE,
  logo_url     TEXT,
  cover_url    TEXT,
  description  TEXT,
  is_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Wishlist (server-side, per user) ──────────────────────────────────────
-- product_id kept as TEXT so it works whatever type marketplace_products.product_id uses.
CREATE TABLE IF NOT EXISTS marketplace_wishlist (
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

-- ── Newsletter sign-ups from the shop footer ──────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_newsletter (
  email       VARCHAR(255) PRIMARY KEY,
  pet_types   TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
