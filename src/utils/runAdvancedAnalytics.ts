import { differenceInCalendarDays, parseISO } from "date-fns";
import { RunActivity, RunSession } from "@/types";

const TEMP_HR_SLOPE_FALLBACK = 0.85;
const TEMP_REF_C = 22;
const TEMP_MODEL_MIN_SESSIONS = 12;
const TEMP_MODEL_MIN_R2 = 0.05;
const COMPARABILITY_STRONG_MAX = 0.5;
const COMPARABILITY_MODERATE_MAX = 1.14;
const HR_SAME_PACE_TARGET_MIN_KM = 9;
const HR_SAME_PACE_TARGET_MIN_PER_KM = 6;
const HR_SAME_PACE_TARGET_TOLERANCE = 0.35;
const EPSILON = 1e-6;

type BlockKind = "work" | "recovery";
type ComparabilityLabel = "forte" | "moderada" | "fraca";

interface SessionIntervalRow {
  id: string;
  runActivityId: string;
  date: string;
  intervalIndex: number;
  distanceKm: number;
  durationOriginalMin: number | null;
  durationRecomputedMin: number | null;
  durationUsedMin: number;
  paceMinKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  tempC: number | null;
  flagDurationInconsistent: boolean;
  blockKind: BlockKind;
}

interface SessionTrend {
  intercept: number;
  slopePerDay: number;
}

interface TemperatureHrModel {
  slopeBpmPerC: number;
  rSquared: number | null;
  sampleCount: number;
}

export interface AdvancedRunNeighbor {
  sessionId: string;
  distance: number;
}

export interface AdvancedRunMilestone {
  sessionId: string;
  index: number;
  label: string;
  value: number;
  date: string;
}

export interface AdvancedRunTypeCount {
  label: string;
  count: number;
  color: string;
}

export interface AdvancedRunSessionAnalysis {
  id: string;
  shortId: string;
  date: string;
  daysFromStart: number;
  sessionType: string;
  comparabilityLabel: ComparabilityLabel;
  comparabilityNearest: number | null;
  totalDistanceKm: number;
  workDistanceKm: number;
  durationOriginalMin: number;
  durationUsedMin: number;
  workDurationMin: number;
  nIntervals: number;
  nWork: number;
  nRecovery: number;
  nFast: number;
  paceAvgMinKm: number | null;
  workPaceMinKm: number | null;
  paceCvWork: number | null;
  hrAvg: number | null;
  workHrAvg: number | null;
  hrNormalized: number | null;
  workHrNormalized: number | null;
  tempC: number | null;
  workEfNorm: number | null;
  executionScore: number | null;
  relativeFitnessScore: number | null;
  trimp: number | null;
  hrDriftRatio: number | null;
  paceFadeRel: number | null;
  workShareDist: number | null;
  fragmentationBlocksPerKm: number | null;
  flagAnyInconsistentInterval: boolean;
  fracInconsistentIntervals: number;
  flagHrMissing: boolean;
  flagTempMissing: boolean;
  isFlagged: boolean;
  topNeighbors: AdvancedRunNeighbor[];
  movingMedianEf: number | null;
  milestoneEf: number | null;
  trendEf: number | null;
}

export interface AdvancedRunAnalysisSummary {
  totalSessions: number;
  comparableSessions: number;
  flaggedSessions: number;
  dateMin: string;
  dateMax: string;
  efTrendPercent: number | null;
  efTrendPercentPerMonth: number | null;
  hrSamePaceSlopeBpmPerMonth: number | null;
  hrSamePaceCount: number;
  temperatureHrSlopeBpmPerC: number;
  temperatureModelR2: number | null;
  temperatureModelCount: number;
}

export interface AdvancedRunAnalysis {
  sessions: AdvancedRunSessionAnalysis[];
  typeCounts: AdvancedRunTypeCount[];
  summary: AdvancedRunAnalysisSummary;
  trend: SessionTrend | null;
  milestones: AdvancedRunMilestone[];
}

interface SessionFeatureDraft {
  id: string;
  date: string;
  totalDistanceKm: number;
  workDistanceKm: number;
  durationOriginalMin: number;
  durationUsedMin: number;
  workDurationMin: number;
  nIntervals: number;
  nWork: number;
  nRecovery: number;
  nFast: number;
  paceAvgMinKm: number | null;
  workPaceMinKm: number | null;
  paceStdWork: number | null;
  paceCvWork: number | null;
  hrAvg: number | null;
  workHrAvg: number | null;
  hrMax: number | null;
  tempC: number | null;
  hrDriftRatio: number | null;
  paceFadeRel: number | null;
  workShareDist: number | null;
  fragmentationBlocksPerKm: number | null;
  flagAnyInconsistentInterval: boolean;
  fracInconsistentIntervals: number;
  flagHrMissing: boolean;
  flagTempMissing: boolean;
  hrNormalized: number | null;
  workHrNormalized: number | null;
  workEfNorm: number | null;
  executionScore: number | null;
  trimp: number | null;
  sessionType: string;
  comparabilityLabel: ComparabilityLabel;
  comparabilityNearest: number | null;
  relativeFitnessScore: number | null;
  topNeighbors: AdvancedRunNeighbor[];
}

export const ADVANCED_RUN_TYPE_COLORS: Record<string, string> = {
  "Intervalado com tiros": "#f87171",
  "Longão contínuo": "#93c5fd",
  "Contínuo curto/médio": "#6ee7b7",
  "Fartlek / fragmentado": "#fdba74",
  Misto: "#c4b5fd",
  "Recuperativo com pausas": "#fca5a5",
};

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return 0;
  const avg = mean(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function weightedAverage(pairs: Array<{ value: number; weight: number }>): number | null {
  const valid = pairs.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  if (valid.length === 0) return null;
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function simpleLinearRegression(points: Array<{ x: number; y: number }>): SessionTrend | null {
  if (points.length < 2) return null;
  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));
  if (meanX == null || meanY == null) return null;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }

  if (denominator <= EPSILON) {
    return { intercept: meanY, slopePerDay: 0 };
  }

  const slopePerDay = numerator / denominator;
  const intercept = meanY - slopePerDay * meanX;
  return { intercept, slopePerDay };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) <= EPSILON) return null;

    if (maxRow !== pivot) {
      const temp = augmented[pivot];
      augmented[pivot] = augmented[maxRow];
      augmented[maxRow] = temp;
    }

    const pivotValue = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function regressionRSquared(rows: Array<{ y: number; x: number[] }>, coefficients: number[]) {
  if (rows.length < 2) return null;
  const meanY = mean(rows.map((row) => row.y));
  if (meanY == null) return null;

  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (const row of rows) {
    const prediction = coefficients.reduce((sum, coefficient, index) => sum + coefficient * row.x[index], 0);
    residualSumSquares += (row.y - prediction) ** 2;
    totalSumSquares += (row.y - meanY) ** 2;
  }

  if (totalSumSquares <= EPSILON) return null;
  return 1 - residualSumSquares / totalSumSquares;
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isLongContinuousType(value: string) {
  const normalized = normalizeLabel(value);
  return normalized.includes("long") && normalized.includes("continuo");
}

function fitTemperatureHrModel(sessions: SessionFeatureDraft[], daysFromStart: number[]): TemperatureHrModel {
  const rows = sessions
    .map((session, index) => {
      if (
        !isLongContinuousType(session.sessionType) ||
        session.workHrAvg == null ||
        session.workPaceMinKm == null ||
        session.tempC == null ||
        !Number.isFinite(daysFromStart[index])
      ) {
        return null;
      }

      return {
        y: session.workHrAvg,
        x: [1, session.workPaceMinKm, session.tempC, daysFromStart[index]],
      };
    })
    .filter((row): row is { y: number; x: number[] } => row != null);

  if (rows.length < TEMP_MODEL_MIN_SESSIONS) {
    return { slopeBpmPerC: TEMP_HR_SLOPE_FALLBACK, rSquared: null, sampleCount: rows.length };
  }

  const size = rows[0].x.length;
  const xtx = Array.from({ length: size }, () => Array(size).fill(0));
  const xty = Array(size).fill(0);

  for (const row of rows) {
    for (let i = 0; i < size; i += 1) {
      xty[i] += row.x[i] * row.y;
      for (let j = 0; j < size; j += 1) {
        xtx[i][j] += row.x[i] * row.x[j];
      }
    }
  }

  const solved = solveLinearSystem(xtx, xty);
  if (!solved) {
    return { slopeBpmPerC: TEMP_HR_SLOPE_FALLBACK, rSquared: null, sampleCount: rows.length };
  }

  const rSquared = regressionRSquared(rows, solved);
  const slope = solved[2];
  if (
    !Number.isFinite(slope) ||
    slope <= 0 ||
    slope > 2 ||
    (rSquared != null && rSquared < TEMP_MODEL_MIN_R2)
  ) {
    return { slopeBpmPerC: TEMP_HR_SLOPE_FALLBACK, rSquared, sampleCount: rows.length };
  }

  return { slopeBpmPerC: slope, rSquared, sampleCount: rows.length };
}

function applyTemperatureNormalization(session: SessionFeatureDraft, slopeBpmPerC: number) {
  session.hrNormalized =
    session.hrAvg != null
      ? session.hrAvg - slopeBpmPerC * ((session.tempC ?? TEMP_REF_C) - TEMP_REF_C)
      : null;

  session.workHrNormalized =
    session.workHrAvg != null
      ? session.workHrAvg - slopeBpmPerC * ((session.tempC ?? TEMP_REF_C) - TEMP_REF_C)
      : null;

  const workSpeedKmh =
    session.workPaceMinKm != null && session.workPaceMinKm > 0
      ? 60 / session.workPaceMinKm
      : null;

  session.workEfNorm =
    workSpeedKmh != null &&
    session.workHrNormalized != null &&
    session.workHrNormalized > 0
      ? workSpeedKmh / session.workHrNormalized
      : null;
}

function paceAdjustedHrSlopePerMonth(sessions: SessionFeatureDraft[], daysFromStart: number[]): { slopeBpmPerMonth: number | null; count: number } {
  const rows = sessions
    .map((session, index) => ({
      y: session.workHrNormalized,
      days: daysFromStart[index],
      pace: session.workPaceMinKm,
      type: session.sessionType,
      distanceKm: session.totalDistanceKm,
    }))
    .filter((row) =>
      row.type === "Longão contínuo" &&
      row.y != null &&
      row.pace != null &&
      Number.isFinite(row.days)
    );

  if (rows.length < 4) {
    return { slopeBpmPerMonth: null, count: rows.length };
  }

  const xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];

  for (const row of rows) {
    const x = [1, row.days, row.pace ?? 0];
    for (let i = 0; i < 3; i += 1) {
      xty[i] += x[i] * (row.y ?? 0);
      for (let j = 0; j < 3; j += 1) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  const solved = solveLinearSystem(xtx, xty);
  if (!solved) {
    return { slopeBpmPerMonth: null, count: rows.length };
  }

  return { slopeBpmPerMonth: solved[1] * 30, count: rows.length };
}

function paceAdjustedHrSlopePerMonthCalibrated(sessions: SessionFeatureDraft[], daysFromStart: number[]): { slopeBpmPerMonth: number | null; count: number } {
  const rows = sessions
    .map((session, index) => ({
      y: session.workHrNormalized,
      days: daysFromStart[index],
      pace: session.workPaceMinKm,
      type: session.sessionType,
      distanceKm: session.totalDistanceKm,
    }))
    .filter((row) =>
      isLongContinuousType(row.type) &&
      row.y != null &&
      row.pace != null &&
      row.distanceKm >= HR_SAME_PACE_TARGET_MIN_KM &&
      Math.abs(row.pace - HR_SAME_PACE_TARGET_MIN_PER_KM) <= HR_SAME_PACE_TARGET_TOLERANCE &&
      Number.isFinite(row.days)
    );

  if (rows.length < 4) {
    return { slopeBpmPerMonth: null, count: rows.length };
  }

  const xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];

  for (const row of rows) {
    const x = [1, row.days, row.pace ?? 0];
    for (let i = 0; i < 3; i += 1) {
      xty[i] += x[i] * (row.y ?? 0);
      for (let j = 0; j < 3; j += 1) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  const solved = solveLinearSystem(xtx, xty);
  if (!solved) {
    return { slopeBpmPerMonth: null, count: rows.length };
  }

  return { slopeBpmPerMonth: solved[1] * 30, count: rows.length };
}

function centeredMovingMedian(values: Array<number | null>, windowSize: number, minCount: number) {
  return values.map((_, index) => {
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + Math.ceil(windowSize / 2));
    const slice = values.slice(start, end).filter((value): value is number => value != null && Number.isFinite(value));
    if (slice.length < minCount) return null;
    return median(slice);
  });
}

function inferType(session: Pick<SessionFeatureDraft, "nFast" | "workShareDist" | "fragmentationBlocksPerKm" | "paceCvWork" | "totalDistanceKm">) {
  if (
    session.nFast >= 3 &&
    (session.workShareDist ?? 0) >= 0.5 &&
    (session.fragmentationBlocksPerKm ?? 0) >= 1.2
  ) {
    return "Intervalado com tiros";
  }
  if ((session.paceCvWork ?? Number.POSITIVE_INFINITY) < 0.05 && session.totalDistanceKm >= 6) {
    return "Longão contínuo";
  }
  if ((session.paceCvWork ?? Number.POSITIVE_INFINITY) < 0.05) {
    return "Contínuo curto/médio";
  }
  if ((session.fragmentationBlocksPerKm ?? 0) >= 2) {
    return "Fartlek / fragmentado";
  }
  if ((session.workShareDist ?? 1) < 0.5) {
    return "Recuperativo com pausas";
  }
  return "Misto";
}

function comparabilityLabel(distance: number | null): ComparabilityLabel {
  if (distance != null && distance <= COMPARABILITY_STRONG_MAX) return "forte";
  if (distance != null && distance <= COMPARABILITY_MODERATE_MAX) return "moderada";
  return "fraca";
}

function syntheticInterval(activity: RunActivity): RunSession | null {
  const hasSomeMetric =
    toFiniteNumber(activity.distance_km) != null ||
    toFiniteNumber(activity.duration_min) != null ||
    toFiniteNumber(activity.avg_pace_min_km) != null;

  if (!hasSomeMetric) return null;

  return {
    id: `synthetic-${activity.id}`,
    user_id: activity.user_id,
    run_activity_id: activity.id,
    date: activity.date,
    interval_type: "Outro",
    interval_index: 1,
    distance_km: activity.distance_km,
    duration_min: activity.duration_min,
    pace_min_km: activity.avg_pace_min_km,
    avg_hr: activity.avg_hr,
    max_hr: activity.max_hr,
    thermal_sensation_c: activity.thermal_sensation_c,
    calories_kcal: activity.calories_kcal,
    garmin_activity_id: null,
    source: activity.source,
    external_id: activity.external_id,
    notes: activity.notes,
    created_at: activity.created_at,
  };
}

function buildIntervalRows(activities: RunActivity[]): SessionIntervalRow[] {
  const rows: SessionIntervalRow[] = [];

  for (const activity of activities) {
    const rawIntervals = activity.intervals && activity.intervals.length > 0
      ? activity.intervals
      : (() => {
          const fallback = syntheticInterval(activity);
          return fallback ? [fallback] : [];
        })();

    const prepared = rawIntervals
      .map((interval, index) => {
        const distanceKm = toFiniteNumber(interval.distance_km) ?? 0;
        const durationOriginalMin = toFiniteNumber(interval.duration_min);
        const paceMinKm =
          toFiniteNumber(interval.pace_min_km) ??
          (distanceKm > 0 && durationOriginalMin != null && durationOriginalMin > 0
            ? durationOriginalMin / distanceKm
            : null);
        const durationRecomputedMin =
          distanceKm > 0 && paceMinKm != null && paceMinKm > 0
            ? distanceKm * paceMinKm
            : null;
        const deltaRel =
          durationOriginalMin != null &&
          durationRecomputedMin != null &&
          durationRecomputedMin > 0
            ? Math.abs(durationOriginalMin - durationRecomputedMin) / durationRecomputedMin
            : 0;
        const flagDurationInconsistent = deltaRel > 0.05;
        const durationUsedMin =
          flagDurationInconsistent
            ? durationRecomputedMin ?? durationOriginalMin ?? 0
            : durationOriginalMin ?? durationRecomputedMin ?? 0;

        return {
          id: interval.id,
          runActivityId: interval.run_activity_id ?? activity.id,
          date: interval.date ?? activity.date,
          intervalIndex: interval.interval_index ?? index + 1,
          distanceKm,
          durationOriginalMin,
          durationRecomputedMin,
          durationUsedMin,
          paceMinKm,
          avgHr: toFiniteNumber(interval.avg_hr),
          maxHr: toFiniteNumber(interval.max_hr),
          tempC: toFiniteNumber(interval.thermal_sensation_c),
          flagDurationInconsistent,
          blockKind: "work" as BlockKind,
        };
      })
      .sort((a, b) => a.intervalIndex - b.intervalIndex);

    const paceValues = prepared
      .map((interval) => interval.paceMinKm)
      .filter((value): value is number => value != null && value > 0);
    const medianPace = median(paceValues);
    const mad =
      medianPace == null
        ? null
        : median(
            paceValues.map((pace) => Math.abs(pace - medianPace))
          );

    for (const interval of prepared) {
      let blockKind: BlockKind = "work";
      if (interval.paceMinKm != null && medianPace != null && mad != null && mad > EPSILON) {
        const zScore = (interval.paceMinKm - medianPace) / (1.4826 * mad);
        blockKind = zScore > 1.5 ? "recovery" : "work";
        if (interval.distanceKm < 0.15 && interval.paceMinKm > medianPace * 1.3) {
          blockKind = "recovery";
        }
      }

      rows.push({
        ...interval,
        blockKind,
      });
    }
  }

  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.runActivityId.localeCompare(b.runActivityId) ||
    a.intervalIndex - b.intervalIndex
  );
}

function computeSessionFeatures(runActivityId: string, date: string, rows: SessionIntervalRow[]): SessionFeatureDraft {
  const ordered = [...rows].sort((a, b) => a.intervalIndex - b.intervalIndex);
  const totalDistanceKm = ordered.reduce((sum, row) => sum + row.distanceKm, 0);
  const durationOriginalMin = ordered.reduce((sum, row) => sum + (row.durationOriginalMin ?? 0), 0);
  const durationUsedMin = ordered.reduce((sum, row) => sum + row.durationUsedMin, 0);
  const workRows = ordered.filter((row) => row.blockKind === "work");
  const recoveryRows = ordered.filter((row) => row.blockKind === "recovery");
  const workDistanceKm = workRows.reduce((sum, row) => sum + row.distanceKm, 0);
  const workDurationMin = workRows.reduce((sum, row) => sum + row.durationUsedMin, 0);

  const paceAvgMinKm = weightedAverage(
    ordered
      .filter((row) => row.paceMinKm != null)
      .map((row) => ({ value: row.paceMinKm ?? 0, weight: row.distanceKm }))
  );

  const workPaceMinKm = weightedAverage(
    workRows
      .filter((row) => row.paceMinKm != null)
      .map((row) => ({ value: row.paceMinKm ?? 0, weight: row.distanceKm }))
  );

  const hrAvg = weightedAverage(
    ordered
      .filter((row) => row.avgHr != null)
      .map((row) => ({ value: row.avgHr ?? 0, weight: row.distanceKm }))
  );

  const workHrAvg = weightedAverage(
    workRows
      .filter((row) => row.avgHr != null)
      .map((row) => ({ value: row.avgHr ?? 0, weight: row.distanceKm }))
  );

  const hrMax = Math.max(
    ...ordered
      .flatMap((row) => [row.maxHr, row.avgHr])
      .filter((value): value is number => value != null)
  );

  const tempC = median(
    ordered
      .map((row) => row.tempC)
      .filter((value): value is number => value != null)
  );

  const workPaces = workRows
    .map((row) => row.paceMinKm)
    .filter((value): value is number => value != null);
  const paceStdWork = standardDeviation(workPaces);
  const paceCvWork =
    paceStdWork != null &&
    workPaceMinKm != null &&
    workPaceMinKm > 0
      ? paceStdWork / workPaceMinKm
      : null;

  const allPaces = ordered
    .map((row) => row.paceMinKm)
    .filter((value): value is number => value != null);
  const medianPace = median(allPaces);
  const paceMad =
    medianPace == null
      ? null
      : median(allPaces.map((pace) => Math.abs(pace - medianPace)));
  const fastThreshold =
    medianPace != null && paceMad != null
      ? medianPace - 0.5 * 1.4826 * paceMad
      : null;
  const nFast = fastThreshold == null
    ? 0
    : ordered.filter((row) => row.paceMinKm != null && row.paceMinKm < fastThreshold).length;

  let hrDriftRatio: number | null = null;
  let paceFadeRel: number | null = null;

  if (workRows.length >= 4) {
    const half = Math.floor(workRows.length / 2);
    const firstHalf = workRows.slice(0, half);
    const secondHalf = workRows.slice(half);

    const firstHalfPace = weightedAverage(
      firstHalf
        .filter((row) => row.paceMinKm != null)
        .map((row) => ({ value: row.paceMinKm ?? 0, weight: row.distanceKm }))
    );
    const secondHalfPace = weightedAverage(
      secondHalf
        .filter((row) => row.paceMinKm != null)
        .map((row) => ({ value: row.paceMinKm ?? 0, weight: row.distanceKm }))
    );

    if (
      firstHalfPace != null &&
      secondHalfPace != null &&
      firstHalfPace > 0
    ) {
      paceFadeRel = (secondHalfPace - firstHalfPace) / firstHalfPace;
    }

    const firstHalfHr = weightedAverage(
      firstHalf
        .filter((row) => row.avgHr != null)
        .map((row) => ({ value: row.avgHr ?? 0, weight: row.distanceKm || 1 }))
    );
    const secondHalfHr = weightedAverage(
      secondHalf
        .filter((row) => row.avgHr != null)
        .map((row) => ({ value: row.avgHr ?? 0, weight: row.distanceKm || 1 }))
    );

    if (
      firstHalfHr != null &&
      secondHalfHr != null &&
      firstHalfPace != null &&
      secondHalfPace != null &&
      firstHalfHr > 0 &&
      firstHalfPace > 0 &&
      secondHalfPace > 0
    ) {
      hrDriftRatio = (secondHalfHr / firstHalfHr) / (firstHalfPace / secondHalfPace) - 1;
    }
  }

  const flagAnyInconsistentInterval = ordered.some((row) => row.flagDurationInconsistent);
  const fracInconsistentIntervals =
    ordered.length > 0
      ? ordered.filter((row) => row.flagDurationInconsistent).length / ordered.length
      : 0;
  const flagHrMissing = ordered.some((row) => row.avgHr == null);
  const flagTempMissing = ordered.every((row) => row.tempC == null);

  const hrNormalized =
    hrAvg != null
      ? hrAvg - TEMP_HR_SLOPE_FALLBACK * ((tempC ?? TEMP_REF_C) - TEMP_REF_C)
      : null;
  const workHrNormalized =
    workHrAvg != null
      ? workHrAvg - TEMP_HR_SLOPE_FALLBACK * ((tempC ?? TEMP_REF_C) - TEMP_REF_C)
      : null;

  const workSpeedKmh =
    workPaceMinKm != null && workPaceMinKm > 0
      ? 60 / workPaceMinKm
      : null;

  const workEfNorm =
    workSpeedKmh != null &&
    workHrNormalized != null &&
    workHrNormalized > 0
      ? workSpeedKmh / workHrNormalized
      : null;

  const qConsistency =
    paceCvWork != null
      ? 1 - clamp(paceCvWork, 0, 0.2) / 0.2
      : null;
  const qLowDrift =
    hrDriftRatio != null
      ? 1 - Math.max(0, clamp(hrDriftRatio, -0.05, 0.15)) / 0.15
      : null;
  const qNoFade =
    paceFadeRel != null
      ? 1 - Math.max(0, clamp(paceFadeRel, -0.1, 0.15)) / 0.15
      : null;

  const executionParts = [qConsistency, qLowDrift, qNoFade].filter(
    (value): value is number => value != null
  );
  const executionScore =
    executionParts.length > 0
      ? 100 * executionParts.reduce((sum, value) => sum + value, 0) / executionParts.length
      : null;

  return {
    id: runActivityId,
    date,
    totalDistanceKm,
    workDistanceKm,
    durationOriginalMin,
    durationUsedMin,
    workDurationMin,
    nIntervals: ordered.length,
    nWork: workRows.length,
    nRecovery: recoveryRows.length,
    nFast,
    paceAvgMinKm,
    workPaceMinKm,
    paceStdWork,
    paceCvWork,
    hrAvg,
    workHrAvg,
    hrMax: Number.isFinite(hrMax) ? hrMax : null,
    tempC,
    hrDriftRatio,
    paceFadeRel,
    workShareDist: totalDistanceKm > 0 ? workDistanceKm / totalDistanceKm : null,
    fragmentationBlocksPerKm: totalDistanceKm > 0 ? ordered.length / totalDistanceKm : null,
    flagAnyInconsistentInterval,
    fracInconsistentIntervals,
    flagHrMissing,
    flagTempMissing,
    hrNormalized,
    workHrNormalized,
    workEfNorm,
    executionScore,
    trimp: null,
    sessionType: "Misto",
    comparabilityLabel: "fraca",
    comparabilityNearest: null,
    relativeFitnessScore: null,
    topNeighbors: [],
  };
}

export function buildAdvancedRunAnalysis(activities: RunActivity[]): AdvancedRunAnalysis | null {
  const intervalRows = buildIntervalRows(activities);
  if (intervalRows.length === 0) return null;

  const groups = new Map<string, SessionIntervalRow[]>();
  for (const row of intervalRows) {
    if (!groups.has(row.runActivityId)) {
      groups.set(row.runActivityId, []);
    }
    groups.get(row.runActivityId)?.push(row);
  }

  const sessionDrafts = Array.from(groups.entries())
    .map(([runActivityId, rows]) => computeSessionFeatures(runActivityId, rows[0]?.date ?? "", rows))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  if (sessionDrafts.length === 0) return null;

  const startDate = parseISO(sessionDrafts[0].date);
  const daysFromStart = sessionDrafts.map((session) =>
    differenceInCalendarDays(parseISO(session.date), startDate)
  );

  for (const session of sessionDrafts) {
    session.sessionType = inferType(session);
  }

  const temperatureHrModel = fitTemperatureHrModel(sessionDrafts, daysFromStart);
  for (const session of sessionDrafts) {
    applyTemperatureNormalization(session, temperatureHrModel.slopeBpmPerC);
  }

  const hrMaxReference =
    quantile(
      sessionDrafts
        .map((session) => session.hrMax)
        .filter((value): value is number => value != null),
      0.99
    ) ?? null;

  for (const session of sessionDrafts) {
    if (hrMaxReference != null && session.hrNormalized != null && hrMaxReference > 60) {
      const hrIntensity = clamp((session.hrNormalized - 60) / (hrMaxReference - 60), 0.3, 1.0);
      session.trimp = session.durationUsedMin * hrIntensity * 0.64 * Math.exp(1.92 * hrIntensity);
    }
  }

  const fingerprintKeys: Array<keyof SessionFeatureDraft> = [
    "totalDistanceKm",
    "workShareDist",
    "fragmentationBlocksPerKm",
    "nFast",
    "paceCvWork",
    "workDistanceKm",
  ];

  const mediansByKey = Object.fromEntries(
    fingerprintKeys.map((key) => {
      const values = sessionDrafts
        .map((session) => session[key])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return [key, median(values) ?? 0];
    })
  ) as Record<(typeof fingerprintKeys)[number], number>;

  const scaledMatrix = sessionDrafts.map((session) =>
    fingerprintKeys.map((key) => (session[key] as number | null) ?? mediansByKey[key])
  );

  const means = fingerprintKeys.map((_, columnIndex) =>
    mean(scaledMatrix.map((row) => row[columnIndex])) ?? 0
  );
  const deviations = fingerprintKeys.map((_, columnIndex) =>
    standardDeviation(scaledMatrix.map((row) => row[columnIndex])) ?? 0
  );

  const normalizedMatrix = scaledMatrix.map((row) =>
    row.map((value, columnIndex) => {
      const deviation = deviations[columnIndex];
      if (deviation <= EPSILON) return 0;
      return (value - means[columnIndex]) / deviation;
    })
  );

  const neighborIndexes: number[][] = [];
  const neighborDistances: number[][] = [];

  for (let i = 0; i < normalizedMatrix.length; i += 1) {
    const distances = normalizedMatrix.map((otherRow, otherIndex) => {
      if (otherIndex === i) {
        return { index: otherIndex, distance: Number.POSITIVE_INFINITY };
      }

      const distance = Math.sqrt(
        otherRow.reduce(
          (sum, value, columnIndex) =>
            sum + (value - normalizedMatrix[i][columnIndex]) ** 2,
          0
        )
      );

      return { index: otherIndex, distance };
    });

    const nearest = distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);

    neighborIndexes.push(nearest.map((item) => item.index));
    neighborDistances.push(nearest.map((item) => Number(item.distance.toFixed(3))));
  }

  for (let index = 0; index < sessionDrafts.length; index += 1) {
    const nearestDistance = neighborDistances[index][0] ?? null;
    sessionDrafts[index].comparabilityNearest = nearestDistance;
    sessionDrafts[index].comparabilityLabel = comparabilityLabel(nearestDistance);
    sessionDrafts[index].topNeighbors = neighborIndexes[index].map((neighborIndex, position) => ({
      sessionId: sessionDrafts[neighborIndex].id,
      distance: neighborDistances[index][position],
    }));
  }

  for (let index = 0; index < sessionDrafts.length; index += 1) {
    const currentSession = sessionDrafts[index];
    const validNeighborIndexes = currentSession.topNeighbors
      .filter((neighbor) => neighbor.distance <= 1.5)
      .map((neighbor) => sessionDrafts.findIndex((session) => session.id === neighbor.sessionId))
      .filter((value) => value >= 0);

    if (currentSession.workEfNorm == null || validNeighborIndexes.length < 2) {
      currentSession.relativeFitnessScore = null;
      continue;
    }

    const neighborEf = validNeighborIndexes
      .map((neighborIndex) => sessionDrafts[neighborIndex].workEfNorm)
      .filter((value): value is number => value != null);

    if (neighborEf.length < 2) {
      currentSession.relativeFitnessScore = null;
      continue;
    }

    const neighborMedian = median(neighborEf);
    const neighborMad = median(
      neighborEf.map((value) => Math.abs(value - (neighborMedian ?? value)))
    );

    if (neighborMedian == null || neighborMad == null || neighborMad * 1.4826 <= EPSILON) {
      currentSession.relativeFitnessScore = 0;
      continue;
    }

    currentSession.relativeFitnessScore =
      (currentSession.workEfNorm - neighborMedian) / (neighborMad * 1.4826);
  }

  const trend = simpleLinearRegression(
    sessionDrafts
      .map((session, index) => ({
        x: daysFromStart[index],
        y: session.workEfNorm,
      }))
      .filter((point): point is { x: number; y: number } => point.y != null)
  );

  const movingMedianEf = centeredMovingMedian(
    sessionDrafts.map((session) => session.workEfNorm),
    10,
    3
  );

  const milestoneSmooth = centeredMovingMedian(
    sessionDrafts.map((session) => session.workEfNorm),
    20,
    5
  );

  const milestoneCandidates = milestoneSmooth
    .map((value, index) => ({ index, value, session: sessionDrafts[index] }))
    .filter((item): item is { index: number; value: number; session: SessionFeatureDraft } => item.value != null);

  const bestMilestone = milestoneCandidates.reduce((best, item) =>
    !best || item.value > best.value ? item : best,
    null as { index: number; value: number; session: SessionFeatureDraft } | null
  );
  const worstMilestone = milestoneCandidates.reduce((worst, item) =>
    !worst || item.value < worst.value ? item : worst,
    null as { index: number; value: number; session: SessionFeatureDraft } | null
  );

  const typeCounts = Object.entries(
    sessionDrafts.reduce<Record<string, number>>((acc, session) => {
      acc[session.sessionType] = (acc[session.sessionType] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      color: ADVANCED_RUN_TYPE_COLORS[label] ?? "#94a3b8",
    }));

  const hrSlope = paceAdjustedHrSlopePerMonthCalibrated(sessionDrafts, daysFromStart);
  const maxDays = daysFromStart[daysFromStart.length - 1] ?? 0;
  const analysisSpanDays = maxDays > 0 ? maxDays + 1 : 0;

  const sessions: AdvancedRunSessionAnalysis[] = sessionDrafts.map((session, index) => ({
    id: session.id,
    shortId: shortId(session.id),
    date: session.date,
    daysFromStart: daysFromStart[index],
    sessionType: session.sessionType,
    comparabilityLabel: session.comparabilityLabel,
    comparabilityNearest: session.comparabilityNearest,
    totalDistanceKm: session.totalDistanceKm,
    workDistanceKm: session.workDistanceKm,
    durationOriginalMin: session.durationOriginalMin,
    durationUsedMin: session.durationUsedMin,
    workDurationMin: session.workDurationMin,
    nIntervals: session.nIntervals,
    nWork: session.nWork,
    nRecovery: session.nRecovery,
    nFast: session.nFast,
    paceAvgMinKm: session.paceAvgMinKm,
    workPaceMinKm: session.workPaceMinKm,
    paceCvWork: session.paceCvWork,
    hrAvg: session.hrAvg,
    workHrAvg: session.workHrAvg,
    hrNormalized: session.hrNormalized,
    workHrNormalized: session.workHrNormalized,
    tempC: session.tempC,
    workEfNorm: session.workEfNorm,
    executionScore: session.executionScore,
    relativeFitnessScore: session.relativeFitnessScore,
    trimp: session.trimp,
    hrDriftRatio: session.hrDriftRatio,
    paceFadeRel: session.paceFadeRel,
    workShareDist: session.workShareDist,
    fragmentationBlocksPerKm: session.fragmentationBlocksPerKm,
    flagAnyInconsistentInterval: session.flagAnyInconsistentInterval,
    fracInconsistentIntervals: session.fracInconsistentIntervals,
    flagHrMissing: session.flagHrMissing,
    flagTempMissing: session.flagTempMissing,
    isFlagged:
      session.flagAnyInconsistentInterval ||
      session.flagHrMissing ||
      session.flagTempMissing,
    topNeighbors: session.topNeighbors,
    movingMedianEf: movingMedianEf[index],
    milestoneEf: milestoneSmooth[index],
    trendEf:
      trend != null ? trend.intercept + trend.slopePerDay * daysFromStart[index] : null,
  }));

  const comparableSessions = sessions.filter((session) => session.comparabilityLabel !== "fraca").length;
  const flaggedSessions = sessions.filter((session) => session.isFlagged).length;
  const efTrendPercent =
    trend != null &&
    trend.intercept > EPSILON &&
    analysisSpanDays > 0
      ? ((trend.intercept + trend.slopePerDay * analysisSpanDays - trend.intercept) / trend.intercept) * 100
      : null;
  const efTrendPercentPerMonth =
    efTrendPercent != null && analysisSpanDays > 0
      ? efTrendPercent / (analysisSpanDays / 30)
      : null;

  const milestones: AdvancedRunMilestone[] = [];
  if (bestMilestone) {
    milestones.push({
      sessionId: bestMilestone.session.id,
      index: bestMilestone.index,
      label: "Melhor janela de condicionamento",
      value: bestMilestone.value,
      date: bestMilestone.session.date,
    });
  }
  if (worstMilestone) {
    milestones.push({
      sessionId: worstMilestone.session.id,
      index: worstMilestone.index,
      label: "Janela mais baixa de condicionamento",
      value: worstMilestone.value,
      date: worstMilestone.session.date,
    });
  }

  return {
    sessions,
    typeCounts,
    trend,
    milestones,
    summary: {
      totalSessions: sessions.length,
      comparableSessions,
      flaggedSessions,
      dateMin: sessions[0]?.date ?? "",
      dateMax: sessions[sessions.length - 1]?.date ?? "",
      efTrendPercent,
      efTrendPercentPerMonth,
      hrSamePaceSlopeBpmPerMonth: hrSlope.slopeBpmPerMonth,
      hrSamePaceCount: hrSlope.count,
      temperatureHrSlopeBpmPerC: temperatureHrModel.slopeBpmPerC,
      temperatureModelR2: temperatureHrModel.rSquared,
      temperatureModelCount: temperatureHrModel.sampleCount,
    },
  };
}
