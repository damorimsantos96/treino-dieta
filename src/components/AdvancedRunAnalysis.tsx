import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RunActivity } from "@/types";
import { formatPace } from "@/utils/calculations";
import { ChartTooltip } from "@/components/ui/ChartTooltip";
import { FiveKPredictionPanel } from "@/components/FiveKPredictionPanel";
import {
  ADVANCED_RUN_TYPE_COLORS,
  AdvancedRunAnalysis,
  AdvancedRunMilestone,
  AdvancedRunSessionAnalysis,
  buildAdvancedRunAnalysis,
} from "@/utils/runAdvancedAnalytics";

const CHART_HEIGHT = 400;
const CHART_PADDING = { top: 18, right: 20, bottom: 34, left: 44 };
const CHART_GRID_LINES = 4;
const CHART_TOOLTIP_WIDTH = 230;
const CHART_TOOLTIP_HEIGHT = 118;
const COMP_COLORS = {
  forte: "#facc15",
  moderada: "#86efac",
  fraca: "#f87171",
} as const;
const COMP_NEIGHBOR_DOT = "#93c5fd";
const COMP_SELECTED_DOT = "#facc15";

function formatShortDate(value: string) {
  return format(parseISO(value), "dd/MM/yy");
}

function formatMonthTick(value: string, includeYear = false) {
  return format(parseISO(value), includeYear ? "MMM yyyy" : "MMM", { locale: ptBR }).toUpperCase();
}

function formatEf(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(5);
}

function formatDelta(value: number | null | undefined, digits = 1, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toFixed(digits).replace(".", ",");
  return `${prefix}${abs}${suffix}`;
}

function formatValue(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(".", ",");
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

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

function buildMonthTicks(analysis: AdvancedRunAnalysis) {
  const months: Array<{ date: string; daysFromStart: number }> = [];
  const start = parseISO(analysis.summary.dateMin);
  const end = parseISO(analysis.summary.dateMax);
  const lastSession = analysis.sessions[analysis.sessions.length - 1];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const isoDate = format(cursor, "yyyy-MM-dd");
    const session = analysis.sessions.find(
      (item) => item.date >= isoDate
    );
    months.push({
      date: isoDate,
      daysFromStart: session?.daysFromStart ?? lastSession?.daysFromStart ?? 0,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const step = months.length > 7 ? Math.ceil(months.length / 7) : 1;
  return months.filter((_, index) => index % step === 0 || index === months.length - 1);
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

function tooltipPosition(x: number, y: number, chartWidth: number) {
  return {
    x: clamp(x + 12, 8, Math.max(8, chartWidth - CHART_TOOLTIP_WIDTH)),
    y: clamp(y - CHART_TOOLTIP_HEIGHT, 8, CHART_HEIGHT - CHART_TOOLTIP_HEIGHT - 8),
  };
}

function SessionTooltip({ session, valueLabel, value }: {
  session: AdvancedRunSessionAnalysis;
  valueLabel: string;
  value: string;
}) {
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-1.5">
        <View
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: ADVANCED_RUN_TYPE_COLORS[session.sessionType] ?? "#94a3b8" }}
        />
        <Text className="text-surface-400 text-[10px]">{session.date}</Text>
      </View>
      <Text className="text-white text-xs font-bold">{session.sessionType}</Text>
      <Text className="text-amber-300 text-xs font-semibold">
        {valueLabel}: {value}
      </Text>
      <Text className="text-surface-400 text-[10px]">
        {formatValue(session.totalDistanceKm, 1)} km · {session.workPaceMinKm ? `${formatPace(session.workPaceMinKm)}/km` : "pace —"}
      </Text>
      <Text className="text-surface-500 text-[10px]">
        FC norm. {session.workHrNormalized ? `${formatValue(session.workHrNormalized, 0)} bpm` : "—"} · Temp. {session.tempC != null ? `${formatValue(session.tempC, 1)} °C` : "—"}
      </Text>
    </View>
  );
}

function AdvancedPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="rounded-2xl border border-surface-700/50 bg-surface-900/60 p-4 gap-4">
      <View className="gap-2">
        <Text className="text-white text-lg font-bold">{title}</Text>
        {description ? (
          <Text className="text-surface-400 text-sm leading-5">{description}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  valueColor,
  width,
}: {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
  width: number | `${number}%`;
}) {
  return (
    <View
      className="rounded-2xl border border-surface-700/50 bg-surface-800/70 px-4 py-3 gap-2"
      style={{ width }}
    >
      <Text className="text-surface-500 text-[10px] font-semibold uppercase tracking-widest">
        {label}
      </Text>
      <Text className={`text-2xl font-bold ${valueColor ?? "text-white"}`}>{value}</Text>
      <Text className="text-surface-500 text-xs leading-4">{hint}</Text>
    </View>
  );
}

function TypeLegend({ analysis }: { analysis: AdvancedRunAnalysis }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {analysis.typeCounts.map((item) => (
        <View
          key={item.label}
          className="flex-row items-center gap-2 rounded-full border border-surface-700/50 bg-surface-800/60 px-3 py-1.5"
        >
          <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          <Text className="text-surface-400 text-xs font-medium">
            {item.label} · {item.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ConditioningChart({
  analysis,
  baseWidth,
}: {
  analysis: AdvancedRunAnalysis;
  baseWidth: number;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    session: AdvancedRunSessionAnalysis;
    x: number;
    y: number;
  } | null>(null);
  const points = analysis.sessions.filter((session) => session.workEfNorm != null);
  if (points.length < 2) {
    return <Text className="text-surface-500 text-sm">Dados insuficientes para traçar a evolução.</Text>;
  }

  const totalDays = analysis.sessions[analysis.sessions.length - 1]?.daysFromStart ?? 0;
  const chartWidth = Math.max(baseWidth, Math.min(1600, Math.max(baseWidth, totalDays * 1.6, analysis.sessions.length * 16)));
  const plotWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const values = points.map((session) => session.workEfNorm as number);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = (maxValue - minValue || 0.004) * 0.08;
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const ticks = buildMonthTicks(analysis);

  return (
    <View className="gap-4">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
          {Array.from({ length: CHART_GRID_LINES }).map((_, index) => {
            const ratio = index / (CHART_GRID_LINES - 1);
            const value = yMax - ratio * (yMax - yMin);
            const y = CHART_PADDING.top + ratio * plotHeight;
            return (
              <View key={`grid-${index}`}>
                <View
                  className="absolute left-11 right-5 bg-surface-700/40"
                  style={{ top: y, height: 1 }}
                />
                <Text
                  className="absolute left-0 text-surface-600 text-[10px]"
                  style={{ top: y - 7, width: 36 }}
                >
                  {value.toFixed(3)}
                </Text>
              </View>
            );
          })}

          {ticks.map((tick, index) => {
            const x = CHART_PADDING.left + scale(tick.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const includeYear = index === 0 || parseISO(tick.date).getMonth() === 0;
            return (
              <View key={tick.date}>
                <View
                  className="absolute bg-surface-700/40"
                  style={{ left: x, top: CHART_PADDING.top, width: 1, height: plotHeight }}
                />
                <Text
                  className="absolute text-surface-600 text-[10px]"
                  style={{ left: x - 24, top: CHART_PADDING.top + plotHeight + 8, width: 56, textAlign: "center" }}
                >
                  {formatMonthTick(tick.date, includeYear)}
                </Text>
              </View>
            );
          })}

          {analysis.sessions.map((session, index) => {
            const current = session.movingMedianEf;
            const previous = analysis.sessions[index - 1]?.movingMedianEf;
            if (current == null || previous == null) return null;
            const x1 = CHART_PADDING.left + scale(analysis.sessions[index - 1].daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const x2 = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y1 = CHART_PADDING.top + scale(previous, yMin, yMax, plotHeight, 0);
            const y2 = CHART_PADDING.top + scale(current, yMin, yMax, plotHeight, 0);
            return <View key={`smooth-${session.id}`} style={lineStyle(x1, y1, x2, y2, "#6ee7b7", 2.5, 0.95) as any} />;
          })}

          {analysis.trend ? (() => {
            const x1 = CHART_PADDING.left;
            const x2 = CHART_PADDING.left + plotWidth;
            const y1 = CHART_PADDING.top + scale(analysis.trend.intercept, yMin, yMax, plotHeight, 0);
            const y2 = CHART_PADDING.top + scale(analysis.trend.intercept + analysis.trend.slopePerDay * totalDays, yMin, yMax, plotHeight, 0);
            return (
              <View style={lineStyle(x1, y1, x2, y2, "#facc15", 2, 0.9) as any} />
            );
          })() : null}

          {points.map((session) => {
            const x = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y = CHART_PADDING.top + scale(session.workEfNorm ?? yMin, yMin, yMax, plotHeight, 0);
            return (
              <View
                key={session.id}
                className="absolute rounded-full border border-surface-900"
                style={{
                  left: x - 4,
                  top: y - 4,
                  width: session.isFlagged ? 7 : 8,
                  height: session.isFlagged ? 7 : 8,
                  backgroundColor: ADVANCED_RUN_TYPE_COLORS[session.sessionType] ?? "#94a3b8",
                  opacity: session.isFlagged ? 0.45 : 0.9,
                }}
              />
            );
          })}

          {points.map((session) => {
            const x = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y = CHART_PADDING.top + scale(session.workEfNorm ?? yMin, yMin, yMax, plotHeight, 0);
            return (
              <View
                key={`hit-${session.id}`}
                className="absolute rounded-full"
                style={{ left: x - 10, top: y - 10, width: 20, height: 20 }}
                {...({
                  onPointerMove: () => setHoveredPoint({ session, x, y }),
                  onPointerLeave: () => setHoveredPoint(null),
                } as any)}
              />
            );
          })}

          {hoveredPoint ? (
            <View
              className="absolute rounded-full border border-white/80"
              pointerEvents="none"
              style={{
                left: hoveredPoint.x - 5,
                top: hoveredPoint.y - 5,
                width: 10,
                height: 10,
                backgroundColor: ADVANCED_RUN_TYPE_COLORS[hoveredPoint.session.sessionType] ?? "#94a3b8",
              }}
            />
          ) : null}

          <ChartTooltip
            visible={hoveredPoint != null}
            x={hoveredPoint ? tooltipPosition(hoveredPoint.x, hoveredPoint.y, chartWidth).x : 0}
            y={hoveredPoint ? tooltipPosition(hoveredPoint.x, hoveredPoint.y, chartWidth).y : 0}
          >
            {hoveredPoint ? (
              <SessionTooltip
                session={hoveredPoint.session}
                valueLabel="EF_norm"
                value={formatEf(hoveredPoint.session.workEfNorm)}
              />
            ) : null}
          </ChartTooltip>
        </View>
      </ScrollView>

      <View className="rounded-2xl border border-surface-700/50 bg-surface-800/50 px-3 py-2 gap-1">
        <Text className="text-surface-400 text-xs">
          Linha amarela: tendência linear. Linha verde: mediana móvel de 10 sessões.
        </Text>
        <Text className="text-surface-500 text-xs">
          Quanto mais alto o `work_EF_norm`, mais velocidade por batimento o treino entregou.
        </Text>
      </View>
    </View>
  );
}

function MetricPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View className="w-1/2 pr-2 pb-2">
      <View className="rounded-xl border border-surface-700/50 bg-surface-800/60 px-3 py-3 gap-1">
        <Text className="text-surface-500 text-[10px] font-semibold uppercase tracking-widest">{label}</Text>
        <Text className={`text-base font-bold ${highlight ? "text-amber-300" : "text-white"}`}>{value}</Text>
      </View>
    </View>
  );
}

function ComparatorSection({
  analysis,
  baseWidth,
}: {
  analysis: AdvancedRunAnalysis;
  baseWidth: number;
}) {
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [rightPanelHeight, setRightPanelHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!analysis.sessions.length) {
      setSelectedSessionId(null);
      return;
    }
    if (selectedSessionId && analysis.sessions.some((session) => session.id === selectedSessionId)) {
      return;
    }
    const latestWithEf = [...analysis.sessions].reverse().find((session) => session.workEfNorm != null);
    setSelectedSessionId(latestWithEf?.id ?? analysis.sessions[analysis.sessions.length - 1]?.id ?? null);
  }, [analysis.sessions, selectedSessionId]);

  const sessionById = useMemo(
    () => new Map(analysis.sessions.map((session) => [session.id, session])),
    [analysis.sessions]
  );

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...analysis.sessions]
      .reverse()
      .filter((session) =>
        !term ||
        session.date.includes(term) ||
        session.sessionType.toLowerCase().includes(term)
      );
  }, [analysis.sessions, search]);

  const selectedSession = selectedSessionId ? sessionById.get(selectedSessionId) ?? null : null;
  const neighbors = selectedSession
    ? selectedSession.topNeighbors
        .map((neighbor) => {
          const session = sessionById.get(neighbor.sessionId);
          return session ? { session, distance: neighbor.distance } : null;
        })
        .filter((item): item is { session: AdvancedRunSessionAnalysis; distance: number } => item != null)
    : [];
  const efValues = [
    selectedSession?.workEfNorm,
    ...neighbors.map((item) => item.session.workEfNorm),
  ].filter((value): value is number => value != null);
  const efMin = efValues.length ? Math.min(...efValues) : 0;
  const efMax = efValues.length ? Math.max(...efValues) : 1;
  const avgNeighborEf =
    neighbors.length > 0
      ? neighbors
          .map((item) => item.session.workEfNorm)
          .filter((value): value is number => value != null)
          .reduce((sum, value, _, arr) => sum + value / arr.length, 0)
      : null;
  const deltaVsNeighbors =
    selectedSession?.workEfNorm != null &&
    avgNeighborEf != null &&
    avgNeighborEf > 0
      ? ((selectedSession.workEfNorm - avgNeighborEf) / avgNeighborEf) * 100
      : null;
  const stacked = baseWidth < 720;
  const leftMaxHeight = stacked ? 360 : rightPanelHeight ?? undefined;
  const leftListMaxHeight = stacked
    ? 288
    : rightPanelHeight != null
      ? Math.max(180, rightPanelHeight - 74)
      : undefined;

  return (
    <View className="gap-4">
      <View className={`gap-4 ${stacked ? "" : "flex-row items-start"}`}>
        <View
          className="rounded-2xl border border-surface-700/50 bg-surface-800/60 p-2 gap-2"
          style={{
            alignSelf: stacked ? "auto" : "stretch",
            maxHeight: leftMaxHeight,
            overflow: "hidden",
            width: stacked ? "100%" : 250,
          }}
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="buscar por data ou tipo..."
            placeholderTextColor="#6b7280"
            className="rounded-xl border border-surface-700/50 bg-surface-900/50 px-3.5 py-3 text-white"
          />

          <ScrollView
            className="app-scrollbar app-scrollbar-compact"
            nestedScrollEnabled
            style={{ flex: stacked ? undefined : 1, maxHeight: leftListMaxHeight }}
            showsVerticalScrollIndicator
          >
            {filteredSessions.map((session) => (
              <TouchableOpacity
                key={session.id}
                className={`rounded-xl border px-3 py-3 mb-2 ${selectedSessionId === session.id ? "bg-amber-400/10 border-amber-300/40" : "bg-surface-900/30 border-surface-700/40"}`}
                onPress={() => setSelectedSessionId(session.id)}
              >
                <Text className="text-amber-300 text-xs font-semibold">{session.date}</Text>
                <Text className="text-white text-sm font-semibold mt-1">{session.sessionType}</Text>
                <Text className="text-surface-500 text-xs mt-1">
                  {formatValue(session.totalDistanceKm, 1)} km · {session.workPaceMinKm ? `${formatPace(session.workPaceMinKm)}/km` : "—"}
                </Text>
              </TouchableOpacity>
            ))}
            {filteredSessions.length === 0 ? (
              <Text className="text-surface-500 text-sm px-2 py-4">Nenhuma sessão bateu com a busca.</Text>
            ) : null}
          </ScrollView>
        </View>

        <View
          className="flex-1 rounded-2xl border border-surface-700/50 bg-surface-800/60 p-4 gap-4"
          onLayout={(event) => setRightPanelHeight(Math.ceil(event.nativeEvent.layout.height))}
        >
          {selectedSession ? (
            <>
              <View className="flex-row items-start justify-between gap-3">
                <View className="gap-1">
                  <Text className="text-amber-300 text-2xl font-bold">{selectedSession.date}</Text>
                  <Text className="text-surface-400 text-xs uppercase tracking-widest">
                    {selectedSession.sessionType}
                  </Text>
                </View>
                <Text
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: COMP_COLORS[selectedSession.comparabilityLabel] }}
                >
                  Comparabilidade {selectedSession.comparabilityLabel}
                </Text>
              </View>

              <View className="flex-row flex-wrap -mr-2">
                <MetricPill label="Distância" value={`${formatValue(selectedSession.totalDistanceKm, 1)} km`} />
                <MetricPill label="Pace work" value={selectedSession.workPaceMinKm ? formatPace(selectedSession.workPaceMinKm) : "—"} />
                <MetricPill label="FC work norm." value={selectedSession.workHrNormalized ? `${formatValue(selectedSession.workHrNormalized, 0)} bpm` : "—"} />
                <MetricPill label="Temperatura" value={selectedSession.tempC != null ? `${formatValue(selectedSession.tempC, 1)} °C` : "—"} />
                <MetricPill label="EF_norm" value={formatEf(selectedSession.workEfNorm)} highlight />
                <MetricPill label="Execution" value={selectedSession.executionScore != null ? formatValue(selectedSession.executionScore, 0) : "—"} />
              </View>

              {(selectedSession.flagAnyInconsistentInterval || selectedSession.flagHrMissing || selectedSession.flagTempMissing) ? (
                <View className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 gap-1">
                  {selectedSession.flagAnyInconsistentInterval ? (
                    <Text className="text-amber-200 text-xs">
                      △ {formatPercent(selectedSession.fracInconsistentIntervals * 100, 0)} dos intervalos com duração recomputada.
                    </Text>
                  ) : null}
                  {selectedSession.flagHrMissing ? (
                    <Text className="text-amber-200 text-xs">△ Há intervalo sem FC.</Text>
                  ) : null}
                  {selectedSession.flagTempMissing ? (
                    <Text className="text-amber-200 text-xs">△ Temperatura ausente; FC ficou sem normalização térmica.</Text>
                  ) : null}
                </View>
              ) : null}

              <View className="gap-2">
                <Text className="text-surface-500 text-[10px] font-semibold uppercase tracking-widest">
                  5 sessões mais estruturalmente similares
                </Text>
                <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                  <View className="flex-row items-center gap-1.5">
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: COMP_SELECTED_DOT }} />
                    <Text className="text-surface-500 text-[10px]">sessão selecionada</Text>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: COMP_NEIGHBOR_DOT }} />
                    <Text className="text-surface-500 text-[10px]">vizinha</Text>
                  </View>
                  <Text className="text-surface-500 text-[10px]">barra = escala relativa de EF_norm</Text>
                </View>
                {neighbors.map(({ session }) => {
                  const delta =
                    selectedSession.workEfNorm != null &&
                    session.workEfNorm != null &&
                    session.workEfNorm > 0
                      ? ((selectedSession.workEfNorm - session.workEfNorm) / session.workEfNorm) * 100
                      : null;
                  const neighborDot = session.workEfNorm != null
                    ? scale(session.workEfNorm, efMin, efMax || efMin + 1e-6, 0, 100)
                    : 50;
                  const selectedDot = selectedSession.workEfNorm != null
                    ? scale(selectedSession.workEfNorm, efMin, efMax || efMin + 1e-6, 0, 100)
                    : 50;

                  return (
                    <TouchableOpacity
                      key={session.id}
                      className="rounded-xl border border-surface-700/50 bg-surface-900/40 px-3 py-3 gap-2"
                      onPress={() => setSelectedSessionId(session.id)}
                    >
                      <View className="flex-row items-center gap-3">
                        <View className="flex-1">
                          <Text className="text-amber-300 text-xs font-semibold">{session.date}</Text>
                          <Text className="text-white text-sm mt-0.5">{session.sessionType}</Text>
                        </View>
                      </View>

                      <View className="h-5 justify-center">
                        <View className="h-0.5 bg-surface-700 rounded-full" />
                        <View
                          className="absolute w-2.5 h-2.5 rounded-full"
                          style={{
                            left: `${clamp(neighborDot, 0, 100)}%`,
                            marginLeft: -5,
                            top: 6,
                            backgroundColor: COMP_NEIGHBOR_DOT,
                          }}
                        />
                        <View
                          className="absolute w-2.5 h-2.5 rounded-full"
                          style={{
                            left: `${clamp(selectedDot, 0, 100)}%`,
                            marginLeft: -5,
                            top: 6,
                            backgroundColor: COMP_SELECTED_DOT,
                          }}
                        />
                      </View>

                      <View className="flex-row items-center justify-between">
                        <Text className="text-surface-500 text-xs">
                          {formatValue(session.totalDistanceKm, 1)} km · {session.workPaceMinKm ? `${formatPace(session.workPaceMinKm)}/km` : "—"}
                        </Text>
                        <Text className={`text-xs font-semibold ${delta != null && delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          Δ EF {formatDelta(delta, 1, "%")}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View className="rounded-xl border border-surface-700/50 bg-surface-900/40 px-3 py-3">
                <Text className="text-surface-400 text-sm leading-5">
                  {deltaVsNeighbors != null ? (
                    deltaVsNeighbors > 2 ? (
                      <>
                        Esta sessão está <Text className="text-emerald-300 font-bold">{formatPercent(deltaVsNeighbors, 1)}</Text> acima da média das suas vizinhas estruturais.
                      </>
                    ) : deltaVsNeighbors < -2 ? (
                      <>
                        Esta sessão está <Text className="text-rose-300 font-bold">{formatPercent(Math.abs(deltaVsNeighbors), 1)}</Text> abaixo da média das vizinhas mais parecidas.
                      </>
                    ) : (
                      <>
                        O desempenho ficou dentro do padrão das sessões estruturalmente similares.
                      </>
                    )
                  ) : (
                    "Sem EF suficiente para comparar com as vizinhas estruturais."
                  )}
                </Text>
              </View>
            </>
          ) : (
            <Text className="text-surface-500 text-sm">Selecione uma sessão para comparar.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function MilestonesChart({
  analysis,
  baseWidth,
}: {
  analysis: AdvancedRunAnalysis;
  baseWidth: number;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    session: AdvancedRunSessionAnalysis;
    x: number;
    y: number;
  } | null>(null);
  const points = analysis.sessions.filter((session) => session.milestoneEf != null);
  if (points.length < 2) {
    return <Text className="text-surface-500 text-sm">Ainda não há sessões suficientes para marcar janelas.</Text>;
  }

  const totalDays = analysis.sessions[analysis.sessions.length - 1]?.daysFromStart ?? 0;
  const chartWidth = Math.max(baseWidth, Math.min(1600, Math.max(baseWidth, totalDays * 1.6, analysis.sessions.length * 16)));
  const plotWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const values = points.map((session) => session.milestoneEf as number);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = (maxValue - minValue || 0.004) * 0.08;
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const ticks = buildMonthTicks(analysis);

  return (
    <View className="gap-4">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
          {Array.from({ length: CHART_GRID_LINES }).map((_, index) => {
            const ratio = index / (CHART_GRID_LINES - 1);
            const value = yMax - ratio * (yMax - yMin);
            const y = CHART_PADDING.top + ratio * plotHeight;
            return (
              <View key={`milestone-grid-${index}`}>
                <View
                  className="absolute left-11 right-5 bg-surface-700/40"
                  style={{ top: y, height: 1 }}
                />
                <Text
                  className="absolute left-0 text-surface-600 text-[10px]"
                  style={{ top: y - 7, width: 36 }}
                >
                  {value.toFixed(3)}
                </Text>
              </View>
            );
          })}

          {ticks.map((tick, index) => {
            const x = CHART_PADDING.left + scale(tick.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const includeYear = index === 0 || parseISO(tick.date).getMonth() === 0;
            return (
              <Text
                key={tick.date}
                className="absolute text-surface-600 text-[10px]"
                style={{ left: x - 24, top: CHART_PADDING.top + plotHeight + 8, width: 56, textAlign: "center" }}
              >
                {formatMonthTick(tick.date, includeYear)}
              </Text>
            );
          })}

          {analysis.sessions.map((session, index) => {
            const current = session.milestoneEf;
            const previous = analysis.sessions[index - 1]?.milestoneEf;
            if (current == null || previous == null) return null;
            const x1 = CHART_PADDING.left + scale(analysis.sessions[index - 1].daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const x2 = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y1 = CHART_PADDING.top + scale(previous, yMin, yMax, plotHeight, 0);
            const y2 = CHART_PADDING.top + scale(current, yMin, yMax, plotHeight, 0);
            return <View key={`milestone-line-${session.id}`} style={lineStyle(x1, y1, x2, y2, "#facc15", 2.5, 0.92) as any} />;
          })}

          {points.map((session) => {
            const x = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y = CHART_PADDING.top + scale(session.milestoneEf ?? yMin, yMin, yMax, plotHeight, 0);
            return (
              <View
                key={`milestone-hit-${session.id}`}
                className="absolute rounded-full"
                style={{ left: x - 10, top: y - 10, width: 20, height: 20 }}
                {...({
                  onPointerMove: () => setHoveredPoint({ session, x, y }),
                  onPointerLeave: () => setHoveredPoint(null),
                } as any)}
              />
            );
          })}

          {hoveredPoint ? (
            <View
              className="absolute rounded-full border border-white/80 bg-amber-300"
              pointerEvents="none"
              style={{
                left: hoveredPoint.x - 5,
                top: hoveredPoint.y - 5,
                width: 10,
                height: 10,
              }}
            />
          ) : null}

          {analysis.milestones.map((milestone, index) => {
            const session = analysis.sessions[milestone.index];
            if (!session?.milestoneEf) return null;
            const x = CHART_PADDING.left + scale(session.daysFromStart, 0, totalDays || 1, 0, plotWidth);
            const y = CHART_PADDING.top + scale(session.milestoneEf, yMin, yMax, plotHeight, 0);
            const color = index === 0 ? "#67e8f9" : "#f87171";
            const alignRight = x > chartWidth * 0.6;

            return (
              <View key={milestone.sessionId} pointerEvents="none">
                <View
                  className="absolute"
                  style={{ left: x, top: CHART_PADDING.top, width: 1, height: plotHeight, backgroundColor: color, opacity: 0.8 }}
                />
                <View
                  className="absolute rounded-full border"
                  style={{
                    left: x - 5,
                    top: y - 5,
                    width: 10,
                    height: 10,
                    backgroundColor: "rgba(15,23,42,0.9)",
                    borderColor: color,
                  }}
                />
                <Text
                  className="absolute text-xs font-semibold"
                  style={{
                    left: alignRight ? undefined : x + 8,
                    right: alignRight ? chartWidth - x + 8 : undefined,
                    top: y - 26,
                    color,
                    maxWidth: 180,
                    textAlign: alignRight ? "right" : "left",
                  }}
                >
                  {milestone.label}
                </Text>
                <Text
                  className="absolute text-[10px] text-surface-500"
                  style={{
                    left: alignRight ? undefined : x + 8,
                    right: alignRight ? chartWidth - x + 8 : undefined,
                    top: y - 10,
                    maxWidth: 180,
                    textAlign: alignRight ? "right" : "left",
                  }}
                >
                  {milestone.date}
                </Text>
              </View>
            );
          })}

          <ChartTooltip
            visible={hoveredPoint != null}
            x={hoveredPoint ? tooltipPosition(hoveredPoint.x, hoveredPoint.y, chartWidth).x : 0}
            y={hoveredPoint ? tooltipPosition(hoveredPoint.x, hoveredPoint.y, chartWidth).y : 0}
          >
            {hoveredPoint ? (
              <SessionTooltip
                session={hoveredPoint.session}
                valueLabel="Mediana 20"
                value={formatEf(hoveredPoint.session.milestoneEf)}
              />
            ) : null}
          </ChartTooltip>
        </View>
      </ScrollView>

      <View className="gap-2">
        {analysis.milestones.map((milestone, index) => (
          <MilestoneCard
            key={milestone.sessionId}
            milestone={milestone}
            color={index === 0 ? "#67e8f9" : "#f87171"}
          />
        ))}
      </View>
    </View>
  );
}

function MilestoneCard({ milestone, color }: { milestone: AdvancedRunMilestone; color: string }) {
  return (
    <View className="rounded-2xl border border-surface-700/50 bg-surface-800/60 px-4 py-3 gap-1">
      <Text className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>
        {milestone.label}
      </Text>
      <Text className="text-white text-base font-bold">{milestone.date}</Text>
      <Text className="text-surface-500 text-xs">Mediana móvel de 20 sessões: {formatEf(milestone.value)}</Text>
    </View>
  );
}

export function AdvancedRunAnalysisSection({
  activities,
  chartWidth,
}: {
  activities: RunActivity[];
  chartWidth: number;
}) {
  const analysis = useMemo(() => buildAdvancedRunAnalysis(activities), [activities]);
  const wideCards = chartWidth >= 900;

  if (!analysis) {
    return (
      <Text className="text-surface-500 text-sm">
        Sem sessões suficientes para montar as análises avançadas.
      </Text>
    );
  }

  return (
    <View className="gap-5 pt-1">
      <View className="rounded-2xl border border-surface-700/50 bg-surface-900/50 px-4 py-3">
        <Text className="text-surface-400 text-sm">
          Base completa: {analysis.summary.totalSessions} sessões entre {formatShortDate(analysis.summary.dateMin)} e {formatShortDate(analysis.summary.dateMax)}.
        </Text>
      </View>

      <AdvancedPanel title="Principais itens">
        <View className="flex-row flex-wrap justify-between gap-y-3">
          <SummaryCard
            label="Evolução — EF normalizado"
            value={analysis.summary.efTrendPercent != null ? formatDelta(analysis.summary.efTrendPercent, 1, "%") : "—"}
            hint={
              analysis.summary.efTrendPercentPerMonth != null
                ? `≈ ${formatDelta(analysis.summary.efTrendPercentPerMonth, 2, "% por mês")}`
                : "Sem tendência suficiente."
            }
            valueColor="text-amber-300"
            width={wideCards ? "32%" : "100%"}
          />
          <SummaryCard
            label="FC normalizada no mesmo pace"
            value={
              analysis.summary.hrSamePaceSlopeBpmPerMonth != null
                ? `${formatDelta(analysis.summary.hrSamePaceSlopeBpmPerMonth, 2)} bpm/mês`
                : "—"
            }
            hint={
              analysis.summary.hrSamePaceCount >= 4
                ? "Longão contínuo com ajuste por pace."
                : "Dados insuficientes para o ajuste."
            }
            width={wideCards ? "32%" : "100%"}
          />
          <SummaryCard
            label="Comparações estruturais"
            value={`${analysis.summary.comparableSessions}/${analysis.summary.totalSessions}`}
            hint="Fortes + moderadas sobre a base total."
            width={wideCards ? "32%" : "100%"}
          />
        </View>
      </AdvancedPanel>

      <AdvancedPanel
        title="Evolução do condicionamento aeróbico"
        description="Velocidade de trabalho dividida pela FC normalizada a 22 °C, por sessão. Quanto mais alto, mais eficiente a corrida ficou para o mesmo esforço."
      >
        <ConditioningChart analysis={analysis} baseWidth={chartWidth} />
        <TypeLegend analysis={analysis} />
      </AdvancedPanel>

      <AdvancedPanel
        title="Comparador de sessões"
        description="Selecione uma sessão e veja as cinco mais estruturalmente parecidas em toda a base. O delta de EF_norm fica mais confiável quando a comparabilidade é forte ou moderada."
      >
        <ComparatorSection analysis={analysis} baseWidth={chartWidth} />
      </AdvancedPanel>

      <AdvancedPanel
        title="Marcos da evolução"
        description="Janela robusta de 20 sessões para marcar o melhor e o pior trecho do histórico. Isso suaviza ruído e destaca mudanças de regime de forma mais honesta."
      >
        <MilestonesChart analysis={analysis} baseWidth={chartWidth} />
      </AdvancedPanel>

      <FiveKPredictionPanel activities={activities} chartWidth={chartWidth} />
    </View>
  );
}
