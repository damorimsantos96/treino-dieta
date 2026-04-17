-- Replace global UNIQUE on garmin_activity_id with per-user unique constraint.
-- This allows different users to import the same Garmin activity ID without conflicts.

ALTER TABLE run_sessions
  DROP CONSTRAINT IF EXISTS run_sessions_garmin_activity_id_key;

ALTER TABLE run_sessions
  ADD CONSTRAINT run_sessions_garmin_activity_id_user_unique
  UNIQUE (user_id, garmin_activity_id);
