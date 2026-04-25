export type ClassifiedIntervalType = "Easy" | "Threshold" | "Intervals" | "Race";
export type PredictionBlockKind = "work" | "recovery";

export interface PredictionActivityLike {
  id?: string | null;
  source?: string | null;
  name?: string | null;
  date?: string | null;
  distance_km?: number | null;
  duration_min?: number | null;
  avg_pace_min_km?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  thermal_sensation_c?: number | null;
}

export interface PredictionIntervalLike {
  id?: string | null;
  interval_index?: number | null;
  interval_type?: string | null;
  distance_km?: number | null;
  duration_min?: number | null;
  pace_min_km?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
}

export interface ClassifiedIntervalResult {
  intervalType: ClassifiedIntervalType;
  blockKind: PredictionBlockKind;
  confidence: number;
  workScore: number;
  recoveryScore: number;
  reasons: string[];
}

export interface AutoDetectedAllOutTest {
  kind: string;
  date: string;
  distance_km: number;
  duration_min: number;
  temp_c: number | null;
  confidence: number;
  notes: string;
  source_run_activity_id: string | null;
}

const HARD_LABELS = new Set(["work", "tempo", "threshold", "intervals", "vo2max", "race", "tt", "test"]);
const EASY_LABELS = new Set(["easy", "recovery", "warmup", "cooldown", "rest", "jog", "outro"]);
const RACE_NAME_PATTERN = /\b(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)\b/i;

function toFiniteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function normalizeRunLabel(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function mapIntervalTypeToBlockKind(value: string | null | undefined): PredictionBlockKind | null {
  const normalized = normalizeRunLabel(value);
  if (HARD_LABELS.has(normalized)) return "work";
  if (EASY_LABELS.has(normalized)) return "recovery";
  return null;
}

export function classifyRunInterval(
  activity: PredictionActivityLike,
  interval: PredictionIntervalLike,
  session: PredictionIntervalLike[]
): ClassifiedIntervalResult {
  const normalizedType = normalizeRunLabel(interval.interval_type);
  const explicitBlockKind = mapIntervalTypeToBlockKind(normalizedType);
  const distanceKm = toFiniteNumber(interval.distance_km) ?? 0;
  const paceMinKm =
    toFiniteNumber(interval.pace_min_km) ??
    (distanceKm > 0 &&
    toFiniteNumber(interval.duration_min) != null &&
    (interval.duration_min ?? 0) > 0
      ? (interval.duration_min ?? 0) / distanceKm
      : null);
  const avgHr = toFiniteNumber(interval.avg_hr);
  const maxHr = toFiniteNumber(interval.max_hr);
  const paceValues = session
    .map((item) => {
      const itemDistance = toFiniteNumber(item.distance_km) ?? 0;
      return toFiniteNumber(item.pace_min_km) ??
        (itemDistance > 0 &&
        toFiniteNumber(item.duration_min) != null &&
        (item.duration_min ?? 0) > 0
          ? (item.duration_min ?? 0) / itemDistance
          : null);
    })
    .filter((value): value is number => value != null && value > 0);
  const hrValues = session
    .map((item) => toFiniteNumber(item.avg_hr))
    .filter((value): value is number => value != null && value > 0);
  const sessionMedianPace = median(paceValues);
  const sessionFastestPace = paceValues.length > 0 ? Math.min(...paceValues) : null;
  const activityAvgPace =
    toFiniteNumber(activity.avg_pace_min_km) ??
    (toFiniteNumber(activity.distance_km) != null &&
    toFiniteNumber(activity.duration_min) != null &&
    (activity.distance_km ?? 0) > 0
      ? (activity.duration_min ?? 0) / (activity.distance_km ?? 1)
      : sessionMedianPace);
  const sessionAvgHr = toFiniteNumber(activity.avg_hr) ?? mean(hrValues);
  const paceBase = sessionMedianPace ?? activityAvgPace ?? paceMinKm;
  const reasons: string[] = [];

  let workScore = 0;
  let recoveryScore = 0;

  if (normalizedType === "race") {
    return {
      intervalType: "Race",
      blockKind: "work",
      confidence: 0.99,
      workScore: 10,
      recoveryScore: 0,
      reasons: ["label=race"],
    };
  }

  if (explicitBlockKind === "work") {
    workScore += 3;
    reasons.push(`label=${normalizedType}`);
  }
  if (explicitBlockKind === "recovery") {
    recoveryScore += 3;
    reasons.push(`label=${normalizedType}`);
  }

  if (distanceKm >= 0.85 && distanceKm <= 1.2) {
    workScore += 2;
    reasons.push("distancia~1km");
  } else if (distanceKm >= 0.6) {
    workScore += 1;
  }

  if (distanceKm > 0 && distanceKm <= 0.25) {
    recoveryScore += 2;
    reasons.push("bloco_curto");
  }

  if (paceMinKm != null && paceBase != null) {
    if (paceMinKm <= paceBase * 0.95) {
      workScore += 3;
      reasons.push("pace_muito_forte");
    } else if (paceMinKm <= paceBase * 0.98) {
      workScore += 2;
      reasons.push("pace_forte");
    } else if (paceMinKm <= paceBase * 1.01) {
      workScore += 1;
    }

    if (paceMinKm >= paceBase * 1.08) {
      recoveryScore += 2;
      reasons.push("pace_lento");
    } else if (paceMinKm >= paceBase * 1.04) {
      recoveryScore += 1;
    }
  }

  if (paceMinKm != null && sessionFastestPace != null && paceMinKm <= sessionFastestPace * 1.03) {
    workScore += 1;
  }

  if (avgHr != null) {
    const hrStrongThreshold = Math.max(160, (sessionAvgHr ?? 156) + 4);
    const hrVeryStrongThreshold = Math.max(168, (sessionAvgHr ?? 160) + 8);
    if (avgHr >= hrVeryStrongThreshold) {
      workScore += 2;
      reasons.push("fc_muito_alta");
    } else if (avgHr >= hrStrongThreshold) {
      workScore += 1;
      reasons.push("fc_alta");
    }

    if (sessionAvgHr != null && avgHr <= sessionAvgHr - 8) {
      recoveryScore += 1;
      reasons.push("fc_baixa");
    }
  }

  if (maxHr != null && maxHr >= 176) {
    workScore += 1;
  }

  if (recoveryScore >= 4 && recoveryScore >= workScore + 1) {
    return {
      intervalType: "Easy",
      blockKind: "recovery",
      confidence: clamp(0.62 + (recoveryScore - workScore) * 0.07, 0.62, 0.97),
      workScore,
      recoveryScore,
      reasons,
    };
  }

  if (workScore >= 7) {
    return {
      intervalType: distanceKm >= 2.5 && normalizedType === "race" ? "Race" : "Intervals",
      blockKind: "work",
      confidence: clamp(0.7 + (workScore - recoveryScore) * 0.05, 0.7, 0.98),
      workScore,
      recoveryScore,
      reasons,
    };
  }

  if (workScore >= 4) {
    return {
      intervalType: "Threshold",
      blockKind: "work",
      confidence: clamp(0.62 + (workScore - recoveryScore) * 0.05, 0.62, 0.94),
      workScore,
      recoveryScore,
      reasons,
    };
  }

  return {
    intervalType: "Easy",
    blockKind: "recovery",
    confidence: clamp(0.55 + (recoveryScore - workScore) * 0.05, 0.55, 0.9),
    workScore,
    recoveryScore,
    reasons,
  };
}

export function classifyRunActivityIntervals(
  activity: PredictionActivityLike,
  intervals: PredictionIntervalLike[]
) {
  const ordered = [...intervals].sort(
    (a, b) => (a.interval_index ?? 0) - (b.interval_index ?? 0)
  );
  return ordered.map((interval) => ({
    interval,
    ...classifyRunInterval(activity, interval, ordered),
  }));
}

function inferAutoTestKind(distanceKm: number) {
  if (Math.abs(distanceKm - 1.609) <= 0.12) return "auto_mile";
  if (Math.abs(distanceKm - 3) <= 0.18) return "auto_3k";
  if (Math.abs(distanceKm - 5) <= 0.25) return "auto_5k";
  if (Math.abs(distanceKm - 10) <= 0.35) return "auto_10k";
  return "auto_run";
}

export function detectAutoAllOutTest(
  activity: PredictionActivityLike,
  intervals: PredictionIntervalLike[]
): AutoDetectedAllOutTest | null {
  const date = activity.date ?? null;
  if (!date) return null;

  const classified = classifyRunActivityIntervals(activity, intervals);
  const totalDistanceKm =
    toFiniteNumber(activity.distance_km) ??
    classified.reduce((sum, item) => sum + (toFiniteNumber(item.interval.distance_km) ?? 0), 0);
  const totalDurationMin =
    toFiniteNumber(activity.duration_min) ??
    classified.reduce((sum, item) => sum + (toFiniteNumber(item.interval.duration_min) ?? 0), 0);
  const avgHr =
    toFiniteNumber(activity.avg_hr) ??
    mean(
      classified
        .map((item) => toFiniteNumber(item.interval.avg_hr))
        .filter((value): value is number => value != null && value > 0)
    );
  const maxHrResolved =
    toFiniteNumber(activity.max_hr) ??
    classified.reduce(
      (maxValue, item) => Math.max(maxValue, toFiniteNumber(item.interval.max_hr) ?? 0),
      0
    );
  const maxHr = maxHrResolved > 0 ? maxHrResolved : null;
  const hardRows = classified.filter((item) => item.blockKind === "work");
  const recoveryRows = classified.filter((item) => item.blockKind === "recovery");
  const hardDistanceKm = hardRows.reduce(
    (sum, item) => sum + (toFiniteNumber(item.interval.distance_km) ?? 0),
    0
  );
  const recoveryDistanceKm = recoveryRows.reduce(
    (sum, item) => sum + (toFiniteNumber(item.interval.distance_km) ?? 0),
    0
  );
  const longestHardKm = hardRows.reduce(
    (maxValue, item) => Math.max(maxValue, toFiniteNumber(item.interval.distance_km) ?? 0),
    0
  );
  const hardShare = totalDistanceKm > 0 ? hardDistanceKm / totalDistanceKm : 0;
  const recoveryShare = totalDistanceKm > 0 ? recoveryDistanceKm / totalDistanceKm : 0;
  const hardBlocks = hardRows.length;
  const nameHint = RACE_NAME_PATTERN.test(activity.name ?? "");
  const continuousStructure =
    hardShare >= 0.85 &&
    recoveryShare <= 0.15 &&
    hardBlocks >= 1 &&
    hardBlocks <= 2 &&
    longestHardKm >= Math.max(1.0, totalDistanceKm * 0.7);
  const strongEffort =
    nameHint ||
    (avgHr != null && avgHr >= 166) ||
    (maxHr != null && maxHr >= 178) ||
    ((avgHr ?? 0) >= 162 && (maxHr ?? 0) >= 174 && totalDistanceKm <= 5.5);
  const reliableShape = classified.length <= 3 || recoveryShare <= 0.08;

  let confidence = 0;
  if (continuousStructure) confidence += 0.38;
  if (strongEffort) confidence += 0.24;
  if (reliableShape) confidence += 0.12;
  if (nameHint) confidence += 0.14;
  if (hardShare >= 0.95) confidence += 0.08;
  if ((avgHr ?? 0) >= 168) confidence += 0.06;
  if ((maxHr ?? 0) >= 180) confidence += 0.06;
  confidence = clamp(confidence, 0, 0.99);

  if (
    totalDistanceKm < 1.4 ||
    totalDistanceKm > 10.5 ||
    totalDurationMin < 5 ||
    totalDurationMin > 80 ||
    !continuousStructure ||
    !strongEffort ||
    !reliableShape ||
    confidence < 0.65
  ) {
    return null;
  }

  const noteParts = [
    `Auto-detectado (${Math.round(confidence * 100)}% de confiança)`,
    `estrutura contínua ${Math.round(hardShare * 100)}% forte`,
  ];
  if (avgHr != null) noteParts.push(`FCm ${Math.round(avgHr)} bpm`);
  if (maxHr != null) noteParts.push(`FCmax ${Math.round(maxHr)} bpm`);

  return {
    kind: inferAutoTestKind(totalDistanceKm),
    date,
    distance_km: totalDistanceKm,
    duration_min: totalDurationMin,
    temp_c: toFiniteNumber(activity.thermal_sensation_c),
    confidence: Math.round(confidence * 1000) / 1000,
    notes: noteParts.join(" • "),
    source_run_activity_id: activity.id ?? null,
  };
}
