-- ============================================================
-- Migration 002: Add nutrition tracking columns to daily_logs
-- ============================================================

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS protein_g       NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS carbs_g         NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS water_consumed_ml NUMERIC(7,1);
