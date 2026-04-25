-- ============================================================
-- Migration 010: 5K prediction auto-calibration
-- ============================================================

CREATE TABLE IF NOT EXISTS all_out_tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  kind          TEXT NOT NULL,
  distance_km   NUMERIC(6,3) NOT NULL,
  duration_min  NUMERIC(8,3) NOT NULL,
  temp_c        NUMERIC(4,1),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT all_out_tests_distance_check CHECK (distance_km > 0 AND distance_km <= 100),
  CONSTRAINT all_out_tests_duration_check CHECK (duration_min > 0 AND duration_min <= 1440)
);

CREATE INDEX IF NOT EXISTS idx_all_out_tests_user_date
  ON all_out_tests (user_id, date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS run_prediction_model_state (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                        UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  data_signature                 TEXT,
  ratio                          NUMERIC(8,4) NOT NULL,
  riegel_exp                     NUMERIC(6,3) NOT NULL,
  calibration_status             TEXT NOT NULL DEFAULT 'default',
  n_tests                        INTEGER NOT NULL DEFAULT 0,
  max_test_date                  DATE,
  last_calibration_date          DATE,
  hr_race                        SMALLINT NOT NULL,
  hrmax_obs                      SMALLINT NOT NULL,
  temp_slope                     NUMERIC(6,3) NOT NULL,
  temp_ref                       NUMERIC(4,1) NOT NULL,
  window_days                    INTEGER NOT NULL DEFAULT 28,
  ratio_default                  NUMERIC(8,4) NOT NULL,
  riegel_default                 NUMERIC(6,3) NOT NULL,
  trend_intercept                NUMERIC(12,6),
  trend_slope                    NUMERIC(12,8),
  trend_sigma_residual           NUMERIC(12,6),
  trend_n_points                 INTEGER NOT NULL DEFAULT 0,
  trend_r_squared                NUMERIC(8,4),
  bootstrap_samples              JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_mean_abs_error_pct  NUMERIC(8,3),
  validation_alert               BOOLEAN NOT NULL DEFAULT false,
  low_confidence_default         BOOLEAN NOT NULL DEFAULT false,
  methodology                    JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_id           UUID REFERENCES all_out_tests(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  kind              TEXT,
  distance_km       NUMERIC(6,3) NOT NULL,
  duration_obs_min  NUMERIC(8,3) NOT NULL,
  duration_pred_min NUMERIC(8,3),
  temp_c            NUMERIC(4,1),
  indicator_source  TEXT,
  indicator_value   NUMERIC(12,6),
  ratio_used        NUMERIC(8,4),
  riegel_exp_used   NUMERIC(6,3),
  error_pct         NUMERIC(8,3),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_log_user_date
  ON validation_log (user_id, date DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_validation_log_user_test
  ON validation_log (user_id, test_id)
  WHERE test_id IS NOT NULL;

CREATE TRIGGER trg_all_out_tests_updated_at
  BEFORE UPDATE ON all_out_tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_run_prediction_model_state_updated_at
  BEFORE UPDATE ON run_prediction_model_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE all_out_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_prediction_model_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "own_all_out_tests" ON all_out_tests
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "own_run_prediction_model_state" ON run_prediction_model_state
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "own_validation_log" ON validation_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
