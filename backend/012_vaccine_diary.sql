-- PawBook Vaccination Diary (page 10). Safe to run more than once.
-- The existing pet_vaccinations table is NOT changed; extra details live in a side table keyed by its id.

CREATE TABLE IF NOT EXISTS pet_vaccine_details (
  vaccination_id TEXT         PRIMARY KEY,           -- pet_vaccinations primary key, as text
  pet_id         TEXT         NOT NULL,
  brand          VARCHAR(80),
  manufacturer   VARCHAR(80),
  clinic         VARCHAR(120),
  dose_label     VARCHAR(40),                        -- e.g. "1st dose", "Booster"
  reaction       TEXT,                               -- reactions / side effects the owner noticed
  cert_doc_id    BIGINT,                             -- pet_care_docs.doc_id (private certificate file)
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pet_vaccine_details_pet_idx ON pet_vaccine_details (pet_id);

-- Every add / edit / delete of a vaccination record is kept here, so the history stays auditable.
CREATE TABLE IF NOT EXISTS pet_vaccine_audit (
  audit_id       BIGSERIAL    PRIMARY KEY,
  pet_id         TEXT         NOT NULL,
  vaccination_id TEXT         NOT NULL,
  owner_id       TEXT         NOT NULL,              -- users.user_id of who made the change
  action         VARCHAR(10)  NOT NULL,
  changes        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pet_vaccine_audit ADD CONSTRAINT pet_vaccine_audit_action_chk CHECK (action IN ('created','updated','deleted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS pet_vaccine_audit_pet_idx ON pet_vaccine_audit (pet_id, at DESC);

-- How early vaccine reminders show up (days before the due date). Table was created by migration 011.
ALTER TABLE pet_care_settings ADD COLUMN IF NOT EXISTS reminder_lead_days INTEGER;
