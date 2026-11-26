-- PawBook Assistant (page 35). Safe to run more than once. Only adds tables; nothing is changed or dropped.

-- the conversation with the assistant, kept per user so it survives a reload or a new device
CREATE TABLE IF NOT EXISTS pb_assistant_messages (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     TEXT         NOT NULL,
  role        VARCHAR(10)  NOT NULL,                     -- user, assistant
  body        TEXT         NOT NULL,
  intent      VARCHAR(30),
  cards       JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- results shown under a reply (links to PawBook pages)
  actions     JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- buttons shown under a reply
  source      VARCHAR(10),                               -- ai, rules
  helpful     BOOLEAN,                                   -- thumbs up / down from the user
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_assistant_messages_user_idx ON pb_assistant_messages (user_id, id DESC);

-- help requests raised from the assistant (support / grievance), answered by the PawBook team
CREATE TABLE IF NOT EXISTS pb_support_tickets (
  id          BIGSERIAL    PRIMARY KEY,
  ref         VARCHAR(20)  NOT NULL UNIQUE,              -- e.g. PB-261126-4821
  user_id     TEXT         NOT NULL,
  topic       VARCHAR(20)  NOT NULL,                     -- account, payment, order, vet, listing, safety, bug, grievance, other
  subject     VARCHAR(150) NOT NULL,
  message     TEXT         NOT NULL,
  page_url    VARCHAR(300),
  status      VARCHAR(12)  NOT NULL DEFAULT 'open',      -- open, in_progress, resolved, closed
  reply       TEXT,
  replied_by  TEXT,
  replied_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_support_tickets_user_idx ON pb_support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pb_support_tickets_open_idx ON pb_support_tickets (status, created_at) WHERE status IN ('open','in_progress');
