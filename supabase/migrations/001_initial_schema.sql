-- ============================================================
-- TREINO & DIETA — Schema inicial
-- Execute no SQL Editor do Supabase (supabase.com → SQL Editor)
-- ============================================================

-- Habilitar uuid_generate_v4
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── user_profiles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  birth_date  DATE,
  height_cm   SMALLINT DEFAULT 172,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── daily_logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                DATE NOT NULL,

  weight_kg           NUMERIC(5,2),
  surplus_deficit_kcal NUMERIC(7,1),

  -- Calories per activity (kcal)
  kcal_academia       NUMERIC(7,1),
  kcal_boxe           NUMERIC(7,1),
  kcal_surf           NUMERIC(7,1),
  kcal_corrida        NUMERIC(7,1),
  kcal_crossfit       NUMERIC(7,1),
  kcal_musculacao     NUMERIC(7,1),
  kcal_outros         NUMERIC(7,1),

  -- Duration per activity (minutes)
  min_academia        NUMERIC(6,1),
  min_boxe            NUMERIC(6,1),
  min_surf            NUMERIC(6,1),
  min_corrida         NUMERIC(6,1),
  min_crossfit        NUMERIC(6,1),
  min_musculacao      NUMERIC(6,1),
  min_sauna           NUMERIC(6,1),

  -- Temperature per activity (°C)
  temp_academia       NUMERIC(4,1),
  temp_boxe           NUMERIC(4,1),
  temp_surf           NUMERIC(4,1),
  temp_corrida        NUMERIC(4,1),
  temp_sauna          NUMERIC(5,1),

  -- Heart rate per activity (bpm)
  bpm_academia        SMALLINT,
  bpm_boxe            SMALLINT,
  bpm_surf            SMALLINT,
  bpm_corrida         SMALLINT,
  bpm_sauna           SMALLINT,

  -- Whoop (auto-populated via API)
  whoop_strain        NUMERIC(4,1),
  whoop_recovery      SMALLINT,
  whoop_kcal          NUMERIC(7,1),

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date
  ON daily_logs (user_id, date DESC);

-- ─── run_sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  interval_type         TEXT NOT NULL DEFAULT 'Easy',
  distance_km           NUMERIC(6,3),
  duration_min          NUMERIC(7,2),
  pace_min_km           NUMERIC(5,3),
  avg_hr                SMALLINT,
  max_hr                SMALLINT,
  thermal_sensation_c   NUMERIC(4,1),
  calories_kcal         NUMERIC(7,1),
  garmin_activity_id    TEXT UNIQUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_sessions_user_date
  ON run_sessions (user_id, date DESC);

-- ─── pr_movements ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pr_movements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'time_sec',
                  -- time_sec | reps | weight_kg | rounds_reps | meters
  category        TEXT,
  lower_is_better BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

-- ─── pr_attempts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pr_attempts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movement_id   UUID NOT NULL REFERENCES pr_movements(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  value         NUMERIC(10,3) NOT NULL,
  notes         TEXT,
  is_pr         BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_attempts_movement
  ON pr_attempts (movement_id, date DESC);

-- ─── integration_tokens ───────────────────────────────────────────────────────
-- Stores encrypted OAuth tokens for Whoop and Garmin credentials
CREATE TABLE IF NOT EXISTS integration_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL, -- 'whoop' | 'garmin'
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

-- ─── updated_at triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_integration_tokens_updated_at
  BEFORE UPDATE ON integration_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_attempts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

-- Policies: each user sees only their own data
CREATE POLICY "own_profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_daily_logs" ON daily_logs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_run_sessions" ON run_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_pr_movements" ON pr_movements
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_pr_attempts" ON pr_attempts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_integration_tokens" ON integration_tokens
  FOR ALL USING (auth.uid() = user_id);

-- ─── Default PR movements (CrossFit benchmarks) ───────────────────────────────
-- These will be inserted per user on first login via the app (see seed logic).
-- Kept here as reference:
-- Karen (150 Wall Balls) → time_sec, lower_is_better
-- Fran (21-15-9) → time_sec, lower_is_better
-- DT → time_sec, lower_is_better
-- Cindy → rounds_reps, lower_is_better=false
-- Grace → time_sec, lower_is_better
-- Helen → time_sec, lower_is_better
