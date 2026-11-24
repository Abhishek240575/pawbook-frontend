-- PawBook Marketplace — Phase 5 (rest): returns & refunds, payout deductions, ship-by deadline
-- Safe to run more than once. Requires 003–009.

CREATE TABLE IF NOT EXISTS marketplace_returns (
  return_id      BIGSERIAL     PRIMARY KEY,
  order_id       TEXT          NOT NULL,
  item_id        TEXT          NOT NULL,
  buyer_id       TEXT          NOT NULL,
  seller_id      TEXT,
  amount         NUMERIC(12,2) NOT NULL,                 -- item price x quantity
  reason         VARCHAR(30)   NOT NULL,                 -- damaged, wrong_item, not_as_described, quality, other
  details        TEXT,
  status         VARCHAR(12)   NOT NULL DEFAULT 'requested', -- requested, approved, rejected, received, refunded, cancelled
  refund_to      VARCHAR(80),                            -- buyer's UPI ID for COD refunds
  seller_note    TEXT,
  admin_note     TEXT,
  refund_method  VARCHAR(20),
  refund_ref     VARCHAR(80),
  decided_by     TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  decided_at     TIMESTAMPTZ,
  received_at    TIMESTAMPTZ,
  refunded_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE marketplace_returns ADD CONSTRAINT mp_returns_status_chk CHECK (status IN ('requested','approved','rejected','received','refunded','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- at most one live return per order item
CREATE UNIQUE INDEX IF NOT EXISTS mp_returns_item_open_uq ON marketplace_returns (item_id) WHERE status NOT IN ('rejected','cancelled');
CREATE INDEX IF NOT EXISTS mp_returns_seller_idx ON marketplace_returns (seller_id, status);
CREATE INDEX IF NOT EXISTS mp_returns_buyer_idx ON marketplace_returns (buyer_id, created_at DESC);

-- Money to take back from a seller who was already paid for an item that was later refunded
CREATE TABLE IF NOT EXISTS marketplace_payout_adjustments (
  adj_id     BIGSERIAL     PRIMARY KEY,
  seller_id  TEXT          NOT NULL,
  amount     NUMERIC(12,2) NOT NULL,                     -- deducted from the next payout
  reason     TEXT,
  return_id  BIGINT        UNIQUE,
  payout_id  BIGINT,                                     -- set when the deduction is applied
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mp_adj_open_idx ON marketplace_payout_adjustments (seller_id) WHERE payout_id IS NULL;

ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS deductions NUMERIC(12,2) NOT NULL DEFAULT 0;

INSERT INTO marketplace_settings (key, value) VALUES ('return_window_days', '7'), ('dispatch_days', '2') ON CONFLICT (key) DO NOTHING;
