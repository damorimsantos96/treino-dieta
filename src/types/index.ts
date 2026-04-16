export interface UserProfile {
  id: string;
  email: string;
  name: string;
  birth_date: string; // ISO date
  height_cm: number;
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
  kcal_outros: number | null;

  // Duration by activity (minutes)
  min_academia: number | null;
  min_boxe: number | null;
  min_surf: number | null;
  min_corrida: number | null;
  min_crossfit: number | null;
  min_musculacao: number | null;
  min_sauna: number | null;

  // Temperature by activity (°C)
  temp_academia: number | null;
  temp_boxe: number | null;
  temp_surf: number | null;
  temp_corrida: number | null;
  temp_sauna: number | null;

  // Heart rate by activity (bpm)
  bpm_academia: number | null;
  bpm_boxe: number | null;
  bpm_surf: number | null;
  bpm_corrida: number | null;
  bpm_sauna: number | null;

  // Manual input
  surplus_deficit_kcal: number | null;

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
  date: string; // YYYY-MM-DD
  interval_type: IntervalType;
  distance_km: number | null;
  duration_min: number | null;
  pace_min_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  thermal_sensation_c: number | null;
  calories_kcal: number | null;
  garmin_activity_id: string | null;
  notes: string | null;
  created_at: string;
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
