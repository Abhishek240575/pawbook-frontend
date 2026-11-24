-- PawBook Marketplace — Phase 2: seller side
-- Safe to run more than once. Requires 003 + 004.

-- Seller stores (one per user)
CREATE TABLE IF NOT EXISTS marketplace_sellers (
  user_id         UUID PRIMARY KEY,
  store_name      VARCHAR(80)  NOT NULL,
  slug            VARCHAR(90)  NOT NULL UNIQUE,
  about           TEXT,
  logo_url        TEXT,
  business_type   VARCHAR(20)  NOT NULL DEFAULT 'individual',  -- individual, retailer, brand, manufacturer
  phone           VARCHAR(15)  NOT NULL,
  email           VARCHAR(160),
  gstin           VARCHAR(15),
  pickup_address  TEXT         NOT NULL,
  city            VARCHAR(80),
  state           VARCHAR(80),
  pincode         VARCHAR(6)   NOT NULL,
  ships_in_days   INTEGER      NOT NULL DEFAULT 2,
  status          VARCHAR(12)  NOT NULL DEFAULT 'active',      -- active, paused (by seller), suspended (by admin)
  is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,         -- set only by an admin
  admin_note      TEXT,
  agreed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE marketplace_sellers ADD CONSTRAINT mp_sellers_status_chk CHECK (status IN ('active','paused','suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE marketplace_sellers ADD CONSTRAINT mp_sellers_type_chk CHECK (business_type IN ('individual','retailer','brand','manufacturer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS mp_sellers_status_idx ON marketplace_sellers (status);

-- Product extras for sellers
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS sku          VARCHAR(60),
  ADD COLUMN IF NOT EXISTS low_stock_at INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS store_paused BOOLEAN NOT NULL DEFAULT FALSE,   -- hidden because the store is paused/suspended
  ADD COLUMN IF NOT EXISTS archived     BOOLEAN NOT NULL DEFAULT FALSE;   -- deleted by the seller (kept for past orders)
CREATE INDEX IF NOT EXISTS mp_products_seller_idx ON marketplace_products (seller_id);

-- Per-item fulfilment, so orders with several sellers work
ALTER TABLE marketplace_order_items
  ADD COLUMN IF NOT EXISTS seller_id         UUID,
  ADD COLUMN IF NOT EXISTS fulfil_status     VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, confirmed, packed, shipped, delivered, cancelled
  ADD COLUMN IF NOT EXISTS tracking          TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
UPDATE marketplace_order_items oi SET seller_id = p.seller_id
  FROM marketplace_products p
  WHERE oi.seller_id IS NULL AND oi.product_id IS NOT NULL AND p.product_id::text = oi.product_id::text;
CREATE INDEX IF NOT EXISTS mp_order_items_seller_idx ON marketplace_order_items (seller_id);
