import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { getDailyLogs, getRunActivities } from "@/lib/api";
import { computeDailyCalculations, formatDuration, formatPace } from "@/utils/calculations";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { Card, SectionLabel } from "@/components/ui/Card";
import { RunActivity } from "@/types";

const { width } = Dimensions.get("window");
const CHART_WIDTH = width - 64;

type Period = "30d" | "90d" | "6m" | "1y";

const PERIODS: { key: Period; label: string }[] = [
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "6m", label: "6m" },
  { key: "1y", label: "1a" },
];

function periodToDate(period: Period): Date {
  const now = new Date();
  if (period === "30d") return subDays(now, 30);
  if (period === "90d") return subDays(now, 90);
  if (period === "6m") return subMonths(now, 6);
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
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (data.length === 0) return null;

  const max = Math.max(...data.map((item) => item.value), 1);
  const barWidth = Math.max(4, Math.min(28, (CHART_WIDTH - 32) / data.length - 3));
  const selectedItem = selected == null ? null : data[selected];

  return (
    <View className="gap-2">
      <View style={{ height: height + 24, width: CHART_WIDTH }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">
          {Math.round(max).toLocaleString()}
        </Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">0</Text>
        <View className="absolute left-0 right-0 bottom-6 flex-row items-end justify-between" style={{ height }}>
          {data.map((item, index) => (
            <TouchableOpacity
              key={`${item.label}-${index}`}
              onPress={() => setSelected(index)}
              className="items-center justify-end"
              style={{ width: Math.max(barWidth, 8), height }}
            >
              <View
                style={{
                  width: barWidth,
                  height: Math.max(3, (item.value / max) * (height - 16)),
                  backgroundColor: color,
                  borderRadius: 4,
                  opacity: selected === index ? 1 : 0.85,
                }}
              />
            </TouchableOpacity>
          ))}
        </View>
        <View className="absolute left-0 right-0 bottom-0 flex-row justify-between">
          {data.map((item, index) => {
            const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 5) === 0;
            return (
              <Text key={`${item.label}-axis`} className="text-surface-600 text-[10px]" style={{ width: barWidth + 8 }}>
                {show ? item.label : ""}
              </Text>
            );
          })}
        </View>
      </View>
      {selectedItem && (
        <View className="bg-surface-700/50 border border-surface-600/40 rounded-xl px-3 py-2">
          <Text className="text-white text-xs font-semibold">
            {selectedItem.label}: {Math.round(selectedItem.value).toLocaleString()}
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
}: {
  labels: string[];
  series: { label: string; color: string; data: number[] }[];
  height?: number;
}) {
  const allValues = series.flatMap((item) => item.data).filter((value) => Number.isFinite(value));
  if (allValues.length < 2) return null;

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const maxLength = Math.max(...series.map((item) => item.data.length));
  const pointW = maxLength > 1 ? CHART_WIDTH / (maxLength - 1) : CHART_WIDTH;

  return (
    <View className="gap-3">
      <View style={{ height: height + 24, position: "relative", width: CHART_WIDTH }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">{max.toFixed(1)} kg</Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">{min.toFixed(1)} kg</Text>
        <View className="absolute left-0 right-0 bottom-6" style={{ height }}>
          {series.map((line) =>
            line.data.map((value, index) => {
              if (index === 0) return null;
              const previous = line.data[index - 1];
              const x1 = (index - 1) * pointW;
              const x2 = index * pointW;
              const y1 = height - ((previous - min) / range) * height;
              const y2 = height - ((value - min) / range) * height;
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
                    opacity: 0.9,
                  }}
                />
              );
            })
          )}
        </View>
        <View className="absolute left-0 right-0 bottom-0 flex-row justify-between">
          {[0, Math.floor(labels.length / 2), labels.length - 1].map((index) => (
            <Text key={`${labels[index]}-${index}`} className="text-surface-600 text-[10px]">
              {labels[index]}
            </Text>
          ))}
        </View>
      </View>
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
  if (period === "1y") return "month";
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
}: {
  activities: RunActivity[];
  from: Date;
  to: Date;
  period: Period;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const mode = runBucketMode(period);
  const data = useMemo(() => buildRunBuckets(activities, from, to, mode), [activities, from, to, mode]);
  if (data.length === 0) return null;

  const height = 130;
  const maxKm = Math.max(...data.map((item) => item.distance), 1);
  const paces = data.map((item) => item.pace).filter((pace): pace is number => pace != null);
  const minPace = paces.length ? Math.min(...paces) : 0;
  const maxPace = paces.length ? Math.max(...paces) : 1;
  const paceRange = maxPace - minPace || 1;
  const pointW = data.length > 1 ? CHART_WIDTH / (data.length - 1) : CHART_WIDTH;
  const barWidth = Math.max(5, Math.min(28, CHART_WIDTH / data.length - 4));
  const selectedItem = selected == null ? null : data[selected];

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

      <View style={{ height: height + 26, width: CHART_WIDTH }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">{maxKm.toFixed(0)} km</Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">0 km</Text>
        {paces.length > 0 && (
          <>
            <Text className="absolute right-0 top-0 text-surface-600 text-[10px]">{formatPace(minPace)}/km</Text>
            <Text className="absolute right-0 bottom-6 text-surface-600 text-[10px]">{formatPace(maxPace)}/km</Text>
          </>
        )}

        <View className="absolute left-0 right-0 bottom-6 flex-row items-end justify-between" style={{ height }}>
          {data.map((item, index) => (
            <TouchableOpacity
              key={`${item.label}-${index}`}
              onPress={() => setSelected(index)}
              className="items-center justify-end"
              style={{ width: Math.max(barWidth, 8), height }}
            >
              <View
                style={{
                  width: barWidth,
                  height: Math.max(2, (item.distance / maxKm) * (height - 16)),
                  backgroundColor: "#3b82f6",
                  borderRadius: 4,
                  opacity: selected === index ? 1 : 0.82,
                }}
              />
            </TouchableOpacity>
          ))}
        </View>

        <View pointerEvents="none" className="absolute left-0 right-0 bottom-6" style={{ height }}>
          {data.map((item, index) => {
            if (index === 0 || item.pace == null || data[index - 1].pace == null) return null;
            const previous = data[index - 1].pace!;
            const x1 = (index - 1) * pointW;
            const x2 = index * pointW;
            const y1 = ((previous - minPace) / paceRange) * (height - 16) + 8;
            const y2 = ((item.pace - minPace) / paceRange) * (height - 16) + 8;
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

        <View className="absolute left-0 right-0 bottom-0 flex-row justify-between">
          {data.map((item, index) => {
            const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 5) === 0;
            return (
              <Text key={`${item.label}-axis`} className="text-surface-600 text-[10px]" style={{ width: barWidth + 8 }}>
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
  const from = periodToDate(period);
  const now = useMemo(() => new Date(), []);

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ["daily_logs", period],
    queryFn: () => getDailyLogs(from, now),
  });

  const weightFrom = useMemo(() => subMonths(now, 60), [now]);
  const { data: weightLogs = [], isLoading: loadingWeight } = useQuery({
    queryKey: ["daily_logs_weight_5y"],
    queryFn: () => getDailyLogs(weightFrom, now),
    staleTime: 5 * 60 * 1000,
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ["run_activities", period],
    queryFn: () => getRunActivities(from, now, 2000),
  });

  const userMetrics = useUserMetrics();
  const isLoading = loadingLogs || loadingRuns || loadingWeight;

  const weightRows = weightLogs
    .filter((log) => log.weight_kg)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((log) => ({ date: log.date, weight: log.weight_kg! }));

  const weightData = weightRows.map((row) => row.weight);
  const weightLabels = weightRows.map((row) => format(parseISO(row.date), "dd/MM/yy"));
  const latestWeight = weightData[weightData.length - 1];
  const mm7 = movingAverage(weightData, 7);
  const mm14 = movingAverage(weightData, 14);
  const mm30 = movingAverage(weightData, 30);

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

  return (
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-14 pb-10 gap-5"
    >
      <View>
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
                  series={[
                    { label: "MM7", color: "#10b981", data: mm7 },
                    { label: "MM14", color: "#38bdf8", data: mm14 },
                    { label: "MM30", color: "#a78bfa", data: mm30 },
                  ]}
                />
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
                <StatRow label="Menor (historico)" value={`${Math.min(...weightData).toFixed(1)} kg`} />
                <StatRow label="Maior (historico)" value={`${Math.max(...weightData).toFixed(1)} kg`} />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Nenhum peso registrado no historico.</Text>
            )}
          </Card>

          <Card className="gap-4">
            <SectionLabel label="Gasto Calorico" />
            {tdeeData.length > 0 ? (
              <>
                <SimpleBarChart data={tdeeData} color="#f97316" />
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
                <RunVolumePaceChart activities={runs} from={from} to={now} period={period} />
                <StatRow label="Km total" value={`${totalKm.toFixed(1)} km`} valueColor="text-sky-400" />
                <StatRow label="Corridas" value={`${runs.length}`} />
                <StatRow label="Dias corridos" value={`${runDays}`} />
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
  );
}
