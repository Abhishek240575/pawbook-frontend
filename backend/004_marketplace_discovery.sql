-- ============================================================================
-- PawBook Migration 004: Marketplace 2.0 — discovery completion
-- Categories (admin-managed), brand profiles, product Q&A, search synonyms,
-- fuzzy search (pg_trgm) and a search log for popular searches.
-- Additive only. Safe to run more than once.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Categories (replaces the hard-coded list; seeded with the same 16) ──────
CREATE TABLE IF NOT EXISTS marketplace_categories (
  slug          VARCHAR(40) PRIMARY KEY,
  name          VARCHAR(80) NOT NULL,                -- English display name
  name_i18n     JSONB       NOT NULL DEFAULT '{}',   -- {"hi":"खाना","ta":"உணவு"}
  icon          VARCHAR(60) NOT NULL DEFAULT 'ti-tag',
  image_url     TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 100,
  show_on_home  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO marketplace_categories (slug, name, icon, sort_order, show_on_home) VALUES
  ('food','Food','ti-bowl',10,TRUE), ('treats','Treats','ti-bone',20,TRUE), ('toys','Toys','ti-ball-tennis',30,TRUE),
  ('grooming','Grooming','ti-sparkles',40,TRUE), ('walk','Collars & leashes','ti-route',50,TRUE), ('beds','Beds','ti-bed',60,TRUE),
  ('clothing','Clothing','ti-shirt',70,TRUE), ('health','Health & wellness','ti-heartbeat',80,TRUE),
  ('bowls','Bowls & feeders','ti-tools-kitchen-2',90,FALSE), ('litter','Litter & hygiene','ti-box',100,FALSE),
  ('aquarium','Aquarium','ti-fish',110,FALSE), ('cages','Cages & habitats','ti-building-cottage',120,FALSE),
  ('travel','Travel','ti-car',130,FALSE), ('training','Training','ti-target',140,FALSE),
  ('accessories','Accessories','ti-tag',150,FALSE), ('other','Other','ti-dots',990,FALSE)
ON CONFLICT (slug) DO NOTHING;

-- ── Brand profiles (table created in 003; add storefront fields) ────────────
ALTER TABLE marketplace_brands
  ADD COLUMN IF NOT EXISTS tagline    VARCHAR(160),
  ADD COLUMN IF NOT EXISTS website    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS country    VARCHAR(80),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── Product questions & answers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_questions (
  question_id  BIGSERIAL PRIMARY KEY,
  product_id   TEXT        NOT NULL,
  user_id      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  question     TEXT        NOT NULL CHECK (char_length(question) BETWEEN 5 AND 500),
  status       VARCHAR(12) NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mp_questions_product ON marketplace_questions (product_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_answers (
  answer_id    BIGSERIAL PRIMARY KEY,
  question_id  BIGINT      NOT NULL REFERENCES marketplace_questions(question_id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  answer       TEXT        NOT NULL CHECK (char_length(answer) BETWEEN 2 AND 1000),
  is_seller    BOOLEAN     NOT NULL DEFAULT FALSE,
  status       VARCHAR(12) NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mp_answers_question ON marketplace_answers (question_id, status);

-- ── Search: synonyms, fuzzy matching, popular searches ──────────────────────
CREATE TABLE IF NOT EXISTS marketplace_search_synonyms (
  term      VARCHAR(60) PRIMARY KEY,        -- what people type (lower-case)
  expands   TEXT[]      NOT NULL            -- what it should also match
);
INSERT INTO marketplace_search_synonyms (term, expands) VALUES
  ('kibble','{dry food}'), ('dry food','{kibble}'), ('pup','{puppy}'), ('pupper','{puppy}'), ('doggo','{dog}'),
  ('kitty','{cat,kitten}'), ('kitten','{cat}'), ('puppy','{dog}'), ('leash','{lead}'), ('lead','{leash}'),
  ('harness','{leash,collar}'), ('poop bags','{waste bags}'), ('shampoo','{grooming}'), ('brush','{grooming,comb}'),
  ('tick','{flea}'), ('flea','{tick}'), ('chew','{toy,dental}'), ('biscuit','{treats}'), ('snack','{treats}'),
  ('crate','{kennel,cage}'), ('kennel','{crate,cage}'), ('bed','{mat,cushion}'), ('litter box','{litter tray}'),
  ('fish tank','{aquarium}'), ('aquarium','{fish tank}'), ('budgie','{bird,parakeet}'), ('parrot','{bird}'),
  -- Hinglish / Hindi
  ('kutta','{dog}'), ('kutte','{dog}'), ('billi','{cat}'), ('khana','{food}'), ('khaana','{food}'),
  ('khilona','{toy}'), ('khilone','{toys}'), ('patta','{collar}'), ('bistar','{bed}'), ('kapde','{clothing}'),
  ('dawai','{health,medicine}'), ('chidiya','{bird}'), ('machli','{fish}'), ('khargosh','{rabbit}'),
  ('कुत्ता','{dog}'), ('कुत्ते','{dog}'), ('बिल्ली','{cat}'), ('खाना','{food}'), ('खिलौना','{toy}'), ('खिलौने','{toys}'),
  ('पट्टा','{collar}'), ('बिस्तर','{bed}'), ('पक्षी','{bird}'), ('मछली','{fish}')
ON CONFLICT (term) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_mp_products_name_trgm  ON marketplace_products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mp_products_brand_trgm ON marketplace_products USING GIN (brand gin_trgm_ops);

CREATE TABLE IF NOT EXISTS marketplace_search_log (
  id          BIGSERIAL PRIMARY KEY,
  q           VARCHAR(80) NOT NULL,
  results     INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mp_search_log_created ON marketplace_search_log (created_at DESC);
