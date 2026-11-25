-- PawBook Adoption 2.0 (page 39). Safe to run more than once.
-- Extends the existing adoption tables (adoptable_pets, adoption_inquiries, shelters) with new columns
-- and adds tables only for things that did not exist (preferences, wishlist, stage history, partners, reports,
-- follow-ups, fosters, stories). Nothing is dropped or renamed; the old /adoptions API keeps working.

-- ── pets: full adoption profile (unknown stays NULL / 'unknown' — never guessed) ──
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS photos          TEXT[]       NOT NULL DEFAULT '{}';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS video_url       TEXT;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS age_months      INTEGER;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS age_estimated   BOOLEAN      NOT NULL DEFAULT TRUE;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS size            VARCHAR(10);              -- small, medium, large
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS energy          VARCHAR(10);              -- low, medium, high
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS good_with_kids  VARCHAR(10)  NOT NULL DEFAULT 'unknown';  -- yes, no, unknown
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS good_with_dogs  VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS good_with_cats  VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS apartment_ok    VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS house_trained   VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS vaccinated      VARCHAR(10)  NOT NULL DEFAULT 'unknown';  -- yes, partial, no, unknown
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS sterilized      VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS microchipped    VARCHAR(10)  NOT NULL DEFAULT 'unknown';
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS care_level      VARCHAR(10);              -- easy, moderate, demanding
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS temperament     TEXT;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS rescue_story    TEXT;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS health_notes    TEXT;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS special_needs   TEXT;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS requirements    TEXT;                     -- what the rescuer asks of adopters
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS adoption_fee    NUMERIC(10,2);
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS fee_note        VARCHAR(200);
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS listed_by       UUID;
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS moderation      VARCHAR(12)  NOT NULL DEFAULT 'approved';  -- pending, approved, rejected, hidden
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS moderation_note VARCHAR(300);
ALTER TABLE adoptable_pets ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS adoptable_pets_browse_idx ON adoptable_pets (status, moderation, lower(location_city));

-- ── applications: screening workflow on the existing adoption_inquiries ──
ALTER TABLE adoption_inquiries ADD COLUMN IF NOT EXISTS stage               VARCHAR(20) NOT NULL DEFAULT 'submitted';
ALTER TABLE adoption_inquiries ADD COLUMN IF NOT EXISTS answers             JSONB       NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE adoption_inquiries ADD COLUMN IF NOT EXISTS ownership_confirmed BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE adoption_inquiries ADD COLUMN IF NOT EXISTS decision_note       VARCHAR(500);
ALTER TABLE adoption_inquiries ADD COLUMN IF NOT EXISTS stage_updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS adoption_inquiries_user_idx ON adoption_inquiries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adoption_stage_history (
  id          BIGSERIAL    PRIMARY KEY,
  inquiry_id  UUID         NOT NULL REFERENCES adoption_inquiries(inquiry_id) ON DELETE CASCADE,
  from_stage  VARCHAR(20),
  to_stage    VARCHAR(20)  NOT NULL,
  note        VARCHAR(500),
  by_user     UUID,
  visible_to_applicant BOOLEAN NOT NULL DEFAULT TRUE,
  at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adoption_stage_history_inq_idx ON adoption_stage_history (inquiry_id, at);

-- ── shelters / rescue partners ──
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS org_type       VARCHAR(20);     -- shelter, rescue, ngo, individual
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS about          TEXT;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS adoption_policy TEXT;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS photo_url      TEXT;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS verified_at    TIMESTAMPTZ;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS verified_by    UUID;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS verification_note VARCHAR(300);  -- what was reviewed (shown publicly, no documents)

CREATE TABLE IF NOT EXISTS adoption_partner_users (
  shelter_id UUID        NOT NULL REFERENCES shelters(shelter_id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  role       VARCHAR(10) NOT NULL DEFAULT 'staff',   -- admin, staff
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shelter_id, user_id)
);
CREATE TABLE IF NOT EXISTS adoption_partner_requests (
  req_id           BIGSERIAL    PRIMARY KEY,
  user_id          UUID         NOT NULL,
  shelter_id       UUID,                              -- claiming an existing listing, or NULL for a new organisation
  org_name         VARCHAR(200) NOT NULL,
  org_type         VARCHAR(20)  NOT NULL,
  city             VARCHAR(100),
  state            VARCHAR(100),
  phone            VARCHAR(30),
  email            VARCHAR(200),
  registration_ref VARCHAR(120),                      -- private: seen only by PawBook admins
  about            TEXT,
  status           VARCHAR(10)  NOT NULL DEFAULT 'pending',   -- pending, approved, rejected
  decision_note    VARCHAR(300),
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS adoption_partner_requests_open_uq ON adoption_partner_requests (user_id) WHERE status = 'pending';

-- ── adopter side ──
CREATE TABLE IF NOT EXISTS adoption_preferences (
  user_id    UUID        PRIMARY KEY,
  answers    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS adoption_wishlist (
  user_id    UUID        NOT NULL,
  pet_id     INTEGER     NOT NULL REFERENCES adoptable_pets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, pet_id)
);
CREATE TABLE IF NOT EXISTS adoption_reports (
  report_id   BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL,
  pet_id      INTEGER      REFERENCES adoptable_pets(id) ON DELETE SET NULL,
  shelter_id  UUID         REFERENCES shelters(shelter_id) ON DELETE SET NULL,
  reason      VARCHAR(30)  NOT NULL,     -- suspicious_listing, fraud_fee, misleading_health, mistreatment, other
  details     VARCHAR(1000),
  status      VARCHAR(12)  NOT NULL DEFAULT 'open',   -- open, resolved, dismissed
  resolution_note VARCHAR(500),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS adoption_reports_once_uq ON adoption_reports (user_id, COALESCE(pet_id, 0), COALESCE(shelter_id::text, '')) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS adoption_followups (
  id          BIGSERIAL    PRIMARY KEY,
  inquiry_id  UUID         NOT NULL REFERENCES adoption_inquiries(inquiry_id) ON DELETE CASCADE,
  note        VARCHAR(1000) NOT NULL,
  wellbeing   VARCHAR(10)  NOT NULL DEFAULT 'good',   -- good, concern
  by_user     UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS adoption_fosters (
  user_id     UUID         PRIMARY KEY,
  city        VARCHAR(100) NOT NULL,
  state       VARCHAR(100),
  species     TEXT[]       NOT NULL DEFAULT '{}',
  capacity    SMALLINT     NOT NULL DEFAULT 1,
  home_type   VARCHAR(20),
  experience  VARCHAR(20),
  notes       VARCHAR(500),
  phone       VARCHAR(30),
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS adoption_stories (
  story_id    BIGSERIAL    PRIMARY KEY,
  inquiry_id  UUID         REFERENCES adoption_inquiries(inquiry_id) ON DELETE SET NULL,
  pet_id      INTEGER      REFERENCES adoptable_pets(id) ON DELETE SET NULL,
  user_id     UUID         NOT NULL,
  title       VARCHAR(120) NOT NULL,
  story       VARCHAR(2000) NOT NULL,
  photo_url   TEXT,
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending',   -- pending, approved, hidden
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS adoption_stories_once_uq ON adoption_stories (inquiry_id) WHERE inquiry_id IS NOT NULL;
