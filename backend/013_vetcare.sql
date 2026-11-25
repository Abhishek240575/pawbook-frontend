-- PawBook VetCare (Vet Portal, page 41). Safe to run more than once.
-- Existing tables (vets, vet_appointments, vet_availability, prescriptions, pets, users) are NOT changed.

-- Clinic team: people a vet lets into their workspace (the vet themself is identified through vets.user_id)
CREATE TABLE IF NOT EXISTS vet_clinic_staff (
  staff_id    BIGSERIAL    PRIMARY KEY,
  vet_id      UUID         NOT NULL,
  user_id     UUID         NOT NULL,
  role        VARCHAR(15)  NOT NULL,
  added_by    UUID         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE vet_clinic_staff ADD CONSTRAINT vet_clinic_staff_role_chk CHECK (role IN ('receptionist','admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS vet_clinic_staff_active_uq ON vet_clinic_staff (vet_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS vet_clinic_staff_user_idx ON vet_clinic_staff (user_id) WHERE removed_at IS NULL;

-- Waiting room (checked-in appointments and walk-ins)
CREATE TABLE IF NOT EXISTS vet_queue (
  queue_id       BIGSERIAL    PRIMARY KEY,
  vet_id         UUID         NOT NULL,
  appointment_id UUID,
  pet_id         INTEGER,
  walkin_name    VARCHAR(80),
  walkin_species VARCHAR(40),
  walkin_owner   VARCHAR(120),
  reason         VARCHAR(200),
  priority       VARCHAR(10)  NOT NULL DEFAULT 'routine',
  status         VARCHAR(12)  NOT NULL DEFAULT 'waiting',
  checked_in_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  called_at      TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  checked_in_by  UUID         NOT NULL,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE vet_queue ADD CONSTRAINT vet_queue_priority_chk CHECK (priority IN ('routine','priority','urgent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE vet_queue ADD CONSTRAINT vet_queue_status_chk CHECK (status IN ('waiting','in_consult','done','left'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- one open queue entry per appointment (stops double check-in from two desks)
CREATE UNIQUE INDEX IF NOT EXISTS vet_queue_open_appt_uq ON vet_queue (appointment_id) WHERE appointment_id IS NOT NULL AND status IN ('waiting','in_consult');
CREATE INDEX IF NOT EXISTS vet_queue_vet_idx ON vet_queue (vet_id, checked_in_at DESC);

-- Consultation records (append-only: an edit adds a new version and marks the old one superseded)
CREATE TABLE IF NOT EXISTS vet_clinical_notes (
  note_id        BIGSERIAL    PRIMARY KEY,
  vet_id         UUID         NOT NULL,
  pet_id         INTEGER      NOT NULL,
  appointment_id UUID,
  author_id      UUID         NOT NULL,
  weight_kg      NUMERIC(6,2),
  temperature_c  NUMERIC(4,1),
  heart_rate     INTEGER,
  resp_rate      INTEGER,
  diagnosis      VARCHAR(200),
  notes          TEXT,
  allergies      VARCHAR(300),
  follow_up_date DATE,
  supersedes     BIGINT,
  superseded_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vet_clinical_notes_pet_idx ON vet_clinical_notes (vet_id, pet_id, created_at DESC);

-- Audit trail: who viewed or changed which patient record, and every appointment / queue action
CREATE TABLE IF NOT EXISTS vet_activity (
  activity_id BIGSERIAL    PRIMARY KEY,
  vet_id      UUID         NOT NULL,
  user_id     UUID         NOT NULL,
  pet_id      INTEGER,
  action      VARCHAR(30)  NOT NULL,
  ref         VARCHAR(80),
  detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vet_activity_vet_idx ON vet_activity (vet_id, at DESC);
CREATE INDEX IF NOT EXISTS vet_activity_pet_idx ON vet_activity (vet_id, pet_id, at DESC);

-- Owner notifications the portal tried to send (delivery tracking)
CREATE TABLE IF NOT EXISTS vet_notifications (
  notif_id       BIGSERIAL    PRIMARY KEY,
  vet_id         UUID         NOT NULL,
  appointment_id UUID,
  channel        VARCHAR(20)  NOT NULL,
  event          VARCHAR(30)  NOT NULL,
  result         VARCHAR(20)  NOT NULL,
  error          VARCHAR(200),
  at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vet_notifications_vet_idx ON vet_notifications (vet_id, at DESC);
