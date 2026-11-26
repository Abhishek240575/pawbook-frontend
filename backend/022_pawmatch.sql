-- 022: PawMatch 2.0 — real pet matchmaking (page 35). Only ADDS new tables; nothing existing is changed.
-- Each pet gets a PawMatch profile with several match types (playdate, walk buddy, companion, breeding).
-- Swipes are per match type; a mutual like = a match; matched owners chat and fix a date (one side offers
-- up to 3 date/time options + a place, the other picks one). Owners' phone/email/exact location are never shared.
-- Tables use the pm_ prefix so they never clash with tables from the earlier PawMatch (e.g. an old pawmatch_swipes).
-- Safe to run twice.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pm_profiles (
  profile_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  pet_ref      TEXT,                                   -- the pet in My Pets this profile was made from (optional)
  name         VARCHAR(60) NOT NULL,
  species      VARCHAR(20) NOT NULL CHECK (species IN ('dog','cat','rabbit','bird','other')),
  breed        VARCHAR(80),
  gender       VARCHAR(10) NOT NULL CHECK (gender IN ('male','female')),
  birth_month  DATE,                                   -- first day of the birth month (age is worked out from it)
  size         VARCHAR(10) CHECK (size IN ('small','medium','large')),
  energy       VARCHAR(10) CHECK (energy IN ('calm','moderate','high')),
  traits       TEXT[] NOT NULL DEFAULT '{}',
  bio          VARCHAR(500),
  photos       TEXT[] NOT NULL DEFAULT '{}',
  city         VARCHAR(80) NOT NULL,
  area         VARCHAR(80),
  state        VARCHAR(80),
  lat          NUMERIC(7,3),                           -- rounded to ~100 m; never shown to others
  lng          NUMERIC(7,3),
  vaccinated   BOOLEAN NOT NULL DEFAULT FALSE,
  neutered     BOOLEAN NOT NULL DEFAULT FALSE,
  intents      TEXT[] NOT NULL DEFAULT '{playdate}',
  max_km       SMALLINT NOT NULL DEFAULT 15 CHECK (max_km BETWEEN 1 AND 200),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pm_profiles_owner_pet ON pm_profiles (owner_id, pet_ref) WHERE pet_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS pm_profiles_find ON pm_profiles (species, is_active);
CREATE INDEX IF NOT EXISTS pm_profiles_owner ON pm_profiles (owner_id);

CREATE TABLE IF NOT EXISTS pm_swipes (
  from_profile UUID NOT NULL REFERENCES pm_profiles(profile_id) ON DELETE CASCADE,
  to_profile   UUID NOT NULL REFERENCES pm_profiles(profile_id) ON DELETE CASCADE,
  intent       VARCHAR(20) NOT NULL,
  action       VARCHAR(8) NOT NULL CHECK (action IN ('like','pass')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_profile, to_profile, intent)
);
CREATE INDEX IF NOT EXISTS pm_swipes_to ON pm_swipes (to_profile, intent, action);

CREATE TABLE IF NOT EXISTS pm_matches (
  match_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_a    UUID NOT NULL REFERENCES pm_profiles(profile_id) ON DELETE CASCADE,
  profile_b    UUID NOT NULL REFERENCES pm_profiles(profile_id) ON DELETE CASCADE,
  intent       VARCHAR(20) NOT NULL,
  status       VARCHAR(12) NOT NULL DEFAULT 'matched' CHECK (status IN ('matched','unmatched')),
  ended_by     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (profile_a < profile_b),
  UNIQUE (profile_a, profile_b, intent)
);
CREATE INDEX IF NOT EXISTS pm_matches_a ON pm_matches (profile_a);
CREATE INDEX IF NOT EXISTS pm_matches_b ON pm_matches (profile_b);

CREATE TABLE IF NOT EXISTS pm_messages (
  message_id   BIGSERIAL PRIMARY KEY,
  match_id     UUID NOT NULL REFERENCES pm_matches(match_id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body         VARCHAR(1000) NOT NULL,
  kind         VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pm_messages_match ON pm_messages (match_id, message_id);

CREATE TABLE IF NOT EXISTS pm_reads (
  match_id     UUID NOT NULL REFERENCES pm_matches(match_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS pm_dates (
  date_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES pm_matches(match_id) ON DELETE CASCADE,
  proposed_by   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  slots         TIMESTAMPTZ[] NOT NULL,
  place         VARCHAR(160) NOT NULL,
  note          VARCHAR(300),
  status        VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','withdrawn','cancelled','done')),
  starts_at     TIMESTAMPTZ,                           -- the chosen option once confirmed
  responded_by  UUID,
  responded_at  TIMESTAMPTZ,
  reason        VARCHAR(300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pm_dates_one_active ON pm_dates (match_id) WHERE status IN ('pending','confirmed');
CREATE INDEX IF NOT EXISTS pm_dates_match ON pm_dates (match_id, created_at);

CREATE TABLE IF NOT EXISTS pm_reports (
  report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES pm_profiles(profile_id) ON DELETE CASCADE,
  match_id     UUID REFERENCES pm_matches(match_id) ON DELETE SET NULL,
  reason       VARCHAR(20) NOT NULL,
  details      VARCHAR(1000),
  status       VARCHAR(12) NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pm_reports_once ON pm_reports (reporter_id, profile_id);
