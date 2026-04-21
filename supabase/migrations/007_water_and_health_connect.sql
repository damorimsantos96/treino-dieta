-- ============================================================
-- Migration 007: Water tracking and Health Connect settings
-- ============================================================

CREATE TABLE IF NOT EXISTS user_app_settings (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                          UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  water_start_time                 TEXT NOT NULL DEFAULT '07:00',
  water_end_time                   TEXT NOT NULL DEFAULT '22:00',
  water_reminders_enabled          BOOLEAN NOT NULL DEFAULT false,
  water_reminder_interval_min      INTEGER NOT NULL DEFAULT 60,
  health_connect_enabled           BOOLEAN NOT NULL DEFAULT false,
  health_connect_background_enabled BOOLEAN NOT NULL DEFAULT false,
  health_connect_last_sync_at      TIMESTAMPTZ,
  health_connect_last_error        TEXT,
  created_at                       TIMESTAMPTZ DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_app_settings_water_start_time_check
    CHECK (water_start_time ~ '^\d{2}:\d{2}$'),
  CONSTRAINT user_app_settings_water_end_time_check
    CHECK (water_end_time ~ '^\d{2}:\d{2}$'),
  CONSTRAINT user_app_settings_water_interval_check
    CHECK (water_reminder_interval_min BETWEEN 15 AND 720)
);

CREATE TABLE IF NOT EXISTS water_presets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  amount_ml     INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT water_presets_amount_ml_check CHECK (amount_ml BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS idx_water_presets_user_sort
  ON water_presets (user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS water_intakes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_date   DATE NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  amount_ml     INTEGER NOT NULL,
  preset_id     UUID REFERENCES water_presets(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT water_intakes_amount_ml_check CHECK (amount_ml BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS idx_water_intakes_user_date
  ON water_intakes (user_id, logged_date DESC, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_water_intakes_user_occurred_at
  ON water_intakes (user_id, occurred_at DESC);

CREATE TRIGGER trg_user_app_settings_updated_at
  BEFORE UPDATE ON user_app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_water_presets_updated_at
  BEFORE UPDATE ON water_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION refresh_daily_water_consumption_for(
  target_user_id UUID,
  target_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  total_ml NUMERIC(7,1);
BEGIN
  SELECT COALESCE(SUM(amount_ml), 0)
  INTO total_ml
  FROM water_intakes
  WHERE user_id = target_user_id
    AND logged_date = target_date;

  INSERT INTO daily_logs (user_id, date, water_consumed_ml)
  VALUES (target_user_id, target_date, total_ml)
  ON CONFLICT (user_id, date) DO UPDATE SET
    water_consumed_ml = EXCLUDED.water_consumed_ml;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_daily_water_consumption_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_daily_water_consumption_for(OLD.user_id, OLD.logged_date);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM refresh_daily_water_consumption_for(OLD.user_id, OLD.logged_date);

    IF OLD.user_id IS DISTINCT FROM NEW.user_id
      OR OLD.logged_date IS DISTINCT FROM NEW.logged_date THEN
      PERFORM refresh_daily_water_consumption_for(NEW.user_id, NEW.logged_date);
    ELSE
      PERFORM refresh_daily_water_consumption_for(NEW.user_id, NEW.logged_date);
    END IF;

    RETURN NEW;
  END IF;

  PERFORM refresh_daily_water_consumption_for(NEW.user_id, NEW.logged_date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_water_intakes_sync_daily_log ON water_intakes;

CREATE TRIGGER trg_water_intakes_sync_daily_log
  AFTER INSERT OR UPDATE OR DELETE ON water_intakes
  FOR EACH ROW EXECUTE FUNCTION refresh_daily_water_consumption_trigger();

ALTER TABLE user_app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_intakes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "own_user_app_settings" ON user_app_settings
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "own_water_presets" ON water_presets
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "own_water_intakes" ON water_intakes
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
