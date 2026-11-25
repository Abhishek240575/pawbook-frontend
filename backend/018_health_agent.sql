-- PawBook AI Health Agent (page 37). Safe to run more than once. Only adds tables.
-- Vitals the owner measures at home, symptom-check history, and the owner's own emergency contacts.
-- Weight keeps using pet_health_logs (Pet Health page); vaccines keep using the vaccination diary.

CREATE TABLE IF NOT EXISTS pb_pet_vitals (
  id          BIGSERIAL    PRIMARY KEY,
  pet_id      VARCHAR(64)  NOT NULL,
  user_id     UUID         NOT NULL,
  heart_rate  SMALLINT,                 -- beats per minute
  resp_rate   SMALLINT,                 -- breaths per minute (at rest)
  temp_f      NUMERIC(4,1),             -- °F
  gums        VARCHAR(10),              -- pink, pale, blue, red, yellow
  note        VARCHAR(300),
  measured_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_pet_vitals_pet_idx ON pb_pet_vitals (pet_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS pb_symptom_checks (
  id         BIGSERIAL    PRIMARY KEY,
  pet_id     VARCHAR(64)  NOT NULL,
  user_id    UUID         NOT NULL,
  symptoms   TEXT[]       NOT NULL,
  duration   VARCHAR(10),               -- now, today, days, week
  level      VARCHAR(10)  NOT NULL,     -- emergency, urgent, monitor, mild
  note       VARCHAR(500),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_symptom_checks_pet_idx ON pb_symptom_checks (pet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pb_emergency_contacts (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         NOT NULL,
  name       VARCHAR(100) NOT NULL,
  role       VARCHAR(60),
  phone      VARCHAR(30)  NOT NULL,
  note       VARCHAR(200),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pb_emergency_contacts_user_idx ON pb_emergency_contacts (user_id);
