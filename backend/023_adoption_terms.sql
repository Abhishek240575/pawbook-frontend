-- 023: Adoption terms (page 39). Records when someone reads PawBook's adoption policy, rules, documents and
-- compliance and either AGREES (required before an adoption application) or QUITS. Only ADDS one table. Safe to run twice.
CREATE TABLE IF NOT EXISTS adoption_terms_events (
  event_id    BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  version     VARCHAR(20) NOT NULL,
  action      VARCHAR(10) NOT NULL CHECK (action IN ('accepted','declined')),
  sections    TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adoption_terms_events_user ON adoption_terms_events (user_id, version, created_at DESC);
