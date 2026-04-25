import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RunActivity } from "@/types";
import {
  getAllOutTests,
  getRunPredictionModelState,
  replaceValidationLog,
  upsertRunPredictionModelState,
} from "@/lib/api";
import { ChartTooltip } from "@/components/ui/ChartTooltip";
import { buildFiveKPredictionView, FiveKPredictionTestHistoryItem, formatClock } from "@/utils/fiveKPrediction";

const TEMP_MIN = 12;
const TEMP_MAX = 36;
const PANEL_BG = "#17151b";
const PANEL_BORDER = "rgba(244, 186, 55, 0.24)";
const TEXT_MUTED = "#8a8290";
const TEXT_SOFT = "#b6adbb";
const GOLD = "#f5c842";
const GOLD_LINE = "#e6bf36";
const CYAN = "#7de3dd";
const OPTIMISTIC = "#73f2e6";
const REALISTIC = "#f5c842";
const CONSERVATIVE = "#ff7f66";
const TEST_DOT = "#69c9ff";
const CI_FILL = "rgba(245, 200, 66, 0.10)";
const GAP_FILL = "linear-gradient(90deg, #f7d54f, #ff8b73)";
const CHART_HEIGHT = 280;
const CHART_PADDING = { top: 18, right: 20, bottom: 34, left: 48 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scale(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  if (Math.abs(domainMax - domainMin) < 1e-6) {
    return (rangeMin + rangeMax) / 2;
  }
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function lineStyle(x1: number, y1: number, x2: number, y2: number, color: string, thickness = 2, opacity = 1) {
  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

  return {
    position: "absolute" as const,
    left: x1,
    top: y1,
    width: length,
    height: thickness,
    backgroundColor: color,
    borderRadius: thickness,
    opacity,
    transform: [{ rotate: `${angle}deg` }],
    transformOrigin: "left center" as const,
  };
}

function dashedHorizontal(y: number, width: number, color: string) {
  const dashWidth = 6;
  const gap = 5;
  const count = Math.max(1, Math.floor(width / (dashWidth + gap)));
  return Array.from({ length: count }).map((_, index) => (
    <View
      key={`dash-h-${index}`}
      className="absolute"
      style={{
        left: CHART_PADDING.left + index * (dashWidth + gap),
        top: y,
        width: dashWidth,
        height: 1.5,
        backgroundColor: color,
        opacity: 0.8,
      }}
    />
  ));
}

function dashedVertical(x: number, height: number, color: string) {
  const dashHeight = 5;
  const gap = 5;
  const count = Math.max(1, Math.floor(height / (dashHeight + gap)));
  return Array.from({ length: count }).map((_, index) => (
    <View
      key={`dash-v-${index}`}
      className="absolute"
      style={{
        left: x,
        top: CHART_PADDING.top + index * (dashHeight + gap),
        width: 1,
        height: dashHeight,
        backgroundColor: color,
        opacity: 0.6,
      }}
    />
  ));
}

function formatMonthYearPt(value: string | null) {
  if (!value) return "—";
  return format(parseISO(value), "MMM yyyy", { locale: ptBR }).toLowerCase();
}

function formatDayCount(days: number | null) {
  if (days == null) return "—";
  if (days >= 365) return `~${(days / 365).toFixed(1)} anos`;
  if (days >= 30) return `~${(days / 30).toFixed(1)} meses`;
  return `${days} dias`;
}

function formatPaceFromMinutes(minutes: number) {
  return `${formatClock(minutes)}/km`;
}

function rangeLabel(value: number | null) {
  return value == null ? "—" : `±${formatClock(value)}`;
}

function valueLabel(value: number | null) {
  return value == null ? "—" : formatClock(value);
}

function percentLabel(value: number | null) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function yLabel(value: number) {
  return formatClock(value);
}

function TooltipContent({ test }: { test: FiveKPredictionTestHistoryItem }) {
  return (
    <View className="gap-1">
      <Text className="text-[10px] text-surface-400">{test.date}</Text>
      <Text className="text-white text-xs font-bold">{test.kind}</Text>
      <Text className="text-sky-300 text-xs">
        Observado: {formatClock(test.durationObsMin)} em {test.distanceKm.toFixed(1)} km
      </Text>
      <Text className="text-amber-300 text-xs">
        Equiv. 5K: {formatClock(test.equivalent5kAtTempMin)}
      </Text>
      <Text className="text-surface-500 text-[10px]">
        Temp. {test.tempC.toFixed(1)}°C{test.tempWasImputed ? " (imputada)" : ""}
      </Text>
    </View>
  );
}

function TemperatureSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);

  function setByX(rawX: number) {
    if (trackWidth <= 0) return;
    const ratio = clamp(rawX / trackWidth, 0, 1);
    const next = TEMP_MIN + Math.round(ratio * (TEMP_MAX - TEMP_MIN));
    onChange(clamp(next, TEMP_MIN, TEMP_MAX));
  }

  const ratio = (value - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);

  return (
    <View className="gap-4">
      <View className="flex-row items-end justify-between">
        <View className="gap-1">
          <Text className="text-[10px] tracking-[3px]" style={{ color: TEXT_MUTED }}>
            TEMPERATURA / SENSAÇÃO TÉRMICA ESPERADA
          </Text>
        </View>
        <Text style={{ color: GOLD, fontSize: 34, fontWeight: "700" }}>{value}°C</Text>
      </View>

      <View
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => setByX(event.nativeEvent.locationX)}
        onResponderMove={(event) => setByX(event.nativeEvent.locationX)}
        className="pt-4"
      >
        <View className="h-[2px] rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.18)" }} />
        <View
          className="absolute top-1.5 -mt-1.5 h-6 w-6 rounded-full border-2"
          style={{
            left: `${ratio * 100}%`,
            marginLeft: -12,
            backgroundColor: GOLD,
            borderColor: "#2b2414",
            shadowColor: GOLD,
            shadowOpacity: 0.35,
            shadowRadius: 10,
            elevation: 4,
          }}
        />
      </View>

      <View className="flex-row items-center justify-between">
        {[12, 18, 22, 28, 36].map((temp) => (
          <TouchableOpacity key={temp} onPress={() => onChange(temp)}>
            <Text className="text-[11px]" style={{ color: temp === 22 ? TEXT_SOFT : TEXT_MUTED }}>
              {temp === 22 ? "22°C • ref" : `${temp}°C`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function ProjectionChart({
  chartWidth,
  view,
}: {
  chartWidth: number;
  view: ReturnType<typeof buildFiveKPredictionView>;
}) {
  const [selectedTest, setSelectedTest] = useState<{
    x: number;
    y: number;
    test: FiveKPredictionTestHistoryItem;
  } | null>(null);

  if (view.trendCurve.length < 2) {
    return <Text className="text-sm" style={{ color: TEXT_MUTED }}>Sem dados suficientes para desenhar a curva temporal.</Text>;
  }

  const chartInnerWidth = Math.max(chartWidth, Math.min(1600, Math.max(chartWidth, view.trendCurve.length * 18)));
  const plotWidth = chartInnerWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const allTimes = view.trendCurve.flatMap((point) => [point.timeMin, point.ciLow ?? point.timeMin, point.ciHigh ?? point.timeMin]);
  const allTestTimes = view.testsHistory.map((test) => test.equivalent5kAtTempMin);
  const minTime = Math.min(TARGET_MIN - 1, ...allTimes, ...allTestTimes);
  const maxTime = Math.max(...allTimes, ...allTestTimes, (view.current?.time5kMin ?? TARGET_MIN) + 1.5);
  const yMin = Math.floor(minTime);
  const yMax = Math.ceil(maxTime);
  const maxDays = view.trendCurve[view.trendCurve.length - 1]?.daysFromSeriesStart ?? 1;
  const todayDays = Math.max(
    0,
    Math.round(
      (new Date(view.today).getTime() - new Date(view.trendCurve[0].date).getTime()) / (1000 * 60 * 60 * 24)
    )
  );
  const targetY = CHART_PADDING.top + scale(TARGET_MIN, yMin, yMax, plotHeight, 0);
  const todayPoint = view.current
    ? {
        x: CHART_PADDING.left + scale(todayDays, 0, maxDays || 1, 0, plotWidth),
        y: CHART_PADDING.top + scale(view.current.time5kMin, yMin, yMax, plotHeight, 0),
      }
    : null;

  const tickCount = Math.min(10, Math.max(5, Math.floor((yMax - yMin) / 1)));
  const xTickDates = Array.from({ length: 4 }).map((_, index) => {
    const day = Math.round((maxDays / 3) * index);
    const date = view.trendCurve.find((point) => point.daysFromSeriesStart >= day)?.date ?? view.trendCurve.at(-1)?.date ?? view.today;
    return { day, date };
  });

  return (
    <View className="gap-3">
      <Text className="text-[10px] tracking-[3px]" style={{ color: TEXT_MUTED }}>
        PROJEÇÃO TEMPORAL — TEMPO DE 5K ESTIMADO AO LONGO DO TEMPO
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: chartInnerWidth, height: CHART_HEIGHT, position: "relative" }}>
          {Array.from({ length: tickCount + 1 }).map((_, index) => {
            const value = yMin + ((yMax - yMin) / tickCount) * index;
            const y = CHART_PADDING.top + scale(value, yMin, yMax, plotHeight, 0);
            return (
              <View key={`tick-${index}`}>
                <Text
                  className="absolute text-[10px]"
                  style={{ left: 0, top: y - 7, width: 40, color: TEXT_MUTED }}
                >
                  {yLabel(value)}
                </Text>
                <View
                  className="absolute"
                  style={{
                    left: CHART_PADDING.left,
                    top: y,
                    right: CHART_PADDING.right,
                    height: 1,
                    backgroundColor: "rgba(255,255,255,0.04)",
                  }}
                />
              </View>
            );
          })}

          {dashedHorizontal(targetY, plotWidth, CYAN)}

          {todayPoint ? dashedVertical(todayPoint.x, plotHeight, "rgba(255,255,255,0.5)") : null}

          {xTickDates.map((tick, index) => {
            const x = CHART_PADDING.left + scale(tick.day, 0, maxDays || 1, 0, plotWidth);
            const date = parseISO(tick.date);
            return (
              <Text
                key={`x-${index}`}
                className="absolute text-[10px]"
                style={{ left: x - 24, top: CHART_PADDING.top + plotHeight + 10, width: 64, textAlign: "center", color: TEXT_MUTED }}
              >
                {format(date, index === 0 ? "yyyy" : "MMM", { locale: ptBR }).toLowerCase()}
              </Text>
            );
          })}

          {view.trendCurve.map((point, index) => {
            if (point.ciLow == null || point.ciHigh == null) return null;
            const x = CHART_PADDING.left + scale(point.daysFromSeriesStart, 0, maxDays || 1, 0, plotWidth);
            const nextX =
              index < view.trendCurve.length - 1
                ? CHART_PADDING.left + scale(view.trendCurve[index + 1].daysFromSeriesStart, 0, maxDays || 1, 0, plotWidth)
                : x + 8;
            const yTop = CHART_PADDING.top + scale(point.ciLow, yMin, yMax, plotHeight, 0);
            const yBottom = CHART_PADDING.top + scale(point.ciHigh, yMin, yMax, plotHeight, 0);
            return (
              <View
                key={`ci-${point.daysFromSeriesStart}`}
                className="absolute"
                style={{
                  left: x,
                  top: Math.min(yTop, yBottom),
                  width: Math.max(6, nextX - x),
                  height: Math.abs(yBottom - yTop),
                  backgroundColor: CI_FILL,
                }}
              />
            );
          })}

          {view.trendCurve.map((point, index) => {
            if (index === 0) return null;
            const previous = view.trendCurve[index - 1];
            const x1 = CHART_PADDING.left + scale(previous.daysFromSeriesStart, 0, maxDays || 1, 0, plotWidth);
            const x2 = CHART_PADDING.left + scale(point.daysFromSeriesStart, 0, maxDays || 1, 0, plotWidth);
            const y1 = CHART_PADDING.top + scale(previous.timeMin, yMin, yMax, plotHeight, 0);
            const y2 = CHART_PADDING.top + scale(point.timeMin, yMin, yMax, plotHeight, 0);
            return (
              <View
                key={`line-${point.daysFromSeriesStart}`}
                style={lineStyle(x1, y1, x2, y2, GOLD_LINE, 2.4, 0.95) as any}
              />
            );
          })}

          {view.testsHistory.map((test) => {
            const day = Math.max(
              0,
              Math.round(
                (new Date(test.date).getTime() - new Date(view.trendCurve[0].date).getTime()) / (1000 * 60 * 60 * 24)
              )
            );
            const x = CHART_PADDING.left + scale(day, 0, maxDays || 1, 0, plotWidth);
            const y = CHART_PADDING.top + scale(test.equivalent5kAtTempMin, yMin, yMax, plotHeight, 0);
            return (
              <TouchableOpacity
                key={test.id}
                className="absolute rounded-full border"
                style={{
                  left: x - 5,
                  top: y - 5,
                  width: 10,
                  height: 10,
                  backgroundColor: PANEL_BG,
                  borderColor: TEST_DOT,
                }}
                onPress={() => setSelectedTest({ x, y, test })}
              />
            );
          })}

          {todayPoint ? (
            <>
              <View
                className="absolute rounded-full border"
                style={{
                  left: todayPoint.x - 5,
                  top: todayPoint.y - 5,
                  width: 10,
                  height: 10,
                  backgroundColor: GOLD,
                  borderColor: "#2b2414",
                }}
              />
              <Text
                className="absolute text-[11px] font-semibold"
                style={{
                  left: todayPoint.x + 8,
                  top: todayPoint.y - 13,
                  color: GOLD,
                }}
              >
                hoje: {formatClock(view.current?.time5kMin ?? 0)}
              </Text>
            </>
          ) : null}

          <Text
            className="absolute text-[11px] font-semibold"
            style={{ right: 0, top: targetY - 18, color: CYAN }}
          >
            meta 20:00
          </Text>

          <ChartTooltip
            visible={selectedTest != null}
            x={selectedTest ? clamp(selectedTest.x + 14, 8, chartInnerWidth - 220) : 0}
            y={selectedTest ? clamp(selectedTest.y - 110, 8, CHART_HEIGHT - 120) : 0}
          >
            {selectedTest ? <TooltipContent test={selectedTest.test} /> : null}
          </ChartTooltip>
        </View>
      </ScrollView>
    </View>
  );
}

function MetaDate({
  label,
  color,
  date,
  days,
}: {
  label: string;
  color: string;
  date: string | null;
  days: number | null;
}) {
  return (
    <View className="flex-row items-start justify-between">
      <View className="gap-2">
        <Text className="text-[12px] font-semibold tracking-[2px]" style={{ color }}>
          {label}
        </Text>
        <Text className="text-white text-[18px] font-bold">
          {date ? formatMonthYearPt(date) : "—"}
        </Text>
      </View>
      <View className="items-end gap-0.5">
        <Text className="text-[12px]" style={{ color: TEXT_SOFT }}>
          {formatDayCount(days)}
        </Text>
        <Text className="text-[11px]" style={{ color: TEXT_MUTED }}>
          {days != null ? `${days} dias` : ""}
        </Text>
      </View>
    </View>
  );
}

export function FiveKPredictionPanel({
  activities,
  chartWidth,
}: {
  activities: RunActivity[];
  chartWidth: number;
}) {
  const [temperatureC, setTemperatureC] = useState(22);
  const persistLockRef = useRef<string | null>(null);
  const { data: tests = [] } = useQuery({
    queryKey: ["all_out_tests"],
    queryFn: getAllOutTests,
  });
  const { data: storedState } = useQuery({
    queryKey: ["run_prediction_model_state"],
    queryFn: getRunPredictionModelState,
  });
  const persistMutation = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildFiveKPredictionView>["persistence"]) => {
      await upsertRunPredictionModelState(payload.modelState);
      await replaceValidationLog(payload.validationLog);
    },
  });

  const view = useMemo(
    () => buildFiveKPredictionView(activities, tests, temperatureC),
    [activities, tests, temperatureC]
  );

  useEffect(() => {
    if (!view.persistence.dataSignature) return;
    if (storedState?.data_signature === view.persistence.dataSignature) return;
    if (persistLockRef.current === view.persistence.dataSignature) return;

    persistLockRef.current = view.persistence.dataSignature;
    persistMutation.mutate(view.persistence, {
      onError: () => {
        persistLockRef.current = null;
      },
    });
  }, [persistMutation, storedState?.data_signature, view.persistence]);

  const current = view.current;
  const gapProgress =
    current != null ? clamp(TARGET_MIN / Math.max(TARGET_MIN, current.time5kMin), 0, 1) : 0;
  const wideLayout = chartWidth >= 900;

  return (
    <View
      className="rounded-[28px] border p-5 gap-6"
      style={{ backgroundColor: PANEL_BG, borderColor: PANEL_BORDER }}
    >
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-white text-[22px] font-bold">Previsão de teste de 5K</Text>
          <Text className="text-[10px] font-semibold tracking-[3px]" style={{ color: GOLD }}>
            PAINEL 87 • PROJEÇÃO CALIBRADA
          </Text>
        </View>

        <View className="border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }} />

        <Text className="text-sm leading-6" style={{ color: TEXT_SOFT }}>
          {view.summaryText}
        </Text>
      </View>

      <TemperatureSlider value={temperatureC} onChange={setTemperatureC} />

      {current == null ? (
        <View className="rounded-[24px] border px-5 py-6" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Text className="text-white text-base font-semibold">Dados insuficientes.</Text>
          <Text className="mt-2 text-sm leading-6" style={{ color: TEXT_MUTED }}>
            Ainda faltam reps recentes ou blocos fortes suficientes para montar a previsão de 5K.
          </Text>
        </View>
      ) : (
        <>
          <View
            className={`${wideLayout ? "flex-row" : "gap-4"} rounded-[24px] border`}
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            <View className="flex-1 px-5 py-6 gap-5">
              <Text className="text-[11px] tracking-[3px]" style={{ color: TEXT_MUTED }}>
                SE VOCÊ CORRESSE HOJE
              </Text>
              <View className="gap-1">
                <Text style={{ color: GOLD, fontSize: 58, lineHeight: 62, fontWeight: "700" }}>
                  {formatClock(current.time5kMin)}
                </Text>
                <Text className="text-sm" style={{ color: TEXT_MUTED }}>
                  tempo estimado para 5 km
                </Text>
              </View>

              <View className="flex-row flex-wrap gap-y-4">
                {[
                  { label: "PACE", value: formatPaceFromMinutes(current.paceMinKm) },
                  { label: "IC 90%", value: rangeLabel(current.ci90HalfWidth) },
                  { label: "HR CORRIDA", value: `${current.hrRace} bpm` },
                ].map((item) => (
                  <View key={item.label} className="w-1/3 pr-3">
                    <Text className="text-[10px] tracking-[2px]" style={{ color: TEXT_MUTED }}>
                      {item.label}
                    </Text>
                    <Text className="mt-2 text-[18px] font-bold text-white">{item.value}</Text>
                  </View>
                ))}
              </View>

              <Text
                className="text-sm leading-6"
                style={{ color: current.lowConfidence ? CONSERVATIVE : TEXT_SOFT, fontStyle: "italic" }}
              >
                {current.note}
              </Text>
            </View>

            <View
              className="px-5 py-6 gap-5"
              style={{
                width: wideLayout ? 360 : "100%",
                borderLeftWidth: wideLayout ? 1 : 0,
                borderTopWidth: wideLayout ? 0 : 1,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text className="text-[11px] tracking-[3px]" style={{ color: TEXT_MUTED }}>
                META: 5K EM 20:00 (PACE 4:00/KM)
              </Text>

              <MetaDate label="OTIMISTA" color={OPTIMISTIC} date={view.target20Min.optimisticDate} days={view.target20Min.optimisticDaysFromToday} />
              <MetaDate label="REALISTA" color={REALISTIC} date={view.target20Min.realisticDate} days={view.target20Min.realisticDaysFromToday} />
              <MetaDate label="CONSERVADOR" color={CONSERVATIVE} date={view.target20Min.conservativeDate} days={view.target20Min.conservativeDaysFromToday} />

              <View className="pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <Text className="text-[10px] tracking-[2px]" style={{ color: TEXT_MUTED }}>
                  GAP ATUAL PARA A META
                </Text>
                <View className="mt-3 flex-row items-end gap-3">
                  <Text className="text-[30px] font-bold" style={{ color: CONSERVATIVE }}>
                    {view.target20Min.gapMin != null ? `+${formatClock(view.target20Min.gapMin)}` : "—"}
                  </Text>
                  <Text className="text-sm" style={{ color: TEXT_MUTED }}>
                    {percentLabel(view.target20Min.gapPct)}
                  </Text>
                </View>
                <View className="mt-4 h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
                  <View
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${gapProgress * 100}%`,
                      backgroundColor: gapProgress > 0.6 ? "#f6d34f" : "#ff8b73",
                    }}
                  />
                </View>
                {view.target20Min.message ? (
                  <Text className="mt-3 text-xs" style={{ color: CONSERVATIVE }}>
                    {view.target20Min.message}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <ProjectionChart chartWidth={chartWidth} view={view} />

          <View className="gap-3">
            <Text className="text-[10px] tracking-[3px]" style={{ color: TEXT_MUTED }}>
              NOTAS METODOLÓGICAS
            </Text>

            <View className="flex-row flex-wrap gap-3">
              {[
                { label: "Riegel", value: view.calibration.riegelExp.toFixed(3) },
                { label: "Ratio", value: view.calibration.ratio.toFixed(4) },
                { label: "Testes calibráveis", value: `${view.calibration.nTestsUsed}` },
                {
                  label: "Erro retrospectivo médio",
                  value:
                    view.methodology.validationMeanAbsErrorPct != null
                      ? `${view.methodology.validationMeanAbsErrorPct.toFixed(2)}%`
                      : "—",
                },
              ].map((item) => (
                <View
                  key={item.label}
                  className="rounded-2xl border px-3 py-2.5"
                  style={{ borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.02)" }}
                >
                  <Text className="text-[10px] tracking-[2px]" style={{ color: TEXT_MUTED }}>
                    {item.label}
                  </Text>
                  <Text className="mt-1 text-sm font-bold text-white">{item.value}</Text>
                </View>
              ))}
            </View>

            <View className="rounded-2xl border px-4 py-3 gap-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <Text className="text-sm leading-6" style={{ color: TEXT_SOFT }}>
                {view.calibration.calibrationStatus === "default"
                  ? "Usando defaults porque ainda não há ao menos dois testes calibráveis com reps de 1 km na janela."
                  : `Modelo recalibrado até ${view.calibration.lastCalibrationDate ?? "—"} com ${view.calibration.nTestsUsed} testes calibráveis.`}
              </Text>
              {current.lowConfidence ? (
                <Text className="text-sm leading-6" style={{ color: CONSERVATIVE }}>
                  Baixa confiança: o indicador atual caiu para `sustain_top3` por falta de reps recentes de 1 km.
                </Text>
              ) : null}
              {view.methodology.validationAlert ? (
                <Text className="text-sm leading-6" style={{ color: CONSERVATIVE }}>
                  Alerta: erro absoluto médio acima de 2%; vale revisar mudança de regime, equipamento ou consistência dos testes.
                </Text>
              ) : null}
              {view.isTemperatureExtrapolated ? (
                <Text className="text-sm leading-6" style={{ color: CONSERVATIVE }}>
                  Temperatura fora do range mais observado ({TEMP_MIN}–{TEMP_MAX}°C no slider; extrapolação marcada abaixo de 14°C ou acima de 34°C).
                </Text>
              ) : null}
              <Text className="text-xs" style={{ color: TEXT_MUTED }}>
                FC corrida {view.methodology.hrRace} bpm • HRmax observado {view.methodology.hrMaxObs} bpm • slope térmico {view.methodology.tempSlope.toFixed(2)} bpm/°C.
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const TARGET_MIN = 20;
