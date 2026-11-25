-- PawBook Lost & Found 2.0 (page 38): multilingual rescue & reunification network. Safe to run more than once.
-- Extends lost_pet_reports (missing pets) and adds tables for found pets, sightings, protected messages, case history,
-- flags, volunteers, language preferences, translations and alert logs. Nothing is dropped; the old /lost-pets API keeps working.

-- ── missing pets: extend the existing table ──
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS reporter_uuid    UUID;
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS gender           VARCHAR(10);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS marks            TEXT;          -- identifying marks
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS microchip        VARCHAR(40);   -- private; public sees last 4 only
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS reward           VARCHAR(120);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS private_phone    VARCHAR(30);   -- never public (contact_phone holds a placeholder)
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS city             VARCHAR(100);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS state            VARCHAR(100);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS public_lat       NUMERIC(9,5);  -- approximate (≈ 500 m), safe to show
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS public_lng       NUMERIC(9,5);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS case_status      VARCHAR(20) NOT NULL DEFAULT 'active';  -- active, sighted, identified, reunited, closed, archived
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS moderation       VARCHAR(10) NOT NULL DEFAULT 'visible'; -- visible, hidden
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS moderation_note  VARCHAR(300);
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS source_lang      VARCHAR(5)  NOT NULL DEFAULT 'en';
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS urgent           BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS alerts_sent      INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE lost_pet_reports ADD COLUMN IF NOT EXISTS resolved_at      TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS lost_pet_reports_case_idx ON lost_pet_reports (case_status, moderation, lower(city));

-- ── found pets ──
CREATE TABLE IF NOT EXISTS found_pet_reports (
  id               BIGSERIAL    PRIMARY KEY,
  finder_id        UUID         NOT NULL,
  species          VARCHAR(30)  NOT NULL,
  breed_guess      VARCHAR(100),
  gender           VARCHAR(10),
  age_guess        VARCHAR(40),
  color            VARCHAR(100),
  marks            TEXT,
  collar           VARCHAR(200),
  microchip_seen   VARCHAR(40),                       -- private; public sees last 4 only
  description      TEXT,
  photos           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  area             VARCHAR(200) NOT NULL,
  city             VARCHAR(100),
  state            VARCHAR(100),
  lat              NUMERIC(10,7),
  lng              NUMERIC(10,7),
  public_lat       NUMERIC(9,5),
  public_lng       NUMERIC(9,5),
  found_at         TIMESTAMPTZ  NOT NULL,
  safety           VARCHAR(20)  NOT NULL DEFAULT 'with_finder',   -- with_finder, at_shelter, at_vet, on_street
  can_hold         BOOLEAN      NOT NULL DEFAULT FALSE,           -- finder can keep the pet safe for a while
  shelter_note     VARCHAR(300),
  case_status      VARCHAR(20)  NOT NULL DEFAULT 'found',         -- found, sheltered, owner_identified, reunited, closed, archived
  moderation       VARCHAR(10)  NOT NULL DEFAULT 'visible',
  moderation_note  VARCHAR(300),
  source_lang      VARCHAR(5)   NOT NULL DEFAULT 'en',
  alerts_sent      INTEGER      NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS found_pet_reports_case_idx ON found_pet_reports (case_status, moderation, lower(city));

-- ── sightings (attached to a lost or found case) ──
CREATE TABLE IF NOT EXISTS pet_sightings (
  id          BIGSERIAL    PRIMARY KEY,
  case_type   VARCHAR(5)   NOT NULL,     -- lost, found
  case_id     BIGINT       NOT NULL,
  user_id     UUID         NOT NULL,
  seen_at     TIMESTAMPTZ  NOT NULL,
  area        VARCHAR(200) NOT NULL,
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  public_lat  NUMERIC(9,5),
  public_lng  NUMERIC(9,5),
  direction   VARCHAR(30),
  description TEXT,
  photo_url   TEXT,
  source_lang VARCHAR(5)   NOT NULL DEFAULT 'en',
  status      VARCHAR(12)  NOT NULL DEFAULT 'new',   -- new, useful, not_relevant
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pet_sightings_case_idx ON pet_sightings (case_type, case_id, seen_at DESC);

-- ── protected contact relay: messages between the case owner and one other person ──
CREATE TABLE IF NOT EXISTS pb_case_messages (
  id          BIGSERIAL    PRIMARY KEY,
  case_type   VARCHAR(5)   NOT NULL,
  case_id     BIGINT       NOT NULL,
  thread_user UUID         NOT NULL,     -- the person talking to the owner
  from_user   UUID         NOT NULL,
  body        VARCHAR(2000) NOT NULL,
  source_lang VARCHAR(5)   NOT NULL DEFAULT 'en',
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_case_messages_thread_idx ON pb_case_messages (case_type, case_id, thread_user, created_at);

-- ── case history / audit ──
CREATE TABLE IF NOT EXISTS pb_case_updates (
  id          BIGSERIAL    PRIMARY KEY,
  case_type   VARCHAR(5)   NOT NULL,
  case_id     BIGINT       NOT NULL,
  actor       UUID,
  action      VARCHAR(30)  NOT NULL,
  from_status VARCHAR(20),
  to_status   VARCHAR(20),
  note        VARCHAR(500),
  is_public   BOOLEAN      NOT NULL DEFAULT TRUE,
  at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_case_updates_case_idx ON pb_case_updates (case_type, case_id, at);

CREATE TABLE IF NOT EXISTS pb_case_flags (
  id         BIGSERIAL    PRIMARY KEY,
  case_type  VARCHAR(5)   NOT NULL,
  case_id    BIGINT       NOT NULL,
  user_id    UUID         NOT NULL,
  reason     VARCHAR(30)  NOT NULL,      -- fake, duplicate, wrong_info, scam, bad_translation, abuse, other
  details    VARCHAR(500),
  status     VARCHAR(10)  NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_case_flags_once_uq ON pb_case_flags (case_type, case_id, user_id) WHERE status = 'open';

-- ── volunteers ──
CREATE TABLE IF NOT EXISTS pb_rescue_volunteers (
  user_id       UUID         PRIMARY KEY,
  city          VARCHAR(100) NOT NULL,
  state         VARCHAR(100),
  lat           NUMERIC(9,5),
  lng           NUMERIC(9,5),
  radius_km     SMALLINT     NOT NULL DEFAULT 5,
  can_search    BOOLEAN      NOT NULL DEFAULT TRUE,
  can_transport BOOLEAN      NOT NULL DEFAULT FALSE,
  can_foster    BOOLEAN      NOT NULL DEFAULT FALSE,
  languages     TEXT[]       NOT NULL DEFAULT '{}',
  safety_ack    BOOLEAN      NOT NULL DEFAULT FALSE,
  verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── language + alert preferences (used across PawBook) ──
CREATE TABLE IF NOT EXISTS pb_user_prefs (
  user_id         UUID         PRIMARY KEY,
  ui_lang         VARCHAR(5)   NOT NULL DEFAULT 'en',
  notify_lang     VARCHAR(5)   NOT NULL DEFAULT 'en',
  extra_langs     TEXT[]       NOT NULL DEFAULT '{}',
  auto_translate  BOOLEAN      NOT NULL DEFAULT TRUE,
  show_original   BOOLEAN      NOT NULL DEFAULT TRUE,
  alerts_on       BOOLEAN      NOT NULL DEFAULT FALSE,     -- nearby lost/found alerts (opt-in)
  alert_city      VARCHAR(100),
  alert_state     VARCHAR(100),
  alert_lat       NUMERIC(9,5),
  alert_lng       NUMERIC(9,5),
  alert_radius_km SMALLINT     NOT NULL DEFAULT 5,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── machine translations (originals are never changed) ──
CREATE TABLE IF NOT EXISTS pb_translations (
  source_type VARCHAR(12)  NOT NULL,     -- lost, found, sighting, message
  source_id   BIGINT       NOT NULL,
  lang        VARCHAR(5)   NOT NULL,
  src_hash    VARCHAR(64)  NOT NULL,     -- hash of the original text; a change makes the translation stale
  fields      JSONB        NOT NULL,
  model       VARCHAR(60),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_type, source_id, lang)
);

-- ── alert distribution log (one alert per person per case) ──
CREATE TABLE IF NOT EXISTS pb_alert_log (
  id         BIGSERIAL    PRIMARY KEY,
  case_type  VARCHAR(5)   NOT NULL,
  case_id    BIGINT       NOT NULL,
  recipient  UUID         NOT NULL,
  lang       VARCHAR(5)   NOT NULL,
  reason     VARCHAR(12)  NOT NULL,      -- nearby, volunteer, partner, owner
  channel    VARCHAR(10)  NOT NULL DEFAULT 'in_app',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_alert_log_once_uq ON pb_alert_log (case_type, case_id, recipient);
CREATE INDEX IF NOT EXISTS pb_alert_log_recipient_idx ON pb_alert_log (recipient, created_at);
