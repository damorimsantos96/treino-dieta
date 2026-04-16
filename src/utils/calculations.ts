import { DailyLog, DailyCalculations } from "@/types";

const HEIGHT_CM = 172;
const BIRTH_DATE = new Date("1996-07-20");
const SWEAT_RATE_ML_MIN = 2320 / 60; // ~38.67 ml/min
const REF_HR = 157; // reference heart rate for normalization

function getAgeYears(date: Date): number {
  const diff = date.getTime() - BIRTH_DATE.getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

function tempFactor(temp: number | null | undefined): number {
  const t = temp ?? 22;
  if (t >= 28) return 1.3;
  if (t >= 25) return 1.2;
  if (t >= 22) return 1.1;
  if (t >= 19) return 1.05;
  return 1;
}

function hrFactor(bpm: number | null | undefined): number {
  return (bpm ?? REF_HR) / REF_HR;
}

/**
 * Calorie expenditure (TDEE) — mirrors the spreadsheet formula.
 * Uses Mifflin-St Jeor (adapted with Harris-Benedict constants from the sheet).
 */
export function calculateTDEE(log: DailyLog, date: Date): number {
  const weight = log.weight_kg;
  if (!weight) return 0;

  const ageYears = getAgeYears(date);

  // Resting metabolic rate per minute (sleeping MET ~0.95)
  const rmrPerMin = (0.95 * weight * 3.5) / 200;

  // Sleep duration assumed 8h = 480 min
  const sleepMin = 8 * 60;
  const caloSleep = rmrPerMin * sleepMin;

  // Harris-Benedict BMR (modified constants from the sheet)
  const bmrDay = 66.5 + 13.7 * weight + 5 * HEIGHT_CM - 6.8 * ageYears;

  // Activity factor 1.25 applied to daily BMR then subtract sleep portion
  const dailyActive = (bmrDay * 1.25 - caloSleep) / (24 * 60);

  const totalActivityMin =
    (log.min_academia ?? 0) +
    (log.min_boxe ?? 0) +
    (log.min_surf ?? 0) +
    (log.min_corrida ?? 0) +
    (log.min_crossfit ?? 0) +
    (log.min_musculacao ?? 0);

  const awakeNonActiveMin = 24 * 60 - sleepMin - totalActivityMin;

  const totalActivityKcal =
    (log.kcal_academia ?? 0) +
    (log.kcal_boxe ?? 0) +
    (log.kcal_surf ?? 0) +
    (log.kcal_corrida ?? 0) +
    (log.kcal_crossfit ?? 0) +
    (log.kcal_musculacao ?? 0) +
    (log.kcal_outros ?? 0) +
    (log.whoop_kcal ?? 0);

  return caloSleep + dailyActive * awakeNonActiveMin + totalActivityKcal;
}

/**
 * Hydration requirement in ml — mirrors the spreadsheet LET formula.
 */
export function calculateWaterMl(log: DailyLog): number {
  const weight = log.weight_kg;
  if (!weight) return 0;

  const basal = 40 * weight * tempFactor(log.temp_academia);

  const academia =
    SWEAT_RATE_ML_MIN *
    (log.min_academia ?? 0) *
    0.4 *
    hrFactor(log.bpm_academia) *
    tempFactor(log.temp_academia);

  const boxe =
    SWEAT_RATE_ML_MIN *
    (log.min_boxe ?? 0) *
    0.8 *
    hrFactor(log.bpm_boxe) *
    tempFactor(log.temp_boxe);

  const surf =
    SWEAT_RATE_ML_MIN *
    (log.min_surf ?? 0) *
    0.6 *
    1.15 *
    hrFactor(log.bpm_surf) *
    tempFactor(log.temp_surf);

  const corrida =
    SWEAT_RATE_ML_MIN *
    (log.min_corrida ?? 0) *
    1.0 *
    hrFactor(log.bpm_corrida) *
    tempFactor(log.temp_corrida);

  // Sauna uses exponential temp factor
  const saunaTemp = log.temp_sauna ?? 80;
  const taxaFatorTemp = 1 + 0.08 * Math.exp(0.09 * (saunaTemp - 19));
  const sauna =
    SWEAT_RATE_ML_MIN *
    (log.min_sauna ?? 0) *
    (0.3 * hrFactor(log.bpm_sauna) + 0.7 * taxaFatorTemp);

  return (basal + academia + boxe + surf + corrida + sauna) * 1.05;
}

/**
 * Minimum protein in grams.
 */
export function calculateMinProtein(weight: number | null): number {
  if (!weight) return 0;
  return weight * 1.9;
}

/**
 * Minimum carbs in grams — varies by day of week (0=Sun, 1=Mon, ...).
 * Sheet: Mon(2)/Tue(3)/Sun(1) = 5.5; Wed(4)/Fri(6) = 7; Thu(5) = 6; Sat(7) = 6.5
 * JS Date: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 */
export function calculateMinCarbs(weight: number | null, date: Date): number {
  if (!weight) return 0;
  const dow = date.getDay();
  let gPerKg: number;
  if (dow === 1 || dow === 2 || dow === 0) gPerKg = 5.5; // Mon, Tue, Sun
  else if (dow === 3 || dow === 5) gPerKg = 7;            // Wed, Fri
  else if (dow === 4) gPerKg = 6;                         // Thu
  else gPerKg = 6.5;                                       // Sat
  return gPerKg * weight;
}

export function computeDailyCalculations(
  log: DailyLog,
  date: Date
): DailyCalculations {
  const totalActivityMin =
    (log.min_academia ?? 0) +
    (log.min_boxe ?? 0) +
    (log.min_surf ?? 0) +
    (log.min_corrida ?? 0) +
    (log.min_crossfit ?? 0) +
    (log.min_musculacao ?? 0) +
    (log.min_sauna ?? 0);

  const totalActivityKcal =
    (log.kcal_academia ?? 0) +
    (log.kcal_boxe ?? 0) +
    (log.kcal_surf ?? 0) +
    (log.kcal_corrida ?? 0) +
    (log.kcal_crossfit ?? 0) +
    (log.kcal_musculacao ?? 0) +
    (log.kcal_outros ?? 0) +
    (log.whoop_kcal ?? 0);

  return {
    tdee_kcal: calculateTDEE(log, date),
    water_ml: calculateWaterMl(log),
    min_protein_g: calculateMinProtein(log.weight_kg),
    min_carb_g: calculateMinCarbs(log.weight_kg, date),
    total_activity_min: totalActivityMin,
    total_activity_kcal: totalActivityKcal,
  };
}

/** Format seconds as mm:ss */
export function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Format minutes as h:mm */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/** Format ml as liters when > 1000 */
export function formatWater(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${Math.round(ml)}ml`;
}
