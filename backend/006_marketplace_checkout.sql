-- PawBook Marketplace — Phase 3 (without online payment): secure cart, addresses, checkout, orders
-- Safe to run more than once. Requires 003, 004, 005.

CREATE TABLE IF NOT EXISTS pb_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Cart with size/pack support (one row per product + size)
CREATE TABLE IF NOT EXISTS shop_cart_items (
  user_id     TEXT        NOT NULL,
  product_id  TEXT        NOT NULL,
  variant     TEXT        NOT NULL DEFAULT '',     -- size/pack label, '' when the product has no sizes
  quantity    INTEGER     NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id, variant)
);

-- Copy what people already have in the old cart, once
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pb_migrations WHERE name = '006_cart_copy') THEN
    IF to_regclass('public.marketplace_cart') IS NOT NULL THEN
      INSERT INTO shop_cart_items (user_id, product_id, variant, quantity)
      SELECT user_id::text, product_id::text, '', LEAST(GREATEST(quantity, 1), 20) FROM marketplace_cart
      WHERE product_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    END IF;
    INSERT INTO pb_migrations (name) VALUES ('006_cart_copy');
  END IF;
END $$;

-- Saved delivery addresses
CREATE TABLE IF NOT EXISTS user_addresses (
  address_id  BIGSERIAL    PRIMARY KEY,
  user_id     TEXT         NOT NULL,
  label       VARCHAR(20)  NOT NULL DEFAULT 'home',      -- home, work, other
  name        VARCHAR(80)  NOT NULL,
  phone       VARCHAR(15)  NOT NULL,
  line1       VARCHAR(200) NOT NULL,
  line2       VARCHAR(200),
  landmark    VARCHAR(120),
  city        VARCHAR(80)  NOT NULL,
  state       VARCHAR(80)  NOT NULL,
  pincode     VARCHAR(6)   NOT NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON user_addresses (user_id);

-- Orders: payment + idempotency + cancellation details
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS subtotal        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS delivery_fee    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_delivery DATE,
  ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS client_ref      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cancel_reason   TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS mp_orders_client_ref_uq ON marketplace_orders (buyer_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS mp_orders_buyer_idx ON marketplace_orders (buyer_id, created_at DESC);

ALTER TABLE marketplace_order_items
  ADD COLUMN IF NOT EXISTS variant   TEXT,
  ADD COLUMN IF NOT EXISTS mrp       NUMERIC(12,2);
CREATE INDEX IF NOT EXISTS mp_order_items_order_idx ON marketplace_order_items (order_id);

-- Order numbers without collisions
CREATE SEQUENCE IF NOT EXISTS marketplace_order_seq START 10001;
