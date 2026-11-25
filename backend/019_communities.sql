-- PawBook Communities (page 03). Safe to run more than once. Builds on the existing "Group" tables
-- ("Group", "GroupMember", "GroupJoinRequest", "GroupInvite"), adds a few columns and new tables for posts,
-- comments, likes, meetup RSVPs and reports. Nothing is dropped.

ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS country         VARCHAR(80)  NOT NULL DEFAULT 'India';
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS state           VARCHAR(100);
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS area            VARCHAR(120);
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS rules           TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS pet_types       TEXT[]       NOT NULL DEFAULT '{}';
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS languages       TEXT[]       NOT NULL DEFAULT '{}';
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS join_question   VARCHAR(200);
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS is_verified     BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS verified_at     TIMESTAMPTZ;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS moderation      VARCHAR(10)  NOT NULL DEFAULT 'visible';   -- visible, hidden
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS moderation_note VARCHAR(300);
CREATE INDEX IF NOT EXISTS group_place_idx ON "Group" (lower(country), lower(state), lower(city)) WHERE is_active;

ALTER TABLE "GroupJoinRequest" ADD COLUMN IF NOT EXISTS answer        TEXT;
ALTER TABLE "GroupJoinRequest" ADD COLUMN IF NOT EXISTS decision_note VARCHAR(300);

CREATE TABLE IF NOT EXISTS pb_group_posts (
  post_id      BIGSERIAL    PRIMARY KEY,
  group_id     UUID         NOT NULL REFERENCES "Group"(group_id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL,
  kind         VARCHAR(10)  NOT NULL DEFAULT 'post',      -- post, question, meetup, alert
  body         TEXT         NOT NULL,
  photos       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  meetup_at    TIMESTAMPTZ,
  meetup_place VARCHAR(200),
  pinned       BOOLEAN      NOT NULL DEFAULT FALSE,
  hidden       BOOLEAN      NOT NULL DEFAULT FALSE,
  hidden_note  VARCHAR(300),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_group_posts_group_idx ON pb_group_posts (group_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS pb_group_posts_meetup_idx ON pb_group_posts (meetup_at) WHERE kind = 'meetup';

CREATE TABLE IF NOT EXISTS pb_group_post_likes (
  post_id    BIGINT       NOT NULL REFERENCES pb_group_posts(post_id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS pb_group_comments (
  comment_id BIGSERIAL    PRIMARY KEY,
  post_id    BIGINT       NOT NULL REFERENCES pb_group_posts(post_id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL,
  body       VARCHAR(1500) NOT NULL,
  hidden     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_group_comments_post_idx ON pb_group_comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS pb_group_rsvps (
  post_id    BIGINT       NOT NULL REFERENCES pb_group_posts(post_id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL,
  status     VARCHAR(10)  NOT NULL DEFAULT 'going',      -- going, maybe
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS pb_group_reports (
  report_id  BIGSERIAL    PRIMARY KEY,
  group_id   UUID         NOT NULL,
  post_id    BIGINT,
  comment_id BIGINT,
  user_id    UUID         NOT NULL,
  reason     VARCHAR(20)  NOT NULL,     -- spam, scam, abuse, cruelty, selling, fake, other
  details    VARCHAR(500),
  status     VARCHAR(10)  NOT NULL DEFAULT 'open',
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_group_reports_once_uq ON pb_group_reports (group_id, COALESCE(post_id, 0), COALESCE(comment_id, 0), user_id) WHERE status = 'open';
