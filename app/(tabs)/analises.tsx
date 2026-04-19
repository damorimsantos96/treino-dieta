import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { getDailyLogs, getRunActivities, upsertDailyLog } from "@/lib/api";
import { computeDailyCalculations, formatDuration, formatPace } from "@/utils/calculations";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { Card, SectionLabel } from "@/components/ui/Card";
import { Ionicons } from "@expo/vector-icons";
import { RunActivity } from "@/types";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";

const SCREEN_FALLBACK = 320;
const CHART_LEFT = 36;
const CHART_RIGHT = 50;
const CHART_BOTTOM = 24;
const CHART_TOP = 8;

type Period = "30d" | "90d" | "6m" | "1y" | "max";

const PERIODS: { key: Period; label: string }[] = [
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "6m", label: "6m" },
  { key: "1y", label: "1a" },
  { key: "max", label: "Máx." },
];

function periodToDate(period: Period): Date {
  const now = new Date();
  if (period === "30d") return subDays(now, 30);
  if (period === "90d") return subDays(now, 90);
  if (period === "6m") return subMonths(now, 6);
  if (period === "max") return subYears(now, 10);
  return subMonths(now, 12);
}

function activityDistance(activity: RunActivity): number {
  return activity.distance_km ??
    activity.intervals?.reduce((sum, item) => sum + (item.distance_km ?? 0), 0) ??
    0;
}

function activityDuration(activity: RunActivity): number {
  return activity.duration_min ??
    activity.intervals?.reduce((sum, item) => sum + (item.duration_min ?? 0), 0) ??
    0;
}

function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - windowSize + 1), index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function SimpleBarChart({
  data,
  color = "#10b981",
  height = 120,
  chartWidth = SCREEN_FALLBACK,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  chartWidth?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) return null;

  const max = Math.max(...data.map((item) => item.value), 1);
  const plotWidth = Math.max(160, chartWidth - CHART_LEFT - CHART_RIGHT);
  const plotHeight = height - CHART_TOP;
  const slotWidth = plotWidth / data.length;
  const barWidth = Math.max(1, Math.min(24, slotWidth * 0.72));
  const activeIndex = hovered ?? selected;
  const selectedItem = activeIndex == null ? null : data[activeIndex];

  return (
    <View className="gap-2">
      <View style={{ height: height + CHART_BOTTOM, width: chartWidth }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">
          {Math.round(max).toLocaleString()}
        </Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">0</Text>
        <View
          className="absolute flex-row items-end justify-between overflow-hidden"
          style={{
            left: CHART_LEFT,
            right: CHART_RIGHT,
            top: CHART_TOP,
            height: plotHeight,
          }}
        >
          {data.map((item, index) => (
            <TouchableOpacity
              key={`${item.label}-${index}`}
              onPress={() => setSelected((prev) => prev === index ? null : index)}
              className="items-center justify-end"
              style={{ width: slotWidth, height: plotHeight }}
              {...({
                onPointerEnter: () => setHovered(index),
                onPointerLeave: () => setHovered(null),
              } as any)}
            >
              <View
                style={{
                  width: barWidth,
                  height: Math.max(3, (item.value / max) * (plotHeight - 8)),
                  backgroundColor: color,
                  borderRadius: 4,
                  opacity: activeIndex === index ? 1 : 0.85,
                }}
              />
            </TouchableOpacity>
          ))}
        </View>
        <View
          className="absolute bottom-0"
          style={{ left: CHART_LEFT, width: plotWidth, height: 14 }}
        >
          {data.map((item, index) => {
            const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 5) === 0;
            return (
              <Text
                key={`${item.label}-axis`}
                className="text-surface-600 text-[10px]"
                style={{
                  position: "absolute",
                  left: Math.min(plotWidth - 46, Math.max(0, index * slotWidth - 14)),
                  width: 46,
                }}
              >
                {show ? item.label : ""}
              </Text>
            );
          })}
        </View>
      </View>
      {selectedItem && (
        <View className="bg-surface-700/50 border border-surface-600/40 rounded-xl px-3 py-2">
          <Text className="text-white text-xs font-semibold">
            {selectedItem.label}: {Math.round(selectedItem.value).toLocaleString()} kcal
          </Text>
        </View>
      )}
    </View>
  );
}

function MultiSparkLine({
  labels,
  series,
  height = 120,
  chartWidth = SCREEN_FALLBACK,
}: {
  labels: string[];
  series: { label: string; color: string; data: number[] }[];
  height?: number;
  chartWidth?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  if (series.length === 0) return null;
  const allValues = series.flatMap((item) => item.data).filter((value) => Number.isFinite(value));
  if (allValues.length < 2) return null;

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const maxLength = Math.max(...series.map((item) => item.data.length));
  const plotWidth = Math.max(160, chartWidth - CHART_LEFT - CHART_RIGHT);
  const plotHeight = height - CHART_TOP;
  const pointW = maxLength > 1 ? plotWidth / (maxLength - 1) : plotWidth;
  const activeIndex = hovered ?? selected;
  const selectedValues = activeIndex != null
    ? series.map((line) => line.data[activeIndex]).filter(Number.isFinite)
    : [];

  return (
    <View className="gap-3">
      <View style={{ height: height + CHART_BOTTOM, position: "relative", width: chartWidth }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">{max.toFixed(1)} kg</Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">{min.toFixed(1)} kg</Text>
        <View
          pointerEvents="none"
          className="absolute overflow-hidden"
          style={{
            left: CHART_LEFT,
            right: CHART_RIGHT,
            top: CHART_TOP,
            height: plotHeight,
          }}
        >
          {series.map((line) =>
            line.data.map((value, index) => {
              if (index === 0) return null;
              const previous = line.data[index - 1];
              const x1 = (index - 1) * pointW;
              const x2 = index * pointW;
              const y1 = plotHeight - ((previous - min) / range) * (plotHeight - 8) - 4;
              const y2 = plotHeight - ((value - min) / range) * (plotHeight - 8) - 4;
              const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
              const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
              return (
                <View
                  key={`${line.label}-${index}`}
                  style={{
                    position: "absolute",
                    left: x1,
                    top: y1,
                    width: len,
                    height: 2,
                    backgroundColor: line.color,
                    borderRadius: 2,
                    transformOrigin: "left center",
                    transform: [{ rotate: `${angle}deg` }],
                    opacity: activeIndex != null && Math.round(activeIndex) === index ? 1 : 0.85,
                  }}
                />
              );
            })
          )}
          {activeIndex != null && series[0]?.data[activeIndex] != null && (() => {
            const value = series[0].data[activeIndex];
            const cx = activeIndex * pointW;
            const cy = plotHeight - ((value - min) / range) * (plotHeight - 8) - 4;
            return (
              <View
                style={{
                  position: "absolute",
                  left: cx - 4,
                  top: cy - 4,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: series[0].color,
                }}
              />
            );
          })()}
        </View>
        <TouchableOpacity
          activeOpacity={1}
          className="absolute"
          style={{
            left: CHART_LEFT,
            right: CHART_RIGHT,
            top: CHART_TOP,
            height: plotHeight,
          }}
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            const index = Math.round(x / pointW);
            const clamped = Math.max(0, Math.min(maxLength - 1, index));
            setSelected((prev) => prev === clamped ? null : clamped);
          }}
          {...({
            onPointerMove: (e: any) => {
              const x = e.nativeEvent.offsetX ?? e.nativeEvent.locationX;
              setHovered(Math.max(0, Math.min(maxLength - 1, Math.round(x / pointW))));
            },
            onPointerLeave: () => setHovered(null),
          } as any)}
        />
        <View
          className="absolute bottom-0 flex-row justify-between"
          style={{ left: CHART_LEFT, right: CHART_RIGHT }}
        >
          {[0, Math.floor(labels.length / 2), labels.length - 1].map((index) => (
            <Text key={`${labels[index]}-${index}`} className="text-surface-600 text-[10px]">
              {labels[index]}
            </Text>
          ))}
        </View>
      </View>
      {activeIndex != null && selectedValues.length > 0 && (
        <View className="bg-surface-700/50 border border-surface-600/40 rounded-xl px-3 py-2">
          <Text className="text-surface-400 text-xs mb-1">{labels[activeIndex]}</Text>
          <View className="flex-row gap-4 flex-wrap">
            {series.map((line) => (
              <View key={line.label} className="flex-row items-center gap-1.5">
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
                <Text className="text-white text-xs font-semibold">
                  {line.label}: {line.data[activeIndex]?.toFixed(1)} kg
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <View className="flex-row flex-wrap gap-3">
        {series.map((line) => (
          <View key={line.label} className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: line.color }} />
            <Text className="text-surface-500 text-xs font-semibold">{line.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type RunBucketMode = "day" | "week" | "month";

function runBucketMode(period: Period): RunBucketMode {
  if (period === "30d") return "day";
  if (period === "1y" || period === "max") return "month";
  return "week";
}

function bucketStart(date: Date, mode: RunBucketMode): Date {
  if (mode === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (mode === "week") return startOfWeek(date, { weekStartsOn: 1 });
  return startOfMonth(date);
}

function bucketEnd(date: Date, mode: RunBucketMode): Date {
  if (mode === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  if (mode === "week") return endOfWeek(date, { weekStartsOn: 1 });
  return endOfMonth(date);
}

function advanceBucket(date: Date, mode: RunBucketMode): Date {
  if (mode === "day") return addDays(date, 1);
  if (mode === "week") return addWeeks(date, 1);
  return addMonths(date, 1);
}

function buildRunBuckets(activities: RunActivity[], from: Date, to: Date, mode: RunBucketMode) {
  const buckets: { label: string; distance: number; pace: number | null }[] = [];
  let cursor = bucketStart(from, mode);

  while (cursor <= to) {
    const start = bucketStart(cursor, mode);
    const end = bucketEnd(cursor, mode);
    const bucketActivities = activities.filter((activity) => {
      const date = parseISO(activity.date);
      return date >= start && date <= end;
    });
    const distance = bucketActivities.reduce((sum, activity) => sum + activityDistance(activity), 0);
    const duration = bucketActivities.reduce((sum, activity) => sum + activityDuration(activity), 0);

    buckets.push({
      label: mode === "month" ? format(start, "MM/yy") : format(start, "dd/MM"),
      distance,
      pace: distance > 0 && duration > 0 ? duration / distance : null,
    });
    cursor = advanceBucket(cursor, mode);
  }

  return buckets;
}

function RunVolumePaceChart({
  activities,
  from,
  to,
  period,
  chartWidth = SCREEN_FALLBACK,
}: {
  activities: RunActivity[];
  from: Date;
  to: Date;
  period: Period;
  chartWidth?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const mode = runBucketMode(period);
  const data = useMemo(() => buildRunBuckets(activities, from, to, mode), [activities, from, to, mode]);
  if (data.length === 0) return null;

  const height = 130;
  const maxKm = Math.max(...data.map((item) => item.distance), 1);
  const paces = data.map((item) => item.pace).filter((pace): pace is number => pace != null);
  const minPace = paces.length ? Math.min(...paces) : 0;
  const maxPace = paces.length ? Math.max(...paces) : 1;
  const paceRange = maxPace - minPace || 1;
  const plotWidth = Math.max(160, chartWidth - CHART_LEFT - CHART_RIGHT);
  const plotHeight = height - CHART_TOP;
  const pointW = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth;
  const slotWidth = plotWidth / data.length;
  const barWidth = Math.max(2, Math.min(26, slotWidth * 0.72));
  const activeIndex = hovered ?? selected;
  const selectedItem = activeIndex == null ? null : data[activeIndex];

  return (
    <View className="gap-3">
      <View className="flex-row justify-end gap-3">
        <View className="flex-row items-center gap-1">
          <View className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
          <Text className="text-surface-500 text-xs">Distancia</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2.5 h-0.5 bg-red-400" />
          <Text className="text-surface-500 text-xs">Ritmo</Text>
        </View>
      </View>

      <View style={{ height: height + CHART_BOTTOM, width: chartWidth }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">{maxKm.toFixed(0)} km</Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">0 km</Text>
        {paces.length > 0 && (
          <>
            <Text className="absolute right-0 top-0 text-surface-600 text-[10px]">{formatPace(minPace)}/km</Text>
            <Text className="absolute right-0 bottom-6 text-surface-600 text-[10px]">{formatPace(maxPace)}/km</Text>
          </>
        )}

        <View
          className="absolute flex-row items-end justify-between overflow-hidden"
          style={{
            left: CHART_LEFT,
            right: CHART_RIGHT,
            top: CHART_TOP,
            height: plotHeight,
          }}
        >
          {data.map((item, index) => (
            <TouchableOpacity
              key={`${item.label}-${index}`}
              onPress={() => setSelected((prev) => prev === index ? null : index)}
              className="items-center justify-end"
              style={{ width: slotWidth, height: plotHeight }}
              {...({
                onPointerEnter: () => setHovered(index),
                onPointerLeave: () => setHovered(null),
              } as any)}
            >
              <View
                style={{
                  width: barWidth,
                  height: Math.max(2, (item.distance / maxKm) * (plotHeight - 8)),
                  backgroundColor: "#3b82f6",
                  borderRadius: 4,
                  opacity: activeIndex === index ? 1 : 0.82,
                }}
              />
            </TouchableOpacity>
          ))}
        </View>

        <View
          pointerEvents="none"
          className="absolute overflow-hidden"
          style={{
            left: CHART_LEFT,
            right: CHART_RIGHT,
            top: CHART_TOP,
            height: plotHeight,
          }}
        >
          {data.map((item, index) => {
            if (index === 0 || item.pace == null || data[index - 1].pace == null) return null;
            const previous = data[index - 1].pace!;
            const x1 = (index - 1) * pointW;
            const x2 = index * pointW;
            const y1 = ((previous - minPace) / paceRange) * (plotHeight - 10) + 5;
            const y2 = ((item.pace - minPace) / paceRange) * (plotHeight - 10) + 5;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            return (
              <View
                key={`pace-${index}`}
                style={{
                  position: "absolute",
                  left: x1,
                  top: y1,
                  width: len,
                  height: 2,
                  backgroundColor: "#f87171",
                  borderRadius: 2,
                  transformOrigin: "left center",
                  transform: [{ rotate: `${angle}deg` }],
                }}
              />
            );
          })}
        </View>

        <View
          className="absolute bottom-0"
          style={{ left: CHART_LEFT, width: plotWidth, height: 14 }}
        >
          {data.map((item, index) => {
            const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 5) === 0;
            return (
              <Text
                key={`${item.label}-axis`}
                className="text-surface-600 text-[10px]"
                style={{
                  position: "absolute",
                  left: Math.min(plotWidth - 46, Math.max(0, index * slotWidth - 14)),
                  width: 46,
                }}
              >
                {show ? item.label : ""}
              </Text>
            );
          })}
        </View>
      </View>

      {selectedItem && (
        <View className="bg-surface-700/50 border border-surface-600/40 rounded-xl px-3 py-2">
          <Text className="text-white text-xs font-semibold">
            {selectedItem.label}: {selectedItem.distance.toFixed(1)} km
            {selectedItem.pace ? ` - ${formatPace(selectedItem.pace)}/km` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-surface-700/50">
      <Text className="text-surface-500 text-sm">{label}</Text>
      <Text className={`text-sm font-bold ${valueColor ?? "text-white"}`}>{value}</Text>
    </View>
  );
}

export default function AnalisesScreen() {
  const [period, setPeriod] = useState<Period>("90d");
  const [chartWidth, setChartWidth] = useState(SCREEN_FALLBACK);
  const [maVisible, setMaVisible] = useState({ mm7: true, mm14: false, mm30: false });
  const [tableOpen, setTableOpen] = useState(false);
  const [editingWeight, setEditingWeight] = useState<{ date: string; dateStr: string; weight: string; isNew?: boolean } | null>(null);
  const from = periodToDate(period);
  const now = useMemo(() => new Date(), []);
  const qc = useQueryClient();

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ["daily_logs", period],
    queryFn: () => getDailyLogs(from, now),
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ["run_activities", period],
    queryFn: () => getRunActivities(from, now, 2000),
  });

  const { mutateAsync: saveWeight, isPending: savingWeight } = useMutation({
    mutationFn: (payload: { date: string; weight_kg: number }) => upsertDailyLog(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["daily_logs"] });
      qc.invalidateQueries({ queryKey: ["daily_log", data.date] });
    },
  });

  const userMetrics = useUserMetrics();
  const isLoading = loadingLogs || loadingRuns;

  const weightRows = logs
    .filter((log) => log.weight_kg)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => ({ date: log.date, weight: log.weight_kg! }));

  const weightData = weightRows.map((row) => row.weight);
  const weightLabels = weightRows.map((row) => format(parseISO(row.date), "dd/MM/yy"));
  const latestWeight = weightData[weightData.length - 1];
  const mm7 = movingAverage(weightData, 7);
  const mm14 = movingAverage(weightData, 14);
  const mm30 = movingAverage(weightData, 30);
  const visibleWeightSeries = [
    maVisible.mm7 ? { label: "MM7", color: "#10b981", data: mm7 } : null,
    maVisible.mm14 ? { label: "MM14", color: "#38bdf8", data: mm14 } : null,
    maVisible.mm30 ? { label: "MM30", color: "#a78bfa", data: mm30 } : null,
  ].filter((item): item is { label: string; color: string; data: number[] } => item != null);

  const weightInPeriod = logs
    .filter((log) => log.weight_kg)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => log.weight_kg!);
  const firstWeightInPeriod = weightInPeriod[0];
  const lastWeightInPeriod = weightInPeriod[weightInPeriod.length - 1];
  const weightDelta =
    lastWeightInPeriod && firstWeightInPeriod
      ? lastWeightInPeriod - firstWeightInPeriod
      : 0;

  const tdeeData = logs
    .filter((log) => log.weight_kg)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => ({
      label: format(parseISO(log.date), "dd/MM"),
      value: computeDailyCalculations(log, parseISO(log.date), userMetrics).tdee_kcal,
    }));

  const avgTdee = tdeeData.length
    ? tdeeData.reduce((sum, item) => sum + item.value, 0) / tdeeData.length
    : 0;

  const totalKm = runs.reduce((sum, activity) => sum + activityDistance(activity), 0);
  const totalRunDuration = runs.reduce((sum, activity) => sum + activityDuration(activity), 0);
  const avgPace = totalKm > 0 && totalRunDuration > 0 ? totalRunDuration / totalKm : 0;
  const runDays = new Set(runs.map((activity) => activity.date)).size;
  const avgRunHr = (() => {
    let weighted = 0;
    let duration = 0;
    for (const activity of runs) {
      if (!activity.avg_hr) continue;
      const minutes = activityDuration(activity) || 1;
      weighted += activity.avg_hr * minutes;
      duration += minutes;
    }
    return duration > 0 ? Math.round(weighted / duration) : null;
  })();

  const runDateSet = new Set(runs.map((activity) => activity.date));
  const trainingDays = new Set(
    logs
      .filter((log) => {
        return (
          (log.min_academia ?? 0) + (log.min_boxe ?? 0) + (log.min_surf ?? 0) +
          (log.min_corrida ?? 0) + (log.min_crossfit ?? 0) + (log.min_musculacao ?? 0) +
          (log.min_ciclismo ?? 0) > 0
        );
      })
      .map((log) => log.date)
      .concat(Array.from(runDateSet))
  ).size;

  function toggleMa(key: keyof typeof maVisible) {
    setMaVisible((current) => {
      const selectedCount = Object.values(current).filter(Boolean).length;
      if (current[key] && selectedCount === 1) return current;
      return { ...current, [key]: !current[key] };
    });
  }

  async function handleSaveWeight() {
    if (!editingWeight) return;
    const value = Number(editingWeight.weight.trim().replace(",", "."));
    if (!Number.isFinite(value) || value < 20 || value > 300) {
      Alert.alert("Revise o peso", "Informe um peso entre 20 e 300 kg.");
      return;
    }

    let saveDate = editingWeight.date;
    if (editingWeight.isNew) {
      const parsed = parse(editingWeight.dateStr.trim(), "dd/MM/yyyy", new Date());
      if (!isValid(parsed)) {
        Alert.alert("Data inválida", "Use o formato dd/MM/yyyy.");
        return;
      }
      saveDate = format(parsed, "yyyy-MM-dd");
    }

    try {
      await saveWeight({ date: saveDate, weight_kg: value });
      setEditingWeight(null);
    } catch (err: unknown) {
      Alert.alert("Erro", err instanceof Error ? err.message : "Nao foi possivel salvar o peso.");
    }
  }

  return (
    <>
    <ScrollView
      className="flex-1 bg-surface-900"
      stickyHeaderIndices={[0]}
      contentContainerClassName="px-4 pt-6 pb-10 gap-5"
    >
      <View className="bg-surface-900 pb-4">
        <View className="mb-4">
          <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
            Tendencias
          </Text>
          <Text className="text-white text-3xl font-bold tracking-tight">Analises</Text>
        </View>

        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-1.5 flex-row gap-1">
          {PERIODS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              className={`flex-1 py-2 rounded-xl items-center ${period === key ? "bg-brand-500" : ""}`}
              onPress={() => setPeriod(key)}
            >
              <Text className={`text-sm font-bold ${period === key ? "text-white" : "text-surface-500"}`}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) setChartWidth(w - 32);
        }}
        style={{ height: 0 }}
      />

      {isLoading ? (
        <ActivityIndicator color="#10b981" size="large" className="mt-12" />
      ) : (
        <>
          <Card className="gap-4">
            <SectionLabel label="Peso" />
            {weightData.length > 1 ? (
              <>
                <MultiSparkLine
                  labels={weightLabels}
                  chartWidth={chartWidth}
                  series={visibleWeightSeries}
                />
                <View className="flex-row flex-wrap gap-2">
                  {[
                    { key: "mm7" as const, label: "MM7", color: "#10b981" },
                    { key: "mm14" as const, label: "MM14", color: "#38bdf8" },
                    { key: "mm30" as const, label: "MM30", color: "#a78bfa" },
                  ].map((item) => {
                    const active = maVisible[item.key];
                    return (
                      <TouchableOpacity
                        key={item.key}
                        onPress={() => toggleMa(item.key)}
                        className={`flex-row items-center gap-2 px-3 py-2 rounded-lg border ${
                          active
                            ? "bg-surface-700/70 border-surface-600"
                            : "bg-surface-700/25 border-surface-700/60"
                        }`}
                      >
                        <View
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: active ? item.color : "transparent", borderWidth: 1, borderColor: item.color }}
                        />
                        <Text className={`text-xs font-semibold ${active ? "text-white" : "text-surface-500"}`}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <StatRow
                  label="Atual"
                  value={`${latestWeight?.toFixed(1) ?? "-"} kg`}
                  valueColor="text-brand-400"
                />
                <StatRow
                  label="Medias moveis"
                  value={`MM7 ${mm7.at(-1)?.toFixed(1)} | MM14 ${mm14.at(-1)?.toFixed(1)} | MM30 ${mm30.at(-1)?.toFixed(1)}`}
                />
                <StatRow
                  label={`Variacao (${period})`}
                  value={
                    weightDelta !== 0
                      ? `${weightDelta >= 0 ? "+" : ""}${weightDelta.toFixed(1)} kg`
                      : "Sem dados no periodo"
                  }
                  valueColor={weightDelta <= 0 ? "text-brand-400" : "text-amber-400"}
                />
                <StatRow label="Menor (periodo)" value={`${Math.min(...weightData).toFixed(1)} kg`} />
                <StatRow label="Maior (periodo)" value={`${Math.max(...weightData).toFixed(1)} kg`} />
                <View className="gap-2 pt-2">
                  <View className="flex-row justify-between items-center">
                    <TouchableOpacity
                      onPress={() => setTableOpen((v) => !v)}
                      className="flex-row items-center gap-2"
                    >
                      <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                        Tabela de pesos do periodo
                      </Text>
                      <Ionicons
                        name={tableOpen ? "chevron-up" : "chevron-down"}
                        size={13}
                        color="#72737f"
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const today = format(new Date(), "yyyy-MM-dd");
                        setEditingWeight({
                          date: today,
                          dateStr: format(new Date(), "dd/MM/yyyy"),
                          weight: "",
                          isNew: true,
                        });
                      }}
                      className="flex-row items-center gap-1 bg-brand-500/15 border border-brand-500/30 rounded-lg px-2.5 py-1.5"
                    >
                      <Ionicons name="add" size={13} color="#10b981" />
                      <Text className="text-brand-400 text-xs font-semibold">Peso</Text>
                    </TouchableOpacity>
                  </View>
                  {tableOpen && weightRows.map((row) => (
                    <TouchableOpacity
                      key={row.date}
                      className="flex-row justify-between items-center py-2.5 border-b border-surface-700/40"
                      onPress={() => setEditingWeight({
                        date: row.date,
                        dateStr: format(parseISO(row.date), "dd/MM/yyyy"),
                        weight: row.weight.toFixed(1),
                      })}
                    >
                      <Text className="text-surface-400 text-sm">
                        {format(parseISO(row.date), "dd/MM/yy")}
                      </Text>
                      <Text className="text-white text-sm font-bold">
                        {row.weight.toFixed(1)} kg
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Nenhum peso registrado neste periodo.</Text>
            )}
          </Card>

          <Card className="gap-4">
            <SectionLabel label="Gasto Calorico" />
            {tdeeData.length > 0 ? (
              <>
                <SimpleBarChart data={tdeeData} color="#f97316" chartWidth={chartWidth} />
                <StatRow
                  label="Media diaria"
                  value={`${Math.round(avgTdee).toLocaleString()} kcal`}
                  valueColor="text-orange-400"
                />
                <StatRow label="Dias com atividade" value={`${trainingDays} / ${logs.length} dias`} />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Sem dados de calorias.</Text>
            )}
          </Card>

          <Card className="gap-4">
            <SectionLabel label="Corridas" />
            {runs.length > 0 ? (
              <>
                <RunVolumePaceChart activities={runs} from={from} to={now} period={period} chartWidth={chartWidth} />
                <StatRow label="Km total" value={`${totalKm.toFixed(1)} km`} valueColor="text-sky-400" />
                <StatRow label="Corridas" value={`${runs.length}`} />
                <StatRow label="Pace medio" value={avgPace ? `${formatPace(avgPace)}/km` : "-"} />
                <StatRow label="FC media" value={avgRunHr ? `${avgRunHr} bpm` : "-"} />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Sem corridas neste periodo.</Text>
            )}
          </Card>

          <Card className="gap-4">
            <SectionLabel label="Volume de Treino" />
            {(() => {
              const byActivity = [
                { label: "Academia", key: "min_academia", color: "#a855f7" },
                { label: "Boxe", key: "min_boxe", color: "#ef4444" },
                { label: "Surf", key: "min_surf", color: "#06b6d4" },
                { label: "Ciclismo", key: "min_ciclismo", color: "#10b981" },
                { label: "CrossFit", key: "min_crossfit", color: "#f59e0b" },
                { label: "Musculacao", key: "min_musculacao", color: "#8b5cf6" },
              ]
                .map((activity) => ({
                  ...activity,
                  total: logs.reduce(
                    (sum, log) => sum + ((log[activity.key as keyof typeof log] as number | null) ?? 0),
                    0
                  ),
                }))
                .concat([{ label: "Corrida", key: "run_activities", color: "#3b82f6", total: totalRunDuration }])
                .filter((activity) => activity.total > 0);

              if (byActivity.length === 0) {
                return <Text className="text-surface-500 text-sm">Sem dados de volume.</Text>;
              }

              const maxMin = Math.max(...byActivity.map((activity) => activity.total));
              return byActivity.map((activity) => (
                <View key={activity.key} className="gap-2">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-white text-sm font-semibold">{activity.label}</Text>
                    <Text className="text-surface-500 text-xs font-medium">
                      {formatDuration(activity.total)}
                    </Text>
                  </View>
                  <View className="h-2.5 bg-surface-700 rounded-full overflow-hidden">
                    <View
                      style={{
                        width: `${(activity.total / maxMin) * 100}%`,
                        backgroundColor: activity.color,
                        height: "100%",
                        borderRadius: 4,
                      }}
                    />
                  </View>
                </View>
              ));
            })()}
          </Card>
        </>
      )}
    </ScrollView>
    <BottomSheetModal
      visible={!!editingWeight}
      onClose={() => setEditingWeight(null)}
    >
      <Text className="text-white text-xl font-bold">
        {editingWeight?.isNew ? "Novo peso" : "Editar peso"}
      </Text>
      {editingWeight?.isNew ? (
        <View className="gap-1.5 -mt-1">
          <Text className="text-surface-500 text-xs font-semibold">Data (dd/MM/yyyy)</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={editingWeight.dateStr}
            onChangeText={(v) =>
              setEditingWeight((cur) => cur ? { ...cur, dateStr: v } : cur)
            }
            keyboardType="numbers-and-punctuation"
            placeholder="17/04/2025"
            placeholderTextColor="#4a4b58"
            selectTextOnFocus
          />
        </View>
      ) : (
        <Text className="text-surface-500 text-xs -mt-2">
          {editingWeight ? format(parseISO(editingWeight.date), "dd/MM/yyyy") : ""}
        </Text>
      )}
      <View className="gap-1.5">
        <Text className="text-surface-500 text-xs font-semibold">Peso (kg)</Text>
        <TextInput
          className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
          value={editingWeight?.weight ?? ""}
          onChangeText={(value) =>
            setEditingWeight((current) => current ? { ...current, weight: value } : current)
          }
          keyboardType="decimal-pad"
          placeholder="82.7"
          placeholderTextColor="#4a4b58"
          selectTextOnFocus
        />
      </View>
      <View className="flex-row gap-3">
        <TouchableOpacity
          className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
          onPress={() => setEditingWeight(null)}
        >
          <Text className="text-white font-semibold">Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
          onPress={handleSaveWeight}
          disabled={savingWeight}
        >
          {savingWeight ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold">Salvar</Text>
          )}
        </TouchableOpacity>
      </View>
    </BottomSheetModal>
    </>
  );
}
