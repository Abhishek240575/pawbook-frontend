-- My PawBook (page 31): collections, memories flags, birthdays & milestones, journey preferences. Safe to run more than once.
-- Existing tables are NOT changed. Saved posts stay in saved_posts, saved products in marketplace_wishlist,
-- saved events in event_attendees ('interested'), memories in pet_health_logs (kind 'memory').

-- Other things people save (vets, tips, training resources, places) — a snapshot so the card still shows if the source changes
CREATE TABLE IF NOT EXISTS pb_saved_items (
  item_id     BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL,
  kind        VARCHAR(12)  NOT NULL,            -- vet, tip, training, place
  ref         VARCHAR(120) NOT NULL,            -- id or link of the thing saved
  title       VARCHAR(160) NOT NULL,
  image       TEXT,
  url         TEXT,
  note        VARCHAR(300),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pb_saved_items ADD CONSTRAINT pb_saved_items_kind_chk CHECK (kind IN ('vet','tip','training','place'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pb_saved_items_uq ON pb_saved_items (user_id, kind, ref);

-- Custom collections ("Bruno's favourite toys") and what is in them (any saved kind)
CREATE TABLE IF NOT EXISTS pb_collections (
  collection_id BIGSERIAL   PRIMARY KEY,
  user_id       UUID        NOT NULL,
  name          VARCHAR(60) NOT NULL,
  emoji         VARCHAR(8),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_collections_name_uq ON pb_collections (user_id, lower(name));
CREATE TABLE IF NOT EXISTS pb_collection_items (
  collection_id BIGINT       NOT NULL REFERENCES pb_collections(collection_id) ON DELETE CASCADE,
  kind          VARCHAR(12)  NOT NULL,          -- post, product, event, vet, tip, training, place
  ref           VARCHAR(120) NOT NULL,
  added_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, kind, ref)
);

-- Highlight / hide for memories (both the owner's own memories and the automatic "firsts")
CREATE TABLE IF NOT EXISTS pb_memory_flags (
  user_id     UUID        NOT NULL,
  mkey        VARCHAR(80) NOT NULL,             -- "log:123" or "auto:first_vax:45"
  highlighted BOOLEAN     NOT NULL DEFAULT FALSE,
  hidden      BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, mkey)
);

-- Birthdays, gotcha days and reminder preferences per pet (pets table has no birth date column)
CREATE TABLE IF NOT EXISTS pb_pet_milestones (
  pet_id           TEXT        PRIMARY KEY,     -- pets primary key, as text
  owner_id         TEXT        NOT NULL,        -- users.user_id of the owner
  birth_date       DATE,
  birth_precision  VARCHAR(10) NOT NULL DEFAULT 'unknown',   -- exact, estimated, unknown
  gotcha_date      DATE,                        -- the day the pet came home
  gotcha_kind      VARCHAR(10) NOT NULL DEFAULT 'home',      -- adoption, home
  share_birthday   BOOLEAN     NOT NULL DEFAULT TRUE,        -- followers can see the day and month (never the year)
  remind_week      BOOLEAN     NOT NULL DEFAULT TRUE,
  remind_day       BOOLEAN     NOT NULL DEFAULT TRUE,
  wishes_notify    BOOLEAN     NOT NULL DEFAULT TRUE,
  week_reminded    INTEGER,                     -- year of the last 7-day reminder sent
  day_reminded     INTEGER,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE pb_pet_milestones ADD CONSTRAINT pb_pet_milestones_chk CHECK (birth_precision IN ('exact','estimated','unknown') AND gotcha_kind IN ('adoption','home'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pb_birthday_wishes (
  wish_id    BIGSERIAL    PRIMARY KEY,
  pet_id     TEXT         NOT NULL,
  from_user  UUID         NOT NULL,
  year       INTEGER      NOT NULL,
  message    VARCHAR(300) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_birthday_wishes_once_uq ON pb_birthday_wishes (pet_id, from_user, year);
CREATE INDEX IF NOT EXISTS pb_birthday_wishes_pet_idx ON pb_birthday_wishes (pet_id, year);

-- Journey: items the user removed from their own history view, and "clear history"
CREATE TABLE IF NOT EXISTS pb_journey_hidden (
  user_id UUID        NOT NULL,
  ikey    VARCHAR(80) NOT NULL,
  PRIMARY KEY (user_id, ikey)
);
CREATE TABLE IF NOT EXISTS pb_journey_prefs (
  user_id        UUID        PRIMARY KEY,
  cleared_before TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
