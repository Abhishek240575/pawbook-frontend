-- PawBook Events 2.0 (page 30). Safe to run more than once.
-- The existing tables (events, event_attendees, event_rsvps) are NOT changed; Events 2.0 adds side tables.

-- Extra details for an event (keyed by events.event_id)
CREATE TABLE IF NOT EXISTS pet_event_details (
  event_id        UUID          PRIMARY KEY,
  category        VARCHAR(20)   NOT NULL,                 -- meetup, adoption, vet, show, training, online
  subtype         VARCHAR(60),
  ends_at         TIMESTAMP,                              -- local (India) time, like events.event_date
  is_online       BOOLEAN       NOT NULL DEFAULT FALSE,
  online_url      TEXT,                                   -- shown only to registered attendees and the host
  venue           VARCHAR(200),
  country         VARCHAR(60),
  state           VARCHAR(80),
  city            VARCHAR(80),
  lat             NUMERIC(9,6),
  lng             NUMERIC(9,6),
  species         TEXT[]        NOT NULL DEFAULT '{}',    -- dog, cat, bird, rabbit, other (empty = all)
  age_group       VARCHAR(20)   NOT NULL DEFAULT 'all',   -- all, young, adult, senior
  fee_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,       -- 0 = free
  fee_mode        VARCHAR(10)   NOT NULL DEFAULT 'free',  -- free, venue, online, both
  allow_waitlist  BOOLEAN       NOT NULL DEFAULT TRUE,
  programme       JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{time, title}]
  requirements    TEXT,
  eligibility     TEXT,
  safety          TEXT,
  cancellation    TEXT,
  host_name       VARCHAR(120),
  host_about      TEXT,
  host_phone      VARCHAR(30),
  meta            JSONB         NOT NULL DEFAULT '{}'::jsonb,   -- category-specific fields
  photos          TEXT[]        NOT NULL DEFAULT '{}',
  moderation      VARCHAR(12)   NOT NULL DEFAULT 'pending',     -- pending, approved, rejected, hidden
  moderation_note VARCHAR(300),
  moderated_by    UUID,
  moderated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pet_event_details ADD CONSTRAINT pet_event_details_cat_chk CHECK (category IN ('meetup','adoption','vet','show','training','online'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE pet_event_details ADD CONSTRAINT pet_event_details_mod_chk CHECK (moderation IN ('pending','approved','rejected','hidden'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE pet_event_details ADD CONSTRAINT pet_event_details_fee_chk CHECK (fee_mode IN ('free','venue','online','both') AND fee_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS pet_event_details_city_idx ON pet_event_details (lower(city), category);
CREATE INDEX IF NOT EXISTS pet_event_details_mod_idx ON pet_event_details (moderation);

-- Registrations (one active registration per person per event; capacity + waitlist + payment)
CREATE TABLE IF NOT EXISTS pet_event_registrations (
  reg_id          BIGSERIAL     PRIMARY KEY,
  event_id        UUID          NOT NULL,
  user_id         UUID          NOT NULL,
  status          VARCHAR(16)   NOT NULL,                 -- pending_payment, registered, waitlisted, cancelled, checked_in
  people          SMALLINT      NOT NULL DEFAULT 1,
  pets            JSONB         NOT NULL DEFAULT '[]'::jsonb,   -- [{name, species}]
  phone           VARCHAR(30),
  note            VARCHAR(300),
  answers         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  payment         VARCHAR(16)   NOT NULL DEFAULT 'none',  -- none, due, paid_venue, paid_online, refund_due, refunded
  amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  rzp_order_id    VARCHAR(60),
  rzp_payment_id  VARCHAR(60),
  hold_until      TIMESTAMPTZ,                            -- seat held while paying online
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pet_event_registrations ADD CONSTRAINT pet_event_reg_status_chk CHECK (status IN ('pending_payment','registered','waitlisted','cancelled','checked_in'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE pet_event_registrations ADD CONSTRAINT pet_event_reg_pay_chk CHECK (payment IN ('none','due','paid_venue','paid_online','refund_due','refunded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- no duplicate registrations: one non-cancelled row per person per event
CREATE UNIQUE INDEX IF NOT EXISTS pet_event_reg_active_uq ON pet_event_registrations (event_id, user_id) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS pet_event_reg_rzp_uq ON pet_event_registrations (rzp_order_id) WHERE rzp_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pet_event_reg_event_idx ON pet_event_registrations (event_id, status, created_at);
CREATE INDEX IF NOT EXISTS pet_event_reg_user_idx ON pet_event_registrations (user_id, status);

-- Reports from the community
CREATE TABLE IF NOT EXISTS pet_event_reports (
  report_id   BIGSERIAL    PRIMARY KEY,
  event_id    UUID         NOT NULL,
  user_id     UUID         NOT NULL,
  reason      VARCHAR(30)  NOT NULL,
  details     VARCHAR(500),
  status      VARCHAR(12)  NOT NULL DEFAULT 'open',      -- open, resolved, dismissed
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_event_reports_once_uq ON pet_event_reports (event_id, user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS pet_event_reports_open_idx ON pet_event_reports (status, created_at);
