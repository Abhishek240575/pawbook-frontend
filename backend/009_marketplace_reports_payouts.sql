-- PawBook Marketplace — Phase 7: admin orders, reports, seller payouts
-- Safe to run more than once. Requires 003–008.

-- A payout is one bank transfer to one seller covering a set of delivered items.
CREATE TABLE IF NOT EXISTS marketplace_payouts (
  payout_id      BIGSERIAL     PRIMARY KEY,
  seller_id      TEXT          NOT NULL,
  items_count    INTEGER       NOT NULL,
  gross          NUMERIC(12,2) NOT NULL,          -- item price x qty (coupons are paid by PawBook, so not deducted)
  commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  commission     NUMERIC(12,2) NOT NULL DEFAULT 0,
  net            NUMERIC(12,2) NOT NULL,          -- amount transferred to the seller
  reference      VARCHAR(80),                     -- bank UTR / transaction id
  note           TEXT,
  paid_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by     TEXT
);
CREATE INDEX IF NOT EXISTS mp_payouts_seller_idx ON marketplace_payouts (seller_id, paid_at DESC);

ALTER TABLE marketplace_order_items
  ADD COLUMN IF NOT EXISTS payout_id BIGINT;
CREATE INDEX IF NOT EXISTS mp_order_items_payout_idx ON marketplace_order_items (payout_id);
CREATE INDEX IF NOT EXISTS mp_order_items_unpaid_idx ON marketplace_order_items (fulfil_status) WHERE payout_id IS NULL;

-- When PawBook received the cash for a COD order
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS cod_collected_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS mp_orders_created_idx ON marketplace_orders (created_at DESC);

-- Payout settings: no commission and no waiting period until the admin sets them
INSERT INTO marketplace_settings (key, value) VALUES ('commission_pct', '0'), ('payout_hold_days', '0') ON CONFLICT (key) DO NOTHING;
