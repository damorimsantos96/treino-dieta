import { DailyLog } from "@/types";
import { addDays, differenceInMinutes, format, getDay, set } from "date-fns";

export type AvaBootsDuration = 15 | 30 | 45 | 60;
export type AvaBootsPressure = 70 | 100 | 140 | 185;
export type AvaBootsMode = "A" | "B" | "C";
export type AvaBootsTiming =
  | "pre_today"
  | "post_today"
  | "next_day_recovery"
  | "evening_prep"
  | "maintenance";

export const AVABOOTS_MODE_LABELS: Record<AvaBootsMode, string> = {
  A: "Normal",
  B: "Pressao sequencial",
  C: "Onda dupla",
};

export interface AvaBootsRecommendation {
  duration: AvaBootsDuration;
  pressure: AvaBootsPressure;
  mode: AvaBootsMode;
  modeLabel: string;
  title: string;
  timing: AvaBootsTiming;
  todayLoad: number;
  yesterdayLoad: number;
  tomorrowLoad: number;
  minutesUntilTraining: number;
  rationale: string[];
  caution: string;
}

const ACTIVITY_FIELDS = [
  { min: "min_corrida", kcal: "kcal_corrida", bpm: "bpm_corrida", weight: 1 },
  { min: "min_crossfit", kcal: "kcal_crossfit", bpm: "bpm_crossfit", weight: 1 },
  { min: "min_boxe", kcal: "kcal_boxe", bpm: "bpm_boxe", weight: 0.9 },
  { min: "min_ciclismo", kcal: "kcal_ciclismo", bpm: "bpm_ciclismo", weight: 0.8 },
  { min: "min_surf", kcal: "kcal_surf", bpm: "bpm_surf", weight: 0.7 },
  { min: "min_musculacao", kcal: "kcal_musculacao", bpm: "bpm_musculacao", weight: 0.65 },
  { min: "min_academia", kcal: "kcal_academia", bpm: "bpm_academia", weight: 0.65 },
  { min: "min_outros", kcal: "kcal_outros", bpm: "bpm_outros", weight: 0.5 },
] as const;

function numberFromLog(log: DailyLog, key: keyof DailyLog): number {
  const value = log[key];
  return typeof value === "number" ? value : 0;
}

export function computeActivityLoad(log: DailyLog | null | undefined): number {
  if (!log) return 0;

  const totalKcal = ACTIVITY_FIELDS.reduce(
    (total, activity) => total + numberFromLog(log, activity.kcal),
    0
  );
  const weightedMinutes = ACTIVITY_FIELDS.reduce(
    (total, activity) => total + numberFromLog(log, activity.min) * activity.weight,
    0
  );
  const weightedHrLoad = ACTIVITY_FIELDS.reduce((total, activity) => {
    const minutes = numberFromLog(log, activity.min);
    const bpm = numberFromLog(log, activity.bpm);
    if (!minutes || !bpm) return total;
    const hrIntensity = Math.max(0, Math.min(1, (bpm - 95) / 75));
    return total + minutes * hrIntensity * activity.weight;
  }, 0);

  const kcalScore = Math.min(1, totalKcal / 850);
  const minuteScore = Math.min(1, weightedMinutes / 120);
  const hrScore = Math.min(1, weightedHrLoad / 90);
  const whoopScore =
    log.whoop_strain != null ? Math.min(1, Math.max(0, log.whoop_strain / 21)) : null;

  const raw =
    whoopScore != null
      ? kcalScore * 0.3 + minuteScore * 0.25 + hrScore * 0.15 + whoopScore * 0.3
      : kcalScore * 0.45 + minuteScore * 0.4 + hrScore * 0.15;

  return Math.min(100, Math.round(raw * 100));
}

export function estimateDayOfWeekLoad(logs: DailyLog[], dayOfWeek: number): number {
  const matching = logs
    .filter((log) => getDay(new Date(`${log.date}T00:00:00`)) === dayOfWeek)
    .map(computeActivityLoad)
    .filter((load) => load > 5);

  if (matching.length === 0) return 0;
  const sorted = [...matching].sort((a, b) => a - b);
  const trimmed =
    sorted.length >= 5 ? sorted.slice(1, sorted.length - 1) : sorted;
  return Math.round(trimmed.reduce((total, load) => total + load, 0) / trimmed.length);
}

function buildTrainingTime(now: Date, dayOffset: 0 | 1, hour: number): Date {
  return set(addDays(now, dayOffset), {
    hours: hour,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  });
}

function choosePostTraining(load: number): Pick<AvaBootsRecommendation, "duration" | "pressure" | "mode" | "title"> {
  if (load >= 85) {
    return {
      duration: 45,
      pressure: 140,
      mode: "B",
      title: "Recuperacao pesada pos-treino",
    };
  }
  if (load >= 60) {
    return {
      duration: 30,
      pressure: 100,
      mode: "B",
      title: "Recuperacao pos-treino intenso",
    };
  }
  return {
    duration: 30,
    pressure: 100,
    mode: "A",
    title: "Recuperacao pos-atividade",
  };
}

function makeRecommendation(
  protocol: Pick<AvaBootsRecommendation, "duration" | "pressure" | "mode" | "title">,
  timing: AvaBootsTiming,
  loads: Pick<
    AvaBootsRecommendation,
    "todayLoad" | "yesterdayLoad" | "tomorrowLoad" | "minutesUntilTraining"
  >,
  rationale: string[]
): AvaBootsRecommendation {
  return {
    ...protocol,
    ...loads,
    timing,
    modeLabel: AVABOOTS_MODE_LABELS[protocol.mode],
    rationale,
    caution: "Use menos pressao se houver desconforto; evite com trombose, flebite, hipertensao descompensada, feridas, infeccao aguda ou dor incomum.",
  };
}

export function selectAvaBootsProtocol(params: {
  todayLog: DailyLog | null | undefined;
  yesterdayLog: DailyLog | null | undefined;
  historicalLogs: DailyLog[];
  now: Date;
  assumedTrainingHour?: number;
}): AvaBootsRecommendation {
  const {
    todayLog,
    yesterdayLog,
    historicalLogs,
    now,
    assumedTrainingHour = 18,
  } = params;

  const todayLoad = computeActivityLoad(todayLog);
  const yesterdayLoad = computeActivityLoad(yesterdayLog);
  const tomorrowLoad = estimateDayOfWeekLoad(historicalLogs, getDay(addDays(now, 1)));
  const todayTrainingTime = buildTrainingTime(now, 0, assumedTrainingHour);
  const tomorrowTrainingTime = buildTrainingTime(now, 1, assumedTrainingHour);
  const trainedToday = todayLoad >= 18;
  const minutesUntilTodayTraining = differenceInMinutes(todayTrainingTime, now);
  const minutesUntilTraining = trainedToday
    ? differenceInMinutes(tomorrowTrainingTime, now)
    : minutesUntilTodayTraining > 0
      ? minutesUntilTodayTraining
      : differenceInMinutes(tomorrowTrainingTime, now);
  const loads = { todayLoad, yesterdayLoad, tomorrowLoad, minutesUntilTraining };

  if (trainedToday) {
    const protocol = choosePostTraining(todayLoad);
    return makeRecommendation(protocol, "post_today", loads, [
      `Hoje marcou ${todayLoad}/100 de carga.`,
      todayLoad >= 60
        ? "Prioridade: reduzir pernas pesadas e acelerar retorno de fluxo apos o treino."
        : "Prioridade: recuperacao moderada sem exagerar na pressao.",
      `Proximo treino estimado em ${Math.max(0, Math.round(minutesUntilTraining / 60))} h.`,
    ]);
  }

  if (minutesUntilTodayTraining > 0 && minutesUntilTodayTraining <= 180) {
    return makeRecommendation(
      {
        duration: 15,
        pressure: 70,
        mode: "A",
        title: "Ativacao antes do treino",
      },
      "pre_today",
      loads,
      [
        `Treino estimado em ${Math.max(1, Math.round(minutesUntilTodayTraining / 60))} h.`,
        "Sessao curta e leve favorece circulacao sem deixar a musculatura relaxada demais.",
        `Carga de ontem: ${yesterdayLoad}/100.`,
      ]
    );
  }

  if (yesterdayLoad >= 65) {
    return makeRecommendation(
      {
        duration: 45,
        pressure: 100,
        mode: "C",
        title: "D+1 de treino pesado",
      },
      "next_day_recovery",
      loads,
      [
        `Ontem marcou ${yesterdayLoad}/100 de carga.`,
        "Dores tardias costumam aparecer entre 24 e 48 h; foco em conforto e fluxo.",
        `Amanha esta estimado em ${tomorrowLoad}/100.`,
      ]
    );
  }

  if (yesterdayLoad >= 45) {
    return makeRecommendation(
      {
        duration: 30,
        pressure: 100,
        mode: "C",
        title: "Recuperacao do treino de ontem",
      },
      "next_day_recovery",
      loads,
      [
        `Ontem marcou ${yesterdayLoad}/100 de carga.`,
        "30 min em pressao moderada e a zona mais consistente na literatura.",
        `Proximo treino estimado em ${Math.max(0, Math.round(minutesUntilTraining / 60))} h.`,
      ]
    );
  }

  if (minutesUntilTodayTraining <= 0 && tomorrowLoad >= 60) {
    return makeRecommendation(
      {
        duration: 30,
        pressure: 70,
        mode: "C",
        title: "Preparacao para amanha",
      },
      "evening_prep",
      loads,
      [
        `Amanha costuma ser ${tomorrowLoad}/100 para este dia da semana.`,
        "Pressao baixa ajuda relaxamento sem buscar uma sessao agressiva na vespera.",
        `Horario estimado do treino: ${format(tomorrowTrainingTime, "HH:mm")}.`,
      ]
    );
  }

  if (tomorrowLoad >= 75 && minutesUntilTraining <= 24 * 60) {
    return makeRecommendation(
      {
        duration: 15,
        pressure: 70,
        mode: "A",
        title: "Priming leve",
      },
      "evening_prep",
      loads,
      [
        `Amanha costuma ser pesado (${tomorrowLoad}/100).`,
        "Volume curto evita uma sessao longa perto de um dia exigente.",
        `Horario estimado do treino: ${format(tomorrowTrainingTime, "HH:mm")}.`,
      ]
    );
  }

  return makeRecommendation(
    {
      duration: 30,
      pressure: 70,
      mode: now.getHours() >= 18 ? "C" : "A",
      title: now.getHours() >= 18 ? "Relaxamento noturno" : "Manutencao circulatoria",
    },
    "maintenance",
    loads,
    [
      "Sem treino relevante registrado hoje.",
      `Ontem: ${yesterdayLoad}/100; amanha estimado: ${tomorrowLoad}/100.`,
      "Sessao leve e suficiente para manutencao sem usar pressao alta.",
    ]
  );
}
