export interface UserProfile {
  id: string;
  user_id: string;
  email?: string;
  name: string;
  birth_date: string | null; // ISO date
  height_cm: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserAppSettings {
  id: string;
  user_id: string;
  water_start_time: string;
  water_end_time: string;
  water_reminders_enabled: boolean;
  water_reminder_interval_min: number;
  health_connect_enabled: boolean;
  health_connect_background_enabled: boolean;
  health_connect_last_sync_at: string | null;
  health_connect_last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyLog {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  weight_kg: number | null;

  // Calories by activity (kcal)
  kcal_academia: number | null;
  kcal_boxe: number | null;
  kcal_surf: number | null;
  kcal_corrida: number | null;
  kcal_crossfit: number | null;
  kcal_musculacao: number | null;
  kcal_ciclismo: number | null;
  kcal_outros: number | null;

  // Duration by activity (minutes)
  min_academia: number | null;
  min_boxe: number | null;
  min_surf: number | null;
  min_corrida: number | null;
  min_crossfit: number | null;
  min_musculacao: number | null;
  min_ciclismo: number | null;
  min_outros: number | null;
  min_sauna: number | null;

  // Temperature by activity (°C)
  temp_academia: number | null;
  temp_boxe: number | null;
  temp_surf: number | null;
  temp_corrida: number | null;
  temp_ciclismo: number | null;
  temp_sauna: number | null;

  // Heart rate by activity (bpm)
  bpm_academia: number | null;
  bpm_boxe: number | null;
  bpm_surf: number | null;
  bpm_corrida: number | null;
  bpm_ciclismo: number | null;
  bpm_crossfit: number | null;
  bpm_musculacao: number | null;
  bpm_outros: number | null;
  bpm_sauna: number | null;

  // Manual input
  surplus_deficit_kcal: number | null;

  // Nutrition targets (read-only, not user-entered)
  protein_g: number | null;
  carbs_g: number | null;
  water_consumed_ml: number | null;

  // Whoop (auto-filled)
  whoop_strain: number | null;
  whoop_recovery: number | null;
  whoop_kcal: number | null;

  created_at: string;
  updated_at: string;
}

export interface DailyCalculations {
  tdee_kcal: number;
  water_ml: number;
  min_protein_g: number;
  min_carb_g: number;
  total_activity_min: number;
  total_activity_kcal: number;
}

export type IntervalType =
  | "Easy"
  | "Tempo"
  | "Threshold"
  | "Intervals"
  | "VO2max"
  | "Long Run"
  | "Race"
  | "Outro";

export interface RunSession {
  id: string;
  user_id: string;
  run_activity_id: string | null;
  date: string; // YYYY-MM-DD
  interval_type: IntervalType;
  interval_index: number | null;
  distance_km: number | null;
  duration_min: number | null;
  pace_min_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  thermal_sensation_c: number | null;
  calories_kcal: number | null;
  garmin_activity_id: string | null;
  source: string | null;
  external_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface RunActivity {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  source: string;
  external_id: string | null;
  name: string | null;
  distance_km: number | null;
  duration_min: number | null;
  avg_pace_min_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  thermal_sensation_c: number | null;
  calories_kcal: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  intervals?: RunSession[];
}

export type PRUnit = "time_sec" | "reps" | "weight_kg" | "rounds_reps" | "meters";

export interface PRMovement {
  id: string;
  user_id: string;
  name: string;
  unit: PRUnit;
  category: string | null;
  lower_is_better: boolean;
  created_at: string;
}

export interface PRAttempt {
  id: string;
  user_id: string;
  movement_id: string;
  date: string; // YYYY-MM-DD
  value: number; // unit depends on movement.unit
  notes: string | null;
  is_pr: boolean;
  created_at: string;
  movement?: PRMovement;
}

export interface RunSummary {
  total_distance_km: number;
  total_duration_min: number;
  avg_pace_min_km: number;
  avg_hr: number;
  sessions_count: number;
}

export interface WaterPreset {
  id: string;
  user_id: string;
  label: string;
  amount_ml: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WaterIntake {
  id: string;
  user_id: string;
  logged_date: string;
  occurred_at: string;
  amount_ml: number;
  preset_id: string | null;
  source: string;
  notes: string | null;
  created_at: string;
  preset?: WaterPreset | null;
}

export type ActivityKey =
  | "crossfit"
  | "musculacao"
  | "boxe"
  | "surf"
  | "ciclismo"
  | "corrida"
  | "outros";

export interface SyncCandidate {
  id: string;
  date: string;
  name: string;
  provider: "whoop" | "garmin";
  duration_min: number | null;
  distance_km?: number | null;
  kcal?: number | null;
  avg_hr?: number | null;
  mapping_key?: ActivityKey;
  already_imported: boolean;
  raw?: unknown;
}
