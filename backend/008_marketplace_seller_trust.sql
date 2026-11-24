-- PawBook Marketplace — Phase 4 (rest): seller KYC + listing approval
-- Safe to run more than once. Requires 003–007.

-- KYC record per seller (documents themselves are private files on the server, never public URLs)
CREATE TABLE IF NOT EXISTS marketplace_seller_kyc (
  user_id        TEXT        PRIMARY KEY,
  legal_name     VARCHAR(120),
  pan            VARCHAR(10),
  status         VARCHAR(12) NOT NULL DEFAULT 'draft',   -- draft, submitted, approved, rejected
  reject_reason  TEXT,
  submitted_at   TIMESTAMPTZ,
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE marketplace_seller_kyc ADD CONSTRAINT mp_kyc_status_chk CHECK (status IN ('draft','submitted','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_kyc_docs (
  doc_id         BIGSERIAL   PRIMARY KEY,
  user_id        TEXT        NOT NULL,
  kind           VARCHAR(20) NOT NULL,                  -- pan, gst, business, brand_auth
  stored_name    VARCHAR(80) NOT NULL,                  -- random file name on disk
  original_name  VARCHAR(160),
  mime           VARCHAR(40) NOT NULL,
  size_bytes     INTEGER     NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mp_kyc_docs_user_idx ON marketplace_kyc_docs (user_id, kind);

-- Shop-wide settings
CREATE TABLE IF NOT EXISTS marketplace_settings (
  key        VARCHAR(40) PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO marketplace_settings (key, value) VALUES ('listing_approval', 'new_sellers') ON CONFLICT (key) DO NOTHING;

-- Listing moderation. Existing products stay approved.
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS moderation       VARCHAR(12) NOT NULL DEFAULT 'approved',   -- approved, pending, rejected
  ADD COLUMN IF NOT EXISTS moderation_note  TEXT,
  ADD COLUMN IF NOT EXISTS seller_live      BOOLEAN,                                   -- what the seller wants (shown once approved)
  ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ;
UPDATE marketplace_products SET seller_live = (is_active OR store_paused) WHERE seller_live IS NULL;
CREATE INDEX IF NOT EXISTS mp_products_moderation_idx ON marketplace_products (moderation) WHERE moderation <> 'approved';
