import { DailyLog, DailyCalculations } from "@/types";

const SWEAT_RATE_ML_MIN = 2320 / 60;
const REF_HR = 157;
const OTHER_ACTIVITY_WATER_FACTOR = 0.7;

function getAgeYears(birthDate: Date, referenceDate: Date): number {
  const diff = referenceDate.getTime() - birthDate.getTime();
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

export interface UserMetrics {
  heightCm: number;
  birthDate: Date;
}

export function calculateTDEE(
  log: DailyLog,
  date: Date,
  user: UserMetrics
): number {
  const weight = log.weight_kg;
  if (!weight) return 0;

  const ageYears = getAgeYears(user.birthDate, date);
  const rmrPerMin = (0.95 * weight * 3.5) / 200;
  const sleepMin = 8 * 60;
  const caloSleep = rmrPerMin * sleepMin;
  const bmrDay = 66.5 + 13.7 * weight + 5 * user.heightCm - 6.8 * ageYears;
  const dailyActive = (bmrDay * 1.25 - caloSleep) / (24 * 60);

  const totalActivityMin =
    (log.min_boxe ?? 0) +
    (log.min_surf ?? 0) +
    (log.min_corrida ?? 0) +
    (log.min_crossfit ?? 0) +
    (log.min_musculacao ?? 0) +
    (log.min_ciclismo ?? 0) +
    (log.min_outros ?? 0);

  const nonActiveMin = 24 * 60 - totalActivityMin;

  const totalActivityKcal =
    (log.kcal_boxe ?? 0) +
    (log.kcal_surf ?? 0) +
    (log.kcal_corrida ?? 0) +
    (log.kcal_crossfit ?? 0) +
    (log.kcal_musculacao ?? 0) +
    (log.kcal_ciclismo ?? 0) +
    (log.kcal_outros ?? 0) +
    (log.whoop_kcal ?? 0);

  return caloSleep + dailyActive * nonActiveMin + totalActivityKcal;
}

export function calculateWaterMl(log: DailyLog): number {
  const weight = log.weight_kg;
  if (!weight) return 0;

  const basal = 40 * weight * tempFactor(log.temp_musculacao);

  const musculacao =
    SWEAT_RATE_ML_MIN * (log.min_musculacao ?? 0) * 0.4 *
    hrFactor(log.bpm_musculacao) * tempFactor(log.temp_musculacao);

  const boxe =
    SWEAT_RATE_ML_MIN * (log.min_boxe ?? 0) * 0.8 *
    hrFactor(log.bpm_boxe) * tempFactor(log.temp_boxe);

  const surf =
    SWEAT_RATE_ML_MIN * (log.min_surf ?? 0) * 0.6 * 1.15 *
    hrFactor(log.bpm_surf) * tempFactor(log.temp_surf);

  const corrida =
    SWEAT_RATE_ML_MIN * (log.min_corrida ?? 0) * 1.0 *
    hrFactor(log.bpm_corrida) * tempFactor(log.temp_corrida);

  const ciclismo =
    SWEAT_RATE_ML_MIN * (log.min_ciclismo ?? 0) * 0.7 *
    hrFactor(log.bpm_ciclismo) * tempFactor(log.temp_ciclismo);

  // Neutral fallback for imported sessions that the provider classifies as "other".
  const outros =
    SWEAT_RATE_ML_MIN * (log.min_outros ?? 0) * OTHER_ACTIVITY_WATER_FACTOR *
    hrFactor(log.bpm_outros) * tempFactor(null);

  const saunaTemp = log.temp_sauna ?? 80;
  const taxaFatorTemp = 1 + 0.08 * Math.exp(0.09 * (saunaTemp - 19));
  const sauna =
    SWEAT_RATE_ML_MIN * (log.min_sauna ?? 0) *
    (0.3 * hrFactor(log.bpm_sauna) + 0.7 * taxaFatorTemp);

  return (basal + musculacao + boxe + surf + corrida + ciclismo + outros + sauna) * 1.05;
}

export function calculateMinProtein(weight: number | null): number {
  if (!weight) return 0;
  return weight * 1.9;
}

export function calculateMinCarbs(weight: number | null, date: Date): number {
  if (!weight) return 0;
  const dow = date.getDay();
  let gPerKg: number;
  if (dow === 1 || dow === 2 || dow === 6) gPerKg = 5.5;
  else if (dow === 3 || dow === 5) gPerKg = 7;
  else if (dow === 4) gPerKg = 6;
  else gPerKg = 6.5;
  return gPerKg * weight;
}

export function computeDailyCalculations(
  log: DailyLog,
  date: Date,
  user: UserMetrics
): DailyCalculations {
  const totalActivityMin =
    (log.min_boxe ?? 0) + (log.min_surf ?? 0) +
    (log.min_corrida ?? 0) + (log.min_crossfit ?? 0) + (log.min_musculacao ?? 0) +
    (log.min_ciclismo ?? 0) + (log.min_outros ?? 0) + (log.min_sauna ?? 0);

  const totalActivityKcal =
    (log.kcal_boxe ?? 0) + (log.kcal_surf ?? 0) +
    (log.kcal_corrida ?? 0) + (log.kcal_crossfit ?? 0) + (log.kcal_musculacao ?? 0) +
    (log.kcal_ciclismo ?? 0) + (log.kcal_outros ?? 0) + (log.whoop_kcal ?? 0);

  return {
    tdee_kcal: calculateTDEE(log, date, user),
    water_ml: calculateWaterMl(log),
    min_protein_g: calculateMinProtein(log.weight_kg),
    min_carb_g: calculateMinCarbs(log.weight_kg, date),
    total_activity_min: totalActivityMin,
    total_activity_kcal: totalActivityKcal,
  };
}

export function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

export function formatWater(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${Math.round(ml)}ml`;
}

export function parseClockToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return 0;

  return hours * 60 + minutes;
}

export function expectedHydrationByTime(
  targetMl: number,
  now: Date,
  startTime: string,
  endTime: string
): number {
  if (targetMl <= 0) return 0;

  const startMinutes = parseClockToMinutes(startTime);
  const endMinutes = parseClockToMinutes(endTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (endMinutes <= startMinutes) return targetMl;
  if (nowMinutes <= startMinutes) return 0;
  if (nowMinutes >= endMinutes) return targetMl;

  const progress = (nowMinutes - startMinutes) / (endMinutes - startMinutes);
  return targetMl * progress;
}

export function hydrationProgressStatus(
  targetMl: number,
  consumedMl: number,
  now: Date,
  startTime: string,
  endTime: string
) {
  const expectedMl = expectedHydrationByTime(targetMl, now, startTime, endTime);
  const remainingMl = Math.max(0, targetMl - consumedMl);
  const deltaMl = consumedMl - expectedMl;

  return {
    expectedMl,
    remainingMl,
    deltaMl,
    isBehind: consumedMl < expectedMl,
  };
}
