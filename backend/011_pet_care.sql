-- PawBook Pet Health page (36): owner-kept health records. Safe to run more than once.
-- Existing tables (pets, pet_vaccinations, vet_appointments, prescriptions) are NOT changed.

CREATE TABLE IF NOT EXISTS pet_health_logs (
  log_id     BIGSERIAL     PRIMARY KEY,
  pet_id     TEXT          NOT NULL,                -- pets primary key, as text
  owner_id   TEXT          NOT NULL,                -- users.user_id of the owner who recorded it
  kind       VARCHAR(12)   NOT NULL,                -- weight, walk, meal, water, sleep, mood, event, memory, med_dose
  logged_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  value      NUMERIC(10,2),                         -- kg, minutes, grams, ml, hours
  title      VARCHAR(120),
  details    TEXT,
  data       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pet_health_logs ADD CONSTRAINT pet_health_logs_kind_chk CHECK (kind IN ('weight','walk','meal','water','sleep','mood','event','memory','med_dose'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS pet_health_logs_pet_idx ON pet_health_logs (pet_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS pet_health_logs_owner_idx ON pet_health_logs (owner_id);

CREATE TABLE IF NOT EXISTS pet_medicines (
  med_id     BIGSERIAL     PRIMARY KEY,
  pet_id     TEXT          NOT NULL,
  owner_id   TEXT          NOT NULL,
  name       VARCHAR(100)  NOT NULL,
  dose       VARCHAR(80),
  frequency  VARCHAR(12)   NOT NULL,                -- daily, twice_daily, weekly, monthly, once, as_needed
  start_date DATE          NOT NULL,
  end_date   DATE,
  next_due   DATE,
  last_given TIMESTAMPTZ,
  active     BOOLEAN       NOT NULL DEFAULT TRUE,
  notes      TEXT,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pet_medicines ADD CONSTRAINT pet_medicines_freq_chk CHECK (frequency IN ('daily','twice_daily','weekly','monthly','once','as_needed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS pet_medicines_pet_idx ON pet_medicines (pet_id, active);

-- Vet prescriptions / reports uploaded by the owner. Files live privately on the server (~/pawbook_private/petdocs), never public URLs.
CREATE TABLE IF NOT EXISTS pet_care_docs (
  doc_id        BIGSERIAL    PRIMARY KEY,
  pet_id        TEXT         NOT NULL,
  owner_id      TEXT         NOT NULL,
  doc_kind      VARCHAR(20)  NOT NULL DEFAULT 'other',
  title         VARCHAR(120),
  stored_name   VARCHAR(80)  NOT NULL,
  original_name VARCHAR(160),
  mime          VARCHAR(40)  NOT NULL,
  size_bytes    INTEGER      NOT NULL,
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pet_care_docs_pet_idx ON pet_care_docs (pet_id, owner_id);

CREATE TABLE IF NOT EXISTS pet_care_settings (
  pet_id     TEXT        PRIMARY KEY,
  goal_min   INTEGER,                                -- daily exercise goal set by the owner
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
