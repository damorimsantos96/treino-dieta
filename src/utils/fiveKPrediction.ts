import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { AllOutTest, RunActivity } from "@/types";
import {
  classifyRunActivityIntervals,
  detectAutoAllOutTest,
  mapIntervalTypeToBlockKind,
  normalizeRunLabel,
} from "@/utils/runPredictionHeuristics";

const HR_RACE = 171;
const HRMAX_OBS = 184;
const TEMP_SLOPE = 0.92;
const TEMP_REF = 22;
const RIEGEL_DEFAULT = 1.057;
const RATIO_DEFAULT = 1.0683;
const WINDOW_DAYS = 28;
const TARGET_MINUTES = 20;
const RATIO_VALIDATION_FALLBACK = 1.04;
const N_BOOTSTRAP = 2000;
const EPSILON = 1e-6;

type BlockKind = "work" | "recovery";
type IndicatorSource = "rep_best" | "sustain_top3";

interface FlattenedInterval {
  id: string;
  runActivityId: string;
  date: string;
  intervalIndex: number;
  distanceKm: number;
  paceMinKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  tempC: number | null;
  validatedType: string;
  classificationConfidence: number;
  blockKind: BlockKind;
  speed22: number | null;
}

interface TrendPoint {
  date: string;
  daysFromSeriesStart: number;
  indicator: number;
}

interface TrendFit {
  intercept: number;
  slope: number;
  sigmaResidual: number;
  nPoints: number;
  rSquared: number | null;
}

interface BootstrapSample {
  intercept: number;
  slope: number;
}

interface ResolvedAllOutTest extends AllOutTest {
  tempResolvedC: number;
  tempWasImputed: boolean;
}

interface CalibrationSummary {
  ratio: number;
  riegelExp: number;
  nTestsUsed: number;
  autoTestsUsed: number;
  manualTestsUsed: number;
  lastCalibrationDate: string | null;
  calibrationStatus: string;
  calibrationMode: "default" | "partial" | "calibrated";
}

interface RepWindowDiagnostics {
  totalCandidate1k: number;
  eligible1k: number;
  rejectedByType: number;
  rejectedByTemp: number;
  autoDetectedTests: number;
}

export interface FiveKValidationEntryInput {
  test_id: string | null;
  date: string;
  kind: string | null;
  distance_km: number;
  duration_obs_min: number;
  duration_pred_min: number | null;
  temp_c: number | null;
  indicator_source: string | null;
  indicator_value: number | null;
  ratio_used: number | null;
  riegel_exp_used: number | null;
  error_pct: number | null;
}

export interface FiveKPredictionPoint {
  date: string;
  daysFromSeriesStart: number;
  timeMin: number;
  ciLow: number | null;
  ciHigh: number | null;
}

export interface FiveKPredictionTestHistoryItem {
  id: string;
  date: string;
  kind: string;
  distanceKm: number;
  durationObsMin: number;
  equivalent5kAtTempMin: number;
  equivalent5kAt22Min: number;
  predictedAtTempMin: number | null;
  tempC: number;
  tempWasImputed: boolean;
}

export interface FiveKPredictionView {
  today: string;
  temperatureC: number;
  isTemperatureExtrapolated: boolean;
  summaryText: string;
  calibration: {
    ratio: number;
    riegelExp: number;
    nTestsUsed: number;
    autoTestsUsed: number;
    manualTestsUsed: number;
    lastCalibrationDate: string | null;
    calibrationStatus: string;
    calibrationMode: "default" | "partial" | "calibrated";
  };
  current: {
    indicatorValue: number;
    indicatorSource: IndicatorSource;
    indicatorWindowDays: number;
    repBestRaw: number;
    time5kMin: number;
    paceMinKm: number;
    ci90Lower: number | null;
    ci90Upper: number | null;
    ci90HalfWidth: number | null;
    hrRace: number;
    note: string;
    lowConfidence: boolean;
  } | null;
  target20Min: {
    gapMin: number | null;
    gapPct: number | null;
    optimisticDate: string | null;
    realisticDate: string | null;
    conservativeDate: string | null;
    optimisticDaysFromToday: number | null;
    realisticDaysFromToday: number | null;
    conservativeDaysFromToday: number | null;
    message: string | null;
  };
  trendCurve: FiveKPredictionPoint[];
  testsHistory: FiveKPredictionTestHistoryItem[];
  methodology: {
    hrRace: number;
    hrMaxObs: number;
    tempSlope: number;
    tempRef: number;
    windowDays: number;
    validationMeanAbsErrorPct: number | null;
    validationAlert: boolean;
    validationCount: number;
    fallbackActive: boolean;
    repWindowDiagnostics: RepWindowDiagnostics;
  };
  persistence: {
    dataSignature: string;
    autoDetectedTests: Array<
      Pick<
        AllOutTest,
        | "date"
        | "kind"
        | "distance_km"
        | "duration_min"
        | "temp_c"
        | "notes"
        | "source_run_activity_id"
        | "is_auto_generated"
        | "auto_confidence"
      >
    >;
    modelState: {
      data_signature: string;
      ratio: number;
      riegel_exp: number;
      calibration_status: string;
      n_tests: number;
      max_test_date: string | null;
      last_calibration_date: string | null;
      hr_race: number;
      hrmax_obs: number;
      temp_slope: number;
      temp_ref: number;
      window_days: number;
      ratio_default: number;
      riegel_default: number;
      trend_intercept: number | null;
      trend_slope: number | null;
      trend_sigma_residual: number | null;
      trend_n_points: number;
      trend_r_squared: number | null;
      bootstrap_samples: BootstrapSample[];
      validation_mean_abs_error_pct: number | null;
      validation_alert: boolean;
      low_confidence_default: boolean;
      methodology: Record<string, unknown>;
    };
    validationLog: FiveKValidationEntryInput[];
  };
}

function toFiniteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeDistribution(values: number[]) {
  if (values.length < 8) return values;

  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  if (q1 == null || q3 == null) return values;

  const iqr = Math.max(q3 - q1, 0.2);
  const lowerFence = Math.max(0, q1 - iqr * 1.5);
  const upperFence = q3 + iqr * 1.5;
  const filtered = values.filter((value) => value >= lowerFence && value <= upperFence);

  return filtered.length >= Math.max(6, Math.floor(values.length * 0.6)) ? filtered : values;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function iso(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function normalizeLabel(value: string | null | undefined) {
  return normalizeRunLabel(value);
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let t = current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDataSignature(activities: RunActivity[], tests: AllOutTest[]) {
  const activityPart = activities
    .map(
      (activity) =>
        `${activity.id}:${activity.date}:${activity.updated_at}:${activity.distance_km ?? ""}:${activity.duration_min ?? ""}:${activity.max_hr ?? ""}`
    )
    .join("|");
  const intervalPart = activities
    .flatMap((activity) =>
      (activity.intervals ?? []).map(
        (interval) =>
          `${interval.id}:${interval.date}:${interval.interval_type}:${interval.interval_index ?? ""}:${interval.distance_km ?? ""}:${interval.pace_min_km ?? ""}:${interval.avg_hr ?? ""}:${interval.max_hr ?? ""}:${interval.thermal_sensation_c ?? ""}`
      )
    )
    .join("|");
  const testsPart = tests
    .map(
      (test) =>
        `${test.id}:${test.date}:${test.kind}:${test.distance_km}:${test.duration_min}:${test.temp_c ?? ""}:${test.updated_at}`
    )
    .join("|");
  return `${activities.length}:${tests.length}:${hashString(`${activityPart}#${intervalPart}#${testsPart}`)}`;
}

function syntheticIntervals(activity: RunActivity) {
  const hasSomeMetric =
    toFiniteNumber(activity.distance_km) != null ||
    toFiniteNumber(activity.duration_min) != null ||
    toFiniteNumber(activity.avg_pace_min_km) != null;
  if (!hasSomeMetric) return [];

  return [
    {
      id: `synthetic-${activity.id}`,
      run_activity_id: activity.id,
      date: activity.date,
      interval_type: "Work",
      interval_index: 1,
      distance_km: activity.distance_km,
      pace_min_km: activity.avg_pace_min_km,
      avg_hr: activity.avg_hr,
      max_hr: activity.max_hr,
      thermal_sensation_c: activity.thermal_sensation_c,
      duration_min: activity.duration_min,
    },
  ];
}

function flattenIntervals(activities: RunActivity[]): FlattenedInterval[] {
  const rows: FlattenedInterval[] = [];

  for (const activity of activities) {
    const rawIntervals =
      activity.intervals && activity.intervals.length > 0
        ? activity.intervals
        : syntheticIntervals(activity);

    const prepared = rawIntervals
      .map((interval, index) => {
        const distanceKm = toFiniteNumber(interval.distance_km) ?? 0;
        const paceMinKm =
          toFiniteNumber(interval.pace_min_km) ??
          (distanceKm > 0 &&
          toFiniteNumber(interval.duration_min) != null &&
          (interval.duration_min ?? 0) > 0
            ? (interval.duration_min ?? 0) / distanceKm
            : null);

        return {
          id: interval.id,
          runActivityId: interval.run_activity_id ?? activity.id,
          date: interval.date ?? activity.date,
          intervalIndex: interval.interval_index ?? index + 1,
          distanceKm,
          paceMinKm,
          avgHr: toFiniteNumber(interval.avg_hr),
          maxHr: toFiniteNumber(interval.max_hr),
          tempC: toFiniteNumber(interval.thermal_sensation_c),
          explicitType: normalizeLabel(interval.interval_type),
          durationMin: toFiniteNumber(interval.duration_min),
        };
      })
      .sort((a, b) => a.intervalIndex - b.intervalIndex);

    const classifications = classifyRunActivityIntervals(
      activity,
      prepared.map((interval) => ({
        interval_index: interval.intervalIndex,
        interval_type: interval.explicitType,
        distance_km: interval.distanceKm,
        duration_min: interval.durationMin,
        pace_min_km: interval.paceMinKm,
        avg_hr: interval.avgHr,
        max_hr: interval.maxHr,
      }))
    );

    for (const [index, interval] of prepared.entries()) {
      const classification = classifications[index];
      const explicitBlockKind = mapIntervalTypeToBlockKind(interval.explicitType);
      const blockKind = explicitBlockKind ?? classification.blockKind;

      const hrNormT =
        interval.tempC == null
          ? null
          : HR_RACE - TEMP_SLOPE * (interval.tempC - TEMP_REF);
      const speedKmh =
        interval.paceMinKm != null && interval.paceMinKm > 0
          ? 60 / interval.paceMinKm
          : null;
      const speed22 =
        speedKmh != null && hrNormT != null && hrNormT > 0
          ? speedKmh * HR_RACE / hrNormT
          : null;

      rows.push({
        id: interval.id,
        runActivityId: interval.runActivityId,
        date: interval.date,
        intervalIndex: interval.intervalIndex,
        distanceKm: interval.distanceKm,
        paceMinKm: interval.paceMinKm,
        avgHr: interval.avgHr,
        maxHr: interval.maxHr,
        tempC: interval.tempC,
        validatedType: classification.intervalType,
        classificationConfidence: classification.confidence,
        blockKind,
        speed22,
      });
    }
  }

  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.runActivityId.localeCompare(b.runActivityId) ||
    a.intervalIndex - b.intervalIndex
  );
}

function buildAutoDetectedTests(activities: RunActivity[], persistedTests: AllOutTest[]) {
  const manualTests = persistedTests.filter((test) => !test.is_auto_generated);

  return activities
    .map((activity): AllOutTest | null => {
      const intervals =
        activity.intervals && activity.intervals.length > 0
          ? activity.intervals
          : syntheticIntervals(activity);
      const candidate = detectAutoAllOutTest(activity, intervals);
      if (!candidate) return null;

      const hasManualEquivalent = manualTests.some((test) => {
        const sameDate = test.date === candidate.date;
        const closeDistance = Math.abs(test.distance_km - candidate.distance_km) <= 0.12;
        const closeDuration = Math.abs(test.duration_min - candidate.duration_min) <= 2;
        return sameDate && closeDistance && closeDuration;
      });

      if (hasManualEquivalent) return null;

      return {
        id: `auto:${candidate.source_run_activity_id ?? activity.id ?? candidate.date}`,
        user_id: persistedTests[0]?.user_id ?? "",
        date: candidate.date,
        kind: candidate.kind,
        distance_km: candidate.distance_km,
        duration_min: candidate.duration_min,
        temp_c: candidate.temp_c,
        source_run_activity_id: candidate.source_run_activity_id,
        is_auto_generated: true,
        auto_confidence: candidate.confidence,
        notes: candidate.notes,
        created_at: "",
        updated_at: "",
      };
    })
    .filter((value): value is AllOutTest => value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function isRepCandidate(interval: FlattenedInterval) {
  const distanceOk = interval.distanceKm >= 0.85 && interval.distanceKm <= 1.2;
  const paceOk =
    interval.paceMinKm != null &&
    interval.paceMinKm > 2.4 &&
    interval.paceMinKm < 5.6;
  const intensityOk =
    (interval.avgHr != null && interval.avgHr >= 155) ||
    (interval.maxHr != null && interval.maxHr >= 170) ||
    interval.validatedType === "Intervals" ||
    interval.validatedType === "Race" ||
    (interval.avgHr == null && interval.maxHr == null);

  return (
    interval.blockKind === "work" &&
    interval.classificationConfidence >= 0.62 &&
    distanceOk &&
    paceOk &&
    intensityOk &&
    interval.speed22 != null
  );
}

function summarizeRepWindow(targetDate: string, intervals: FlattenedInterval[], autoDetectedTests: AllOutTest[]) {
  const start = iso(addDays(parseISO(targetDate), -WINDOW_DAYS));
  const currentWindow = intervals.filter(
    (interval) =>
      interval.date >= start &&
      interval.date < targetDate &&
      interval.distanceKm >= 0.85 &&
      interval.distanceKm <= 1.2
  );

  return {
    totalCandidate1k: currentWindow.length,
    eligible1k: currentWindow.filter((interval) => isRepCandidate(interval)).length,
    rejectedByType: currentWindow.filter(
      (interval) => interval.speed22 != null && !isRepCandidate(interval)
    ).length,
    rejectedByTemp: currentWindow.filter((interval) => interval.speed22 == null).length,
    autoDetectedTests: autoDetectedTests.length,
  };
}

function repBest22(targetDate: string, intervals: FlattenedInterval[], windowDays = WINDOW_DAYS) {
  const start = iso(addDays(parseISO(targetDate), -windowDays));
  const candidates = intervals.filter(
    (interval) =>
      interval.date >= start &&
      interval.date < targetDate &&
      isRepCandidate(interval)
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates.map((interval) => interval.speed22 as number));
}

function sustainTop3_22(targetDate: string, intervals: FlattenedInterval[], windowDays = WINDOW_DAYS) {
  const start = iso(addDays(parseISO(targetDate), -windowDays));
  const candidates = intervals
    .filter(
      (interval) =>
        interval.date >= start &&
        interval.date < targetDate &&
        interval.blockKind === "work" &&
        interval.distanceKm >= 0.5 &&
        (interval.avgHr ?? 0) >= 155 &&
        interval.speed22 != null
    )
    .map((interval) => interval.speed22 as number)
    .sort((a, b) => b - a)
    .slice(0, 3);

  return mean(candidates);
}

function resolveTestTemperatures(tests: AllOutTest[], intervals: FlattenedInterval[]): ResolvedAllOutTest[] {
  const dailyMedians = new Map<string, number>();
  const monthlyMedians = new Map<string, number>();

  const byDate = new Map<string, number[]>();
  const byMonth = new Map<string, number[]>();

  for (const interval of intervals) {
    if (interval.tempC == null) continue;
    const monthKey = interval.date.slice(0, 7);
    if (!byDate.has(interval.date)) byDate.set(interval.date, []);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byDate.get(interval.date)?.push(interval.tempC);
    byMonth.get(monthKey)?.push(interval.tempC);
  }

  byDate.forEach((values, key) => {
    const value = median(values);
    if (value != null) dailyMedians.set(key, value);
  });
  byMonth.forEach((values, key) => {
    const value = median(values);
    if (value != null) monthlyMedians.set(key, value);
  });

  return tests.map((test) => {
    if (test.temp_c != null) {
      return { ...test, tempResolvedC: test.temp_c, tempWasImputed: false };
    }

    const dayMedian = dailyMedians.get(test.date);
    const monthMedian = monthlyMedians.get(test.date.slice(0, 7));
    const resolved = dayMedian ?? monthMedian ?? TEMP_REF;

    return {
      ...test,
      tempResolvedC: resolved,
      tempWasImputed: true,
    };
  });
}

function fitLinear(points: Array<{ x: number; y: number }>): TrendFit {
  if (points.length === 0) {
    return { intercept: 0, slope: 0, sigmaResidual: 0, nPoints: 0, rSquared: null };
  }

  if (points.length === 1) {
    return { intercept: points[0].y, slope: 0, sigmaResidual: 0, nPoints: 1, rSquared: null };
  }

  const meanX = mean(points.map((point) => point.x)) ?? 0;
  const meanY = mean(points.map((point) => point.y)) ?? 0;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }

  const slope = denominator <= EPSILON ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (const point of points) {
    const prediction = intercept + slope * point.x;
    residualSumSquares += (point.y - prediction) ** 2;
    totalSumSquares += (point.y - meanY) ** 2;
  }

  const sigmaResidual =
    points.length > 2 ? Math.sqrt(residualSumSquares / Math.max(1, points.length - 2)) : 0;
  const rSquared = totalSumSquares <= EPSILON ? null : 1 - residualSumSquares / totalSumSquares;

  return {
    intercept,
    slope,
    sigmaResidual,
    nPoints: points.length,
    rSquared,
  };
}

function boundedMinimize(
  objective: (value: number) => number,
  lower: number,
  upper: number,
  iterations = 40
) {
  const phi = (1 + Math.sqrt(5)) / 2;
  let left = lower;
  let right = upper;
  let c = right - (right - left) / phi;
  let d = left + (right - left) / phi;
  let fc = objective(c);
  let fd = objective(d);

  for (let index = 0; index < iterations; index += 1) {
    if (fc < fd) {
      right = d;
      d = c;
      fd = fc;
      c = right - (right - left) / phi;
      fc = objective(c);
    } else {
      left = c;
      c = d;
      fc = fd;
      d = left + (right - left) / phi;
      fd = objective(d);
    }
  }

  return (left + right) / 2;
}

function equivalent5kAt22(test: ResolvedAllOutTest, riegelExp: number) {
  const hrNormT = HR_RACE - TEMP_SLOPE * (test.tempResolvedC - TEMP_REF);
  if (hrNormT <= 0) return null;
  return test.duration_min * (hrNormT / HR_RACE) * (5 / test.distance_km) ** riegelExp;
}

function calibrateModel(tests: ResolvedAllOutTest[], intervals: FlattenedInterval[]): CalibrationSummary {
  const calibratable = tests
    .map((test) => ({
      test,
      indicator: repBest22(test.date, intervals),
    }))
    .filter(
      (item): item is { test: ResolvedAllOutTest; indicator: number } =>
        item.indicator != null
    );

  const autoTestsUsed = calibratable.filter((item) => item.test.is_auto_generated).length;
  const manualTestsUsed = calibratable.length - autoTestsUsed;

  if (calibratable.length === 0) {
    return {
      ratio: RATIO_DEFAULT,
      riegelExp: RIEGEL_DEFAULT,
      nTestsUsed: 0,
      autoTestsUsed: 0,
      manualTestsUsed: 0,
      lastCalibrationDate: calibratable.at(-1)?.test.date ?? tests.at(-1)?.date ?? null,
      calibrationStatus: "default",
      calibrationMode: "default",
    };
  }

  if (calibratable.length === 1) {
    const [{ test, indicator }] = calibratable;
    const equivalent5kMin = equivalent5kAt22(test, RIEGEL_DEFAULT);
    const observedRatio =
      equivalent5kMin != null && equivalent5kMin > 0 && indicator > 0
        ? (300 / equivalent5kMin) / indicator
        : null;
    const distanceWeight = clamp(1 - Math.min(Math.abs(test.distance_km - 5), 5) / 5, 0, 1);
    const confidenceWeight = test.is_auto_generated ? test.auto_confidence ?? 0.7 : 1;
    const blendWeight = clamp(0.35 + distanceWeight * 0.2 + confidenceWeight * 0.15, 0.35, 0.7);
    const ratio =
      observedRatio != null && Number.isFinite(observedRatio) && observedRatio > 0
        ? round(RATIO_DEFAULT * (1 - blendWeight) + observedRatio * blendWeight, 4)
        : RATIO_DEFAULT;

    return {
      ratio,
      riegelExp: RIEGEL_DEFAULT,
      nTestsUsed: 1,
      autoTestsUsed,
      manualTestsUsed,
      lastCalibrationDate: test.date,
      calibrationStatus: "parcial com 1 teste",
      calibrationMode: "partial",
    };
  }

  const cvForExponent = (exp: number) => {
    const ratios = calibratable
      .map(({ test, indicator }) => {
        const equivalent5kMin = equivalent5kAt22(test, exp);
        if (equivalent5kMin == null || equivalent5kMin <= 0 || indicator <= 0) return null;
        const speed5k22 = 300 / equivalent5kMin;
        return speed5k22 / indicator;
      })
      .filter((value): value is number => value != null && Number.isFinite(value));

    if (ratios.length < 2) return Number.POSITIVE_INFINITY;
    const avg = mean(ratios) ?? 0;
    const sd = standardDeviation(ratios) ?? 0;
    if (avg <= EPSILON) return Number.POSITIVE_INFINITY;
    return sd / avg;
  };

  const exponent = round(boundedMinimize(cvForExponent, 0.95, 1.2), 3);
  const finalRatios = calibratable
    .map(({ test, indicator }) => {
      const equivalent5kMin = equivalent5kAt22(test, exponent);
      if (equivalent5kMin == null || equivalent5kMin <= 0 || indicator <= 0) return null;
      return (300 / equivalent5kMin) / indicator;
    })
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    ratio: round(mean(finalRatios) ?? RATIO_DEFAULT, 4),
    riegelExp: exponent,
    nTestsUsed: calibratable.length,
    autoTestsUsed,
    manualTestsUsed,
    lastCalibrationDate: calibratable.at(-1)?.test.date ?? null,
    calibrationStatus: `calibrado em ${calibratable.length} testes`,
    calibrationMode: "calibrated",
  };
}

function buildTrendSeries(intervals: FlattenedInterval[], today: string) {
  const dates = intervals.map((interval) => interval.date);
  if (dates.length === 0) {
    return { points: [] as TrendPoint[], fit: fitLinear([]), startDate: today, endDate: today };
  }

  const startDate = startOfWeek(parseISO([...dates].sort()[0]), { weekStartsOn: 1 });
  const endDate = startOfWeek(parseISO([...dates].sort().at(-1) ?? today), { weekStartsOn: 1 });

  const weeklyPoints: Array<{ date: string; indicator: number }> = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 7)) {
    const date = iso(cursor);
    const indicator = repBest22(date, intervals);
    if (indicator != null) {
      weeklyPoints.push({ date, indicator });
    }
  }

  if (weeklyPoints.length === 0) {
    return { points: [] as TrendPoint[], fit: fitLinear([]), startDate: iso(startDate), endDate: iso(endDate) };
  }

  const seriesStart = weeklyPoints[0].date;
  const points = weeklyPoints.map((point) => ({
    date: point.date,
    daysFromSeriesStart: differenceInCalendarDays(parseISO(point.date), parseISO(seriesStart)),
    indicator: point.indicator,
  }));

  const fit =
    points.length >= 8
      ? fitLinear(points.map((point) => ({ x: point.daysFromSeriesStart, y: point.indicator })))
      : {
          intercept: mean(points.map((point) => point.indicator)) ?? 0,
          slope: 0,
          sigmaResidual: standardDeviation(points.map((point) => point.indicator)) ?? 0,
          nPoints: points.length,
          rSquared: null,
        };

  return {
    points,
    fit,
    startDate: seriesStart,
    endDate: points.at(-1)?.date ?? seriesStart,
  };
}

function buildBootstrapSamples(points: TrendPoint[], fit: TrendFit, seedSource: string) {
  if (points.length === 0) return [] as BootstrapSample[];

  const rng = mulberry32(hashString(seedSource));
  const samples: BootstrapSample[] = [];

  for (let index = 0; index < N_BOOTSTRAP; index += 1) {
    if (points.length < 8) {
      const sampled = points.map(() => points[Math.floor(rng() * points.length)].indicator);
      samples.push({
        intercept: round(mean(sampled) ?? fit.intercept, 6),
        slope: 0,
      });
      continue;
    }

    const sampledPoints = points.map(() => points[Math.floor(rng() * points.length)]);
    const sampledFit = fitLinear(
      sampledPoints.map((point) => ({
        x: point.daysFromSeriesStart,
        y: point.indicator,
      }))
    );
    samples.push({
      intercept: round(sampledFit.intercept, 6),
      slope: round(sampledFit.slope, 8),
    });
  }

  return samples;
}

function indicatorAtDays(fit: Pick<TrendFit, "intercept" | "slope">, daysFromSeriesStart: number) {
  return fit.intercept + fit.slope * daysFromSeriesStart;
}

function predictTimeFromIndicator(indicator: number, temperatureC: number, ratio: number) {
  if (!Number.isFinite(indicator) || indicator <= 0 || !Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }
  const speed5k22 = indicator * ratio;
  if (speed5k22 <= 0) return null;
  const time5k22 = 300 / speed5k22;
  const hrNormT = HR_RACE - TEMP_SLOPE * (temperatureC - TEMP_REF);
  if (hrNormT <= 0) return null;
  return time5k22 * HR_RACE / hrNormT;
}

function buildTimeDistribution(
  samples: BootstrapSample[],
  fit: TrendFit,
  daysFromSeriesStart: number,
  temperatureC: number,
  ratio: number,
  rawIndicator?: number | null
) {
  if (samples.length === 0) {
    const fallbackIndicator = rawIndicator ?? indicatorAtDays(fit, daysFromSeriesStart);
    const fallbackTime = predictTimeFromIndicator(fallbackIndicator, temperatureC, ratio);
    return fallbackTime == null ? [] : [fallbackTime];
  }

  const fitAtDay = indicatorAtDays(fit, daysFromSeriesStart);
  const shift = rawIndicator != null ? rawIndicator - fitAtDay : 0;

  return sanitizeDistribution(
    samples
      .map((sample) =>
        predictTimeFromIndicator(
          Math.max(EPSILON, indicatorAtDays(sample, daysFromSeriesStart) + shift),
          temperatureC,
          ratio
        )
      )
      .filter((value): value is number => value != null && Number.isFinite(value))
  );
}

function widenInterval(
  center: number,
  lower: number | null,
  upper: number | null,
  factor: number
) {
  if (lower == null || upper == null) {
    return { lower, upper };
  }
  return {
    lower: center - (center - lower) * factor,
    upper: center + (upper - center) * factor,
  };
}

function predictionNote(temperatureC: number, isExtrapolated: boolean) {
  if (isExtrapolated) {
    return "Temperatura fora da faixa mais observada; leitura útil, mas já em extrapolação.";
  }
  if (temperatureC <= 18) {
    return "Ajuste para um cenário mais frio: a projeção melhora porque a carga térmica cai.";
  }
  if (temperatureC >= 28) {
    return "Ajuste para calor relevante: a projeção piora porque a carga térmica sobe.";
  }
  if (Math.abs(temperatureC - TEMP_REF) < 0.5) {
    return "Referência a 22°C, usada como condição-base do modelo.";
  }
  return "A projeção já incorpora o impacto térmico esperado para essa condição.";
}

function formatClock(minutes: number) {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMonthYear(dateStr: string | null) {
  if (!dateStr) return null;
  const date = parseISO(dateStr);
  return format(date, "MMM yyyy").toLowerCase();
}

function buildValidationLog(
  tests: ResolvedAllOutTest[],
  intervals: FlattenedInterval[],
  calibration: CalibrationSummary
) {
  const entries: FiveKValidationEntryInput[] = tests.map((test) => {
    const repBest = repBest22(test.date, intervals);
    const sustain = repBest == null ? sustainTop3_22(test.date, intervals) : null;
    const indicator = repBest ?? sustain;
    const indicatorSource: IndicatorSource | null =
      repBest != null ? "rep_best" : sustain != null ? "sustain_top3" : null;
    const ratioUsed =
      indicatorSource === "sustain_top3" ? RATIO_VALIDATION_FALLBACK : calibration.ratio;

    if (indicator == null || indicator <= 0) {
      return {
        test_id: test.id,
        date: test.date,
        kind: test.kind,
        distance_km: test.distance_km,
        duration_obs_min: test.duration_min,
        duration_pred_min: null,
        temp_c: test.tempResolvedC,
        indicator_source: null,
        indicator_value: null,
        ratio_used: null,
        riegel_exp_used: calibration.riegelExp,
        error_pct: null,
      };
    }

    const speed5k22 = indicator * ratioUsed;
    const time5k22 = 300 / speed5k22;
    const test22 = time5k22 * (test.distance_km / 5) ** calibration.riegelExp;
    const hrNormT = HR_RACE - TEMP_SLOPE * (test.tempResolvedC - TEMP_REF);
    const predicted = hrNormT > 0 ? test22 * HR_RACE / hrNormT : null;
    const errorPct =
      predicted != null
        ? ((predicted - test.duration_min) / test.duration_min) * 100
        : null;

    return {
      test_id: test.id,
      date: test.date,
      kind: test.kind,
      distance_km: test.distance_km,
      duration_obs_min: test.duration_min,
      duration_pred_min: predicted != null ? round(predicted, 3) : null,
      temp_c: test.tempResolvedC,
      indicator_source: indicatorSource,
      indicator_value: round(indicator, 6),
      ratio_used: round(ratioUsed, 4),
      riegel_exp_used: calibration.riegelExp,
      error_pct: errorPct != null ? round(errorPct, 3) : null,
    };
  });

  const validErrors = entries
    .map((entry) => entry.error_pct)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    entries,
    meanAbsErrorPct:
      validErrors.length > 0
        ? round(
            validErrors.reduce((sum, value) => sum + Math.abs(value), 0) / validErrors.length,
            3
          )
        : null,
    validationCount: validErrors.length,
  };
}

export function buildFiveKPredictionView(
  activities: RunActivity[],
  tests: AllOutTest[],
  temperatureC: number,
  today = iso(new Date())
): FiveKPredictionView {
  const autoDetectedTests = buildAutoDetectedTests(activities, tests);
  const effectiveTests = [
    ...tests.filter((test) => !test.is_auto_generated),
    ...autoDetectedTests,
  ].sort((a, b) => a.date.localeCompare(b.date) || a.duration_min - b.duration_min);
  const dataSignature = makeDataSignature(activities, effectiveTests);
  const intervals = flattenIntervals(activities);
  const resolvedTests = resolveTestTemperatures(effectiveTests, intervals);
  const calibration = calibrateModel(resolvedTests, intervals);
  const validation = buildValidationLog(resolvedTests, intervals, calibration);
  const trendSeries = buildTrendSeries(intervals, today);
  const bootstrapSamples = buildBootstrapSamples(trendSeries.points, trendSeries.fit, dataSignature);
  const todayDays = differenceInCalendarDays(parseISO(today), parseISO(trendSeries.startDate));
  const repBestRaw = repBest22(today, intervals);
  const sustainRaw = repBestRaw == null ? sustainTop3_22(today, intervals) : null;
  const indicatorValue = repBestRaw ?? sustainRaw;
  const indicatorSource: IndicatorSource | null =
    repBestRaw != null ? "rep_best" : sustainRaw != null ? "sustain_top3" : null;
  const currentTime =
    indicatorValue != null
      ? predictTimeFromIndicator(indicatorValue, temperatureC, calibration.ratio)
      : null;
  const currentDistribution =
    indicatorValue != null
      ? buildTimeDistribution(
          bootstrapSamples,
          trendSeries.fit,
          todayDays,
          temperatureC,
          calibration.ratio,
          indicatorValue
        )
      : [];

  let currentLower = quantile(currentDistribution, 0.05);
  let currentUpper = quantile(currentDistribution, 0.95);
  if (currentTime != null && indicatorSource === "sustain_top3") {
    const widened = widenInterval(currentTime, currentLower, currentUpper, 1.5);
    currentLower = widened.lower;
    currentUpper = widened.upper;
  }
  const repWindowDiagnostics = summarizeRepWindow(today, intervals, autoDetectedTests);

  const isTemperatureExtrapolated = temperatureC < 14 || temperatureC > 34;
  const targetSpeed22 = 15 * HR_RACE / (HR_RACE - TEMP_SLOPE * (temperatureC - TEMP_REF));
  const rbNeeded = targetSpeed22 / calibration.ratio;

  const targetDaysSamples = bootstrapSamples
    .map((sample) => {
      if (sample.slope <= EPSILON) return null;
      return (rbNeeded - sample.intercept) / sample.slope;
    })
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => Math.max(todayDays, value));

  let optimisticDays = quantile(targetDaysSamples, 0.25);
  let realisticDays = quantile(targetDaysSamples, 0.5);
  let conservativeDays = quantile(targetDaysSamples, 0.75);

  // Fallback: when bootstrap can't detect trend (e.g., < 8 weekly points → all slopes forced to 0),
  // estimate dates using typical improvement rates so the panel never shows "—" for all three dates.
  let usedRateFallback = false;
  if (optimisticDays == null && indicatorValue != null && indicatorValue > 0) {
    if (indicatorValue >= rbNeeded) {
      optimisticDays = todayDays;
      realisticDays = todayDays;
      conservativeDays = todayDays;
    } else {
      const gap = rbNeeded - indicatorValue;
      const perDay = indicatorValue / 30; // unit: speed22 per day at 1 %/month
      optimisticDays   = todayDays + Math.ceil(gap / (perDay * 2.0)); // 2 %/month
      realisticDays    = todayDays + Math.ceil(gap / (perDay * 1.0)); // 1 %/month
      conservativeDays = todayDays + Math.ceil(gap / (perDay * 0.5)); // 0.5 %/month
      usedRateFallback = true;
    }
  }

  const targetMessage =
    usedRateFallback
      ? "Estimativa baseada em taxa de progresso típica (dados de tendência ainda insuficientes para cálculo estatístico)."
      : targetDaysSamples.length === 0
      ? "Evolução não detectável no período recente."
      : null;

  const crossingDays = realisticDays ?? optimisticDays ?? todayDays + 365;
  const horizonDays = Math.max(todayDays + 90, Math.ceil(crossingDays + 60));

  const trendCurve: FiveKPredictionPoint[] = [];
  for (let day = 0; day <= horizonDays; day += 7) {
    const indicator = Math.max(EPSILON, indicatorAtDays(trendSeries.fit, day));
    const timeMin = predictTimeFromIndicator(indicator, temperatureC, calibration.ratio);
    if (timeMin == null) continue;

    const distribution = buildTimeDistribution(
      bootstrapSamples,
      trendSeries.fit,
      day,
      temperatureC,
      calibration.ratio
    );
    trendCurve.push({
      date: iso(addDays(parseISO(trendSeries.startDate), day)),
      daysFromSeriesStart: day,
      timeMin: round(timeMin, 3),
      ciLow: quantile(distribution, 0.1),
      ciHigh: quantile(distribution, 0.9),
    });
  }

  const testsHistory: FiveKPredictionTestHistoryItem[] = resolvedTests.map((test) => {
    const equivalent22 = equivalent5kAt22(test, calibration.riegelExp);
    const equivalentAtTemp =
      equivalent22 != null
        ? equivalent22 * HR_RACE / (HR_RACE - TEMP_SLOPE * (temperatureC - TEMP_REF))
        : null;
    const daysFromSeriesStart = differenceInCalendarDays(
      parseISO(test.date),
      parseISO(trendSeries.startDate)
    );
    const predictedAtTemp =
      daysFromSeriesStart >= 0
        ? predictTimeFromIndicator(
            Math.max(EPSILON, indicatorAtDays(trendSeries.fit, daysFromSeriesStart)),
            temperatureC,
            calibration.ratio
          )
        : null;

    return {
      id: test.id,
      date: test.date,
      kind: test.kind,
      distanceKm: test.distance_km,
      durationObsMin: test.duration_min,
      equivalent5kAtTempMin: equivalentAtTemp != null ? round(equivalentAtTemp, 3) : test.duration_min,
      equivalent5kAt22Min: equivalent22 != null ? round(equivalent22, 3) : test.duration_min,
      predictedAtTempMin: predictedAtTemp != null ? round(predictedAtTemp, 3) : null,
      tempC: test.tempResolvedC,
      tempWasImputed: test.tempWasImputed,
    };
  });

  const summaryText =
    "Projecao do seu 5K atual e da meta sub-20 usando blocos fortes validados, correcao termica e calibracao com testes all-out auto-detectados.";

  const current =
    currentTime == null || indicatorValue == null || indicatorSource == null
      ? null
      : {
          indicatorValue: round(indicatorValue, 4),
          indicatorSource,
          indicatorWindowDays: WINDOW_DAYS,
          repBestRaw: round(repBestRaw ?? indicatorValue, 4),
          time5kMin: round(currentTime, 3),
          paceMinKm: round(currentTime / 5, 3),
          ci90Lower: currentLower != null ? round(currentLower, 3) : null,
          ci90Upper: currentUpper != null ? round(currentUpper, 3) : null,
          ci90HalfWidth:
            currentLower != null && currentUpper != null
              ? round((currentUpper - currentLower) / 2, 3)
              : null,
          hrRace: HR_RACE,
          note: predictionNote(temperatureC, isTemperatureExtrapolated),
          lowConfidence: indicatorSource === "sustain_top3",
        };

  return {
    today,
    temperatureC,
    isTemperatureExtrapolated,
    summaryText: summaryText ||
      "Projeção calibrada do seu 5K atual e da meta sub-20 usando reps recentes, correção térmica e autoajuste com testes all-out.",
    calibration: {
      ratio: calibration.ratio,
      riegelExp: calibration.riegelExp,
      nTestsUsed: calibration.nTestsUsed,
      autoTestsUsed: calibration.autoTestsUsed,
      manualTestsUsed: calibration.manualTestsUsed,
      lastCalibrationDate: calibration.lastCalibrationDate,
      calibrationStatus: calibration.calibrationStatus,
      calibrationMode: calibration.calibrationMode,
    },
    current,
    target20Min: {
      gapMin: current != null ? round(current.time5kMin - TARGET_MINUTES, 3) : null,
      gapPct:
        current != null ? round(((current.time5kMin - TARGET_MINUTES) / TARGET_MINUTES) * 100, 1) : null,
      optimisticDate:
        optimisticDays != null
          ? iso(addDays(parseISO(trendSeries.startDate), Math.round(optimisticDays)))
          : null,
      realisticDate:
        realisticDays != null
          ? iso(addDays(parseISO(trendSeries.startDate), Math.round(realisticDays)))
          : null,
      conservativeDate:
        conservativeDays != null
          ? iso(addDays(parseISO(trendSeries.startDate), Math.round(conservativeDays)))
          : null,
      optimisticDaysFromToday:
        optimisticDays != null ? Math.max(0, Math.round(optimisticDays - todayDays)) : null,
      realisticDaysFromToday:
        realisticDays != null ? Math.max(0, Math.round(realisticDays - todayDays)) : null,
      conservativeDaysFromToday:
        conservativeDays != null ? Math.max(0, Math.round(conservativeDays - todayDays)) : null,
      message: targetMessage,
    },
    trendCurve,
    testsHistory,
    methodology: {
      hrRace: HR_RACE,
      hrMaxObs: HRMAX_OBS,
      tempSlope: TEMP_SLOPE,
      tempRef: TEMP_REF,
      windowDays: WINDOW_DAYS,
      validationMeanAbsErrorPct: validation.meanAbsErrorPct,
      validationAlert: (validation.meanAbsErrorPct ?? 0) > 2,
      validationCount: validation.validationCount,
      fallbackActive: indicatorSource === "sustain_top3",
      repWindowDiagnostics,
    },
    persistence: {
      dataSignature,
      autoDetectedTests: autoDetectedTests.map((test) => ({
        date: test.date,
        kind: test.kind,
        distance_km: test.distance_km,
        duration_min: test.duration_min,
        temp_c: test.temp_c,
        notes: test.notes,
        source_run_activity_id: test.source_run_activity_id,
        is_auto_generated: true,
        auto_confidence: test.auto_confidence ?? null,
      })),
      modelState: {
        data_signature: dataSignature,
        ratio: calibration.ratio,
        riegel_exp: calibration.riegelExp,
        calibration_status: calibration.calibrationStatus,
        n_tests: calibration.nTestsUsed,
        max_test_date: resolvedTests.at(-1)?.date ?? null,
        last_calibration_date: calibration.lastCalibrationDate,
        hr_race: HR_RACE,
        hrmax_obs: HRMAX_OBS,
        temp_slope: TEMP_SLOPE,
        temp_ref: TEMP_REF,
        window_days: WINDOW_DAYS,
        ratio_default: RATIO_DEFAULT,
        riegel_default: RIEGEL_DEFAULT,
        trend_intercept: round(trendSeries.fit.intercept, 6),
        trend_slope: round(trendSeries.fit.slope, 8),
        trend_sigma_residual: round(trendSeries.fit.sigmaResidual, 6),
        trend_n_points: trendSeries.fit.nPoints,
        trend_r_squared:
          trendSeries.fit.rSquared != null ? round(trendSeries.fit.rSquared, 4) : null,
        bootstrap_samples: bootstrapSamples,
        validation_mean_abs_error_pct: validation.meanAbsErrorPct,
        validation_alert: (validation.meanAbsErrorPct ?? 0) > 2,
        low_confidence_default: indicatorSource === "sustain_top3",
        methodology: {
          summary_text: "Reps recentes + correção térmica + Riegel calibrado com testes all-out.",
          target_label: TARGET_MINUTES,
          calibration_mode: calibration.calibrationMode,
          auto_detected_tests: autoDetectedTests.length,
          rep_window: repWindowDiagnostics,
          target_realistic_month: formatMonthYear(
            realisticDays != null
              ? iso(addDays(parseISO(trendSeries.startDate), Math.round(realisticDays)))
              : null
          ),
        },
      },
      validationLog: validation.entries,
    },
  };
}

export { formatClock };
