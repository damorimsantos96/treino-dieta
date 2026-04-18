-- ============================================================
-- Migration 005: split running sessions from intervals and add
-- import markers for idempotent Whoop/Garmin sync.
-- ============================================================

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS bpm_crossfit SMALLINT,
  ADD COLUMN IF NOT EXISTS bpm_musculacao SMALLINT;

CREATE TABLE IF NOT EXISTS run_activities (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  source                TEXT NOT NULL DEFAULT 'manual',
  external_id           TEXT,
  name                  TEXT,
  distance_km           NUMERIC(8,3),
  duration_min          NUMERIC(8,2),
  avg_pace_min_km       NUMERIC(6,3),
  avg_hr                SMALLINT,
  max_hr                SMALLINT,
  thermal_sensation_c   NUMERIC(4,1),
  calories_kcal         NUMERIC(7,1),
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE run_activities
    ADD CONSTRAINT run_activities_user_source_external_unique
    UNIQUE (user_id, source, external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_run_activities_user_date
  ON run_activities (user_id, date DESC);

ALTER TABLE run_sessions
  ADD COLUMN IF NOT EXISTS run_activity_id UUID REFERENCES run_activities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS interval_index INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT;

DO $$
BEGIN
  ALTER TABLE run_sessions
    ADD CONSTRAINT run_sessions_user_source_external_unique
    UNIQUE (user_id, source, external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_run_sessions_activity
  ON run_sessions (run_activity_id, interval_index);

CREATE TABLE IF NOT EXISTS activity_imports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  imported_at  TIMESTAMPTZ DEFAULT NOW(),
  metadata     JSONB DEFAULT '{}',
  UNIQUE (user_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_imports_user_provider
  ON activity_imports (user_id, provider);

DO $$
BEGIN
  ALTER TABLE pr_attempts
    ADD CONSTRAINT pr_attempts_user_movement_date_value_unique
    UNIQUE (user_id, movement_id, date, value);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TRIGGER trg_run_activities_updated_at
  BEFORE UPDATE ON run_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE run_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_run_activities" ON run_activities
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own_activity_imports" ON activity_imports
  FOR ALL USING (auth.uid() = user_id);

-- Backfill existing interval-shaped rows into one activity per day.
-- The historical Excel source repeats session-level calories/temperature on
-- every interval, so MAX(calories_kcal) is safer than SUM here.
WITH grouped AS (
  SELECT
    user_id,
    date,
    CASE
      WHEN BOOL_OR(garmin_activity_id IS NOT NULL) THEN 'legacy_garmin'
      ELSE 'legacy_excel'
    END AS source,
    CONCAT('legacy:', user_id::TEXT, ':', date::TEXT) AS external_id,
    SUM(COALESCE(distance_km, 0)) AS distance_km,
    SUM(COALESCE(duration_min, 0)) AS duration_min,
    CASE
      WHEN SUM(COALESCE(distance_km, 0)) > 0
      THEN SUM(COALESCE(duration_min, 0)) / SUM(COALESCE(distance_km, 0))
      ELSE NULL
    END AS avg_pace_min_km,
    ROUND(AVG(avg_hr))::SMALLINT AS avg_hr,
    MAX(max_hr)::SMALLINT AS max_hr,
    ROUND(AVG(thermal_sensation_c), 1) AS thermal_sensation_c,
    MAX(calories_kcal) AS calories_kcal
  FROM run_sessions
  WHERE run_activity_id IS NULL
  GROUP BY user_id, date
),
inserted AS (
  INSERT INTO run_activities (
    user_id, date, source, external_id, name, distance_km, duration_min,
    avg_pace_min_km, avg_hr, max_hr, thermal_sensation_c, calories_kcal
  )
  SELECT
    user_id, date, source, external_id, 'Histórico', distance_km, duration_min,
    avg_pace_min_km, avg_hr, max_hr, thermal_sensation_c, calories_kcal
  FROM grouped
  ON CONFLICT (user_id, source, external_id) DO UPDATE SET
    distance_km = EXCLUDED.distance_km,
    duration_min = EXCLUDED.duration_min,
    avg_pace_min_km = EXCLUDED.avg_pace_min_km,
    avg_hr = EXCLUDED.avg_hr,
    max_hr = EXCLUDED.max_hr,
    thermal_sensation_c = EXCLUDED.thermal_sensation_c,
    calories_kcal = EXCLUDED.calories_kcal
  RETURNING id, user_id, date, source, external_id
)
UPDATE run_sessions rs
SET
  run_activity_id = inserted.id,
  source = COALESCE(rs.source, inserted.source)
FROM inserted
WHERE rs.run_activity_id IS NULL
  AND rs.user_id = inserted.user_id
  AND rs.date = inserted.date;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY run_activity_id
      ORDER BY created_at, id
    ) AS rn
  FROM run_sessions
  WHERE interval_index IS NULL
)
UPDATE run_sessions rs
SET interval_index = numbered.rn
FROM numbered
WHERE rs.id = numbered.id;
