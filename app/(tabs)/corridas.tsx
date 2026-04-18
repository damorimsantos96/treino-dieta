import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Dimensions,
} from "react-native";
import {
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createRunActivityWithIntervals,
  deleteRunActivity,
  getRunActivities,
  syncRunSessionsToDaily,
} from "@/lib/api";
import { IntervalType, RunActivity, RunSession } from "@/types";
import { formatPace, formatDuration } from "@/utils/calculations";
import { Ionicons } from "@expo/vector-icons";

const { width } = Dimensions.get("window");
const CHART_WIDTH = width - 64;

type PeriodKey = "7d" | "30d" | "90d" | "180d" | "360d";
type BucketMode = "week" | "month" | "quarter" | "year";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "180d", label: "180d" },
  { key: "360d", label: "360d" },
];

const BUCKETS: { key: BucketMode; label: string }[] = [
  { key: "week", label: "Sem." },
  { key: "month", label: "Mes" },
  { key: "quarter", label: "Trim." },
  { key: "year", label: "Ano" },
];

function periodFrom(key: PeriodKey): Date {
  const now = new Date();
  if (key === "7d") return subDays(now, 7);
  if (key === "30d") return subDays(now, 30);
  if (key === "90d") return subDays(now, 90);
  if (key === "180d") return subDays(now, 180);
  return subDays(now, 360);
}

const INTERVAL_TYPES: IntervalType[] = [
  "Easy", "Tempo", "Threshold", "Intervals", "VO2max", "Long Run", "Race", "Outro",
];

function isIntervalType(value: string): value is IntervalType {
  return INTERVAL_TYPES.includes(value as IntervalType);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(parseISO(value).getTime());
}

function parseOptionalNumber(
  value: string | undefined,
  label: string,
  errors: string[],
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) {
    errors.push(`${label}: informe um numero valido.`);
    return undefined;
  }
  if (options.integer && !Number.isInteger(n)) {
    errors.push(`${label}: informe um numero inteiro.`);
  }
  if (options.min != null && n < options.min) {
    errors.push(`${label}: minimo ${options.min}.`);
  }
  if (options.max != null && n > options.max) {
    errors.push(`${label}: maximo ${options.max}.`);
  }
  return n;
}

const INTERVAL_COLORS: Record<IntervalType, { bg: string; text: string; border: string }> = {
  Easy:       { bg: "rgba(34,197,94,0.12)",   text: "#22c55e", border: "rgba(34,197,94,0.25)"  },
  Tempo:      { bg: "rgba(234,179,8,0.12)",   text: "#eab308", border: "rgba(234,179,8,0.25)"  },
  Threshold:  { bg: "rgba(249,115,22,0.12)",  text: "#f97316", border: "rgba(249,115,22,0.25)" },
  Intervals:  { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", border: "rgba(239,68,68,0.25)"  },
  VO2max:     { bg: "rgba(168,85,247,0.12)",  text: "#a855f7", border: "rgba(168,85,247,0.25)" },
  "Long Run": { bg: "rgba(59,130,246,0.12)",  text: "#3b82f6", border: "rgba(59,130,246,0.25)" },
  Race:       { bg: "rgba(236,72,153,0.12)",  text: "#ec4899", border: "rgba(236,72,153,0.25)" },
  Outro:      { bg: "rgba(113,113,127,0.12)", text: "#71717f", border: "rgba(113,113,127,0.25)"},
};

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

function averageHr(activities: RunActivity[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const activity of activities) {
    if (!activity.avg_hr) continue;
    const duration = activityDuration(activity) || 1;
    weighted += activity.avg_hr * duration;
    weight += duration;
  }
  return weight > 0 ? Math.round(weighted / weight) : null;
}

function IntervalRow({ interval }: { interval: RunSession }) {
  const type = (interval.interval_type as IntervalType) ?? "Outro";
  const color = INTERVAL_COLORS[type] ?? INTERVAL_COLORS.Outro;
  const pace = interval.pace_min_km && interval.pace_min_km > 1
    ? formatPace(interval.pace_min_km)
    : null;
  const duration = interval.duration_min && interval.duration_min > 0
    ? formatDuration(interval.duration_min)
    : null;

  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-surface-700/30">
      <View className="flex-row items-center gap-2 flex-1">
        <View
          className="px-2 py-0.5 rounded-md border"
          style={{ backgroundColor: color.bg, borderColor: color.border }}
        >
          <Text className="text-xs font-bold" style={{ color: color.text }}>
            {interval.interval_index ?? "-"}
          </Text>
        </View>
        <View className="flex-row gap-3 flex-wrap">
          {duration && <Text className="text-surface-500 text-xs">{duration}</Text>}
          {pace && <Text className="text-surface-500 text-xs">{pace}/km</Text>}
          {interval.avg_hr && (
            <Text className="text-surface-500 text-xs">{interval.avg_hr} bpm</Text>
          )}
        </View>
      </View>
      <Text className="text-white text-sm font-bold ml-2">
        {interval.distance_km?.toFixed(2) ?? "-"} km
      </Text>
    </View>
  );
}

function ActivityBlock({
  activity,
  onDelete,
}: {
  activity: RunActivity;
  onDelete: (id: string, date: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const km = activityDistance(activity);
  const duration = activityDuration(activity);
  const pace = km > 0 && duration > 0 ? duration / km : activity.avg_pace_min_km;
  const intervals = activity.intervals ?? [];

  return (
    <TouchableOpacity
      onPress={() => setExpanded((v) => !v)}
      onLongPress={() =>
        Alert.alert("Excluir corrida?", "Remove a sessao e seus intervalos.", [
          { text: "Cancelar", style: "cancel" },
          { text: "Excluir", style: "destructive", onPress: () => onDelete(activity.id, activity.date) },
        ])
      }
      className="border-t border-surface-700/40 pt-3 mt-3"
      activeOpacity={0.75}
    >
      <View className="flex-row justify-between items-start gap-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Ionicons
              name={expanded ? "chevron-down" : "chevron-forward"}
              size={14}
              color="#72737f"
            />
            <Text className="text-white text-sm font-bold">
              {activity.name ?? "Corrida"}
            </Text>
            <View className="bg-surface-700/60 rounded-md px-1.5 py-0.5">
              <Text className="text-surface-500 text-xs">{intervals.length || 1} int.</Text>
            </View>
          </View>
          <View className="flex-row gap-4 mt-2 flex-wrap">
            {duration > 0 && <Text className="text-surface-500 text-xs">{formatDuration(duration)}</Text>}
            {pace && <Text className="text-surface-500 text-xs">{formatPace(pace)}/km</Text>}
            {activity.avg_hr && <Text className="text-surface-500 text-xs">{activity.avg_hr} bpm</Text>}
            {activity.calories_kcal && (
              <Text className="text-surface-500 text-xs">{Math.round(activity.calories_kcal)} kcal</Text>
            )}
          </View>
        </View>
        <Text className="text-white text-base font-bold">{km.toFixed(2)} km</Text>
      </View>

      {expanded && intervals.length > 0 && (
        <View className="mt-2">
          {intervals.map((interval) => (
            <IntervalRow key={interval.id} interval={interval} />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

function DayCard({
  date,
  activities,
  onDelete,
}: {
  date: string;
  activities: RunActivity[];
  onDelete: (id: string, date: string) => void;
}) {
  const totalKm = activities.reduce((sum, item) => sum + activityDistance(item), 0);
  const totalDuration = activities.reduce((sum, item) => sum + activityDuration(item), 0);
  const totalKcal = activities.reduce((sum, item) => sum + (item.calories_kcal ?? 0), 0);
  const avgHr = averageHr(activities);
  const dateLabel = format(parseISO(date), "d 'de' MMM", { locale: ptBR });

  return (
    <View className="bg-surface-800 border border-surface-700/60 rounded-2xl px-4 py-3.5 mb-2.5">
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center gap-2">
          <Text className="text-surface-400 text-sm font-medium">{dateLabel}</Text>
          <View className="bg-surface-700/60 rounded-md px-1.5 py-0.5">
            <Text className="text-surface-500 text-xs">
              {activities.length} {activities.length === 1 ? "corrida" : "corridas"}
            </Text>
          </View>
        </View>
        <Text className="text-white text-base font-bold">{totalKm.toFixed(2)} km</Text>
      </View>

      <View className="flex-row gap-4 mt-2 flex-wrap">
        {totalDuration > 0 && <Text className="text-surface-500 text-xs">{formatDuration(totalDuration)}</Text>}
        {avgHr && <Text className="text-surface-500 text-xs">{avgHr} bpm</Text>}
        {totalKcal > 0 && <Text className="text-surface-500 text-xs">{Math.round(totalKcal)} kcal</Text>}
      </View>

      {activities.map((activity) => (
        <ActivityBlock key={activity.id} activity={activity} onDelete={onDelete} />
      ))}
    </View>
  );
}

function SummaryBar({ activities }: { activities: RunActivity[] }) {
  const totalKm = activities.reduce((sum, item) => sum + activityDistance(item), 0);
  const totalDuration = activities.reduce((sum, item) => sum + activityDuration(item), 0);
  const avgPace = totalKm > 0 && totalDuration > 0 ? totalDuration / totalKm : 0;
  const avgHr = averageHr(activities);

  const stats = [
    { label: "km total", value: totalKm.toFixed(1), color: "text-brand-400" },
    { label: "corridas", value: activities.length.toString(), color: "text-sky-400" },
    { label: "pace medio", value: avgPace ? formatPace(avgPace) : "-", color: "text-amber-400" },
    { label: "FC media", value: avgHr ? `${avgHr}` : "-", color: "text-rose-400" },
  ];

  return (
    <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 flex-row mb-4">
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          className={`flex-1 items-center ${index < stats.length - 1 ? "border-r border-surface-700/50" : ""}`}
        >
          <Text className={`text-xl font-bold ${stat.color}`}>{stat.value}</Text>
          <Text className="text-surface-500 text-xs mt-0.5">{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

function bucketBounds(date: Date, mode: BucketMode) {
  if (mode === "week") return { start: startOfWeek(date, { weekStartsOn: 1 }), end: endOfWeek(date, { weekStartsOn: 1 }) };
  if (mode === "month") return { start: startOfMonth(date), end: endOfMonth(date) };
  if (mode === "quarter") return { start: startOfQuarter(date), end: endOfQuarter(date) };
  return { start: startOfYear(date), end: endOfYear(date) };
}

function advanceBucket(date: Date, mode: BucketMode) {
  if (mode === "week") return addWeeks(date, 1);
  if (mode === "month") return addMonths(date, 1);
  if (mode === "quarter") return addQuarters(date, 1);
  return addYears(date, 1);
}

function buildRunBuckets(activities: RunActivity[], from: Date, to: Date, mode: BucketMode) {
  const buckets: { label: string; distance: number; pace: number | null }[] = [];
  let cursor = bucketBounds(from, mode).start;

  while (cursor <= to) {
    const { start, end } = bucketBounds(cursor, mode);
    const bucketActivities = activities.filter((activity) => {
      const date = parseISO(activity.date);
      return date >= start && date <= end;
    });
    const distance = bucketActivities.reduce((sum, item) => sum + activityDistance(item), 0);
    const duration = bucketActivities.reduce((sum, item) => sum + activityDuration(item), 0);
    const pace = distance > 0 && duration > 0 ? duration / distance : null;

    buckets.push({
      label:
        mode === "week" ? format(start, "dd/MM") :
        mode === "month" ? format(start, "MM/yy") :
        mode === "quarter" ? `T${Math.floor(start.getMonth() / 3) + 1}/${format(start, "yy")}` :
        format(start, "yyyy"),
      distance,
      pace,
    });

    cursor = advanceBucket(cursor, mode);
  }

  return buckets;
}

function VolumePaceChart({
  activities,
  from,
  to,
  mode,
}: {
  activities: RunActivity[];
  from: Date;
  to: Date;
  mode: BucketMode;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const data = useMemo(() => buildRunBuckets(activities, from, to, mode), [activities, from, to, mode]);
  if (data.length === 0) return null;

  const height = 140;
  const maxKm = Math.max(...data.map((item) => item.distance), 1);
  const paces = data.map((item) => item.pace).filter((pace): pace is number => pace != null);
  const minPace = paces.length ? Math.min(...paces) : 0;
  const maxPace = paces.length ? Math.max(...paces) : 1;
  const paceRange = maxPace - minPace || 1;
  const pointW = data.length > 1 ? CHART_WIDTH / (data.length - 1) : CHART_WIDTH;
  const barWidth = Math.max(8, Math.min(34, CHART_WIDTH / data.length - 4));
  const selectedItem = selected == null ? null : data[selected];

  return (
    <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 mb-4 gap-3">
      <View className="flex-row justify-between items-center">
        <Text className="text-surface-400 text-xs font-bold uppercase tracking-widest">
          Volume e ritmo
        </Text>
        <View className="flex-row gap-3">
          <View className="flex-row items-center gap-1">
            <View className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
            <Text className="text-surface-500 text-xs">Distancia</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <View className="w-2.5 h-0.5 bg-red-400" />
            <Text className="text-surface-500 text-xs">Ritmo</Text>
          </View>
        </View>
      </View>

      <View style={{ width: CHART_WIDTH, height: height + 26 }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">
          {maxKm.toFixed(0)} km
        </Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">0 km</Text>
        {paces.length > 0 && (
          <>
            <Text className="absolute right-0 top-0 text-surface-600 text-[10px]">
              {formatPace(minPace)}/km
            </Text>
            <Text className="absolute right-0 bottom-6 text-surface-600 text-[10px]">
              {formatPace(maxPace)}/km
            </Text>
          </>
        )}

        <View className="absolute left-0 right-0 bottom-6 flex-row items-end justify-between" style={{ height }}>
          {data.map((item, index) => (
            <TouchableOpacity
              key={`${item.label}-${index}`}
              onPress={() => setSelected(index)}
              className="items-center justify-end"
              style={{ width: Math.max(barWidth, 10), height }}
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
            const prev = data[index - 1].pace!;
            const x1 = (index - 1) * pointW;
            const x2 = index * pointW;
            const y1 = ((prev - minPace) / paceRange) * (height - 16) + 8;
            const y2 = ((item.pace - minPace) / paceRange) * (height - 16) + 8;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            return (
              <View
                key={`line-${index}`}
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

export default function CorridasScreen() {
  const [period, setPeriod] = useState<PeriodKey>("90d");
  const [bucketMode, setBucketMode] = useState<BucketMode>("week");
  const from = useMemo(() => periodFrom(period), [period]);
  const to = useMemo(() => new Date(), []);
  const qc = useQueryClient();

  const { data: activities = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["run_activities", period],
    queryFn: () => getRunActivities(from, new Date(), 1000),
  });

  const { mutateAsync: save, isPending: saving } = useMutation({
    mutationFn: (payload: Parameters<typeof createRunActivityWithIntervals>) =>
      createRunActivityWithIntervals(payload[0], payload[1]),
  });
  const { mutateAsync: remove } = useMutation({ mutationFn: deleteRunActivity });

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    date: format(new Date(), "yyyy-MM-dd"),
    interval_type: "Easy",
  });

  function setF(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleDelete(id: string, date: string) {
    try {
      await remove(id);
      await syncRunSessionsToDaily(date);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["run_activities"] }),
        qc.invalidateQueries({ queryKey: ["run_sessions"] }),
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
    } catch (err: unknown) {
      Alert.alert("Erro", err instanceof Error ? err.message : "Nao foi possivel excluir.");
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, RunActivity[]> = {};
    for (const activity of activities) {
      if (!map[activity.date]) map[activity.date] = [];
      map[activity.date].push(activity);
    }
    return map;
  }, [activities]);

  const sortedDates = useMemo(
    () => Object.keys(grouped).sort((a, b) => b.localeCompare(a)),
    [grouped]
  );

  async function handleSave() {
    const errors: string[] = [];
    const date = form.date.trim();
    if (!isIsoDate(date)) errors.push("Data: use o formato YYYY-MM-DD.");

    const intervalType = isIntervalType(form.interval_type) ? form.interval_type : "Easy";
    const distance = parseOptionalNumber(form.distance, "Distancia", errors, { min: 0, max: 500 });
    const duration = parseOptionalNumber(form.duration, "Duracao", errors, { min: 0, max: 1440 });
    const pace = parseOptionalNumber(form.pace, "Pace", errors, { min: 1, max: 30 });
    const avgHr = parseOptionalNumber(form.avg_hr, "FC media", errors, { min: 30, max: 240, integer: true });
    const maxHr = parseOptionalNumber(form.max_hr, "FC max", errors, { min: 30, max: 240, integer: true });
    const temp = parseOptionalNumber(form.temp, "Temp", errors, { min: -30, max: 70 });
    const kcal = parseOptionalNumber(form.kcal, "kcal", errors, { min: 0, max: 10000 });

    if (errors.length > 0) {
      Alert.alert("Revise os dados", errors.join("\n"));
      return;
    }

    const finalPace = pace ?? (distance && duration ? duration / distance : undefined);

    try {
      await save([
        {
          date,
          source: "manual",
          name: form.name?.trim() || "Corrida manual",
          distance_km: distance,
          duration_min: duration,
          avg_pace_min_km: finalPace,
          avg_hr: avgHr,
          max_hr: maxHr,
          thermal_sensation_c: temp,
          calories_kcal: kcal,
          notes: form.notes || null,
        },
        [
          {
            date,
            interval_type: intervalType,
            interval_index: 1,
            distance_km: distance,
            duration_min: duration,
            pace_min_km: finalPace,
            avg_hr: avgHr,
            max_hr: maxHr,
            thermal_sensation_c: temp,
            calories_kcal: null,
            notes: form.notes || null,
          },
        ],
      ]);
      await syncRunSessionsToDaily(date);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["run_activities"] }),
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
      setShowModal(false);
      setForm({ date: format(new Date(), "yyyy-MM-dd"), interval_type: "Easy" });
    } catch (err: unknown) {
      Alert.alert("Erro", err instanceof Error ? err.message : "Tente novamente.");
    }
  }

  return (
    <View className="flex-1 bg-surface-900">
      <ScrollView
        contentContainerClassName="px-4 pt-14 pb-8"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#10b981" />}
      >
        <View className="flex-row justify-between items-center mb-4">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
              Corridas
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">Historico</Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-4 py-2.5 border border-brand-600"
            onPress={() => setShowModal(true)}
            style={{ shadowColor: "#10b981", shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 }}
          >
            <Text className="text-white font-bold text-sm">+ Corrida</Text>
          </TouchableOpacity>
        </View>

        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-1.5 flex-row gap-1 mb-3">
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

        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-1.5 flex-row gap-1 mb-4">
          {BUCKETS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              className={`flex-1 py-2 rounded-xl items-center ${bucketMode === key ? "bg-surface-700" : ""}`}
              onPress={() => setBucketMode(key)}
            >
              <Text className={`text-xs font-bold ${bucketMode === key ? "text-white" : "text-surface-500"}`}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator color="#10b981" size="large" className="mt-12" />
        ) : (
          <>
            {activities.length > 0 && <SummaryBar activities={activities} />}
            {activities.length > 0 && (
              <VolumePaceChart activities={activities} from={from} to={to} mode={bucketMode} />
            )}
            {sortedDates.map((date) => (
              <DayCard key={date} date={date} activities={grouped[date]} onDelete={handleDelete} />
            ))}
            {activities.length === 0 && (
              <View className="items-center py-16 gap-3">
                <Text className="text-4xl">🏃</Text>
                <Text className="text-white font-semibold">Nenhuma corrida neste periodo</Text>
                <Text className="text-surface-500 text-sm">Toque em + Corrida para adicionar</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 border border-surface-700/60 rounded-t-3xl px-5 pt-6 pb-10 gap-4">
              <View className="w-10 h-1 bg-surface-600 rounded-full self-center mb-2" />
              <Text className="text-white text-xl font-bold">Nova corrida</Text>
              <Text className="text-surface-500 text-xs -mt-2">
                Kcal e temperatura ficam na sessao; intervalos guardam distancia, ritmo e FC.
              </Text>

              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Data (YYYY-MM-DD)</Text>
                <TextInput
                  className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
                  value={form.date}
                  onChangeText={(value) => setF("date", value)}
                  placeholderTextColor="#4a4b58"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Nome</Text>
                <TextInput
                  className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
                  value={form.name ?? ""}
                  onChangeText={(value) => setF("name", value)}
                  placeholder="Corrida manual"
                  placeholderTextColor="#4a4b58"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Tipo do intervalo principal</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {INTERVAL_TYPES.map((type) => {
                      const color = INTERVAL_COLORS[type];
                      const active = form.interval_type === type;
                      return (
                        <TouchableOpacity
                          key={type}
                          onPress={() => setF("interval_type", type)}
                          className="px-3 py-1.5 rounded-lg border"
                          style={{
                            backgroundColor: active ? color.bg : "rgba(44,45,54,0.5)",
                            borderColor: active ? color.border : "#2c2d36",
                          }}
                        >
                          <Text className="text-xs font-bold" style={{ color: active ? color.text : "#72737f" }}>
                            {type}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              <View className="flex-row gap-3">
                {[
                  { key: "distance", label: "Distancia", unit: "km" },
                  { key: "duration", label: "Duracao", unit: "min" },
                  { key: "pace", label: "Pace", unit: "min/km" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
                    <TextInput
                      className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(value) => setF(key, value)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#4a4b58"
                    />
                    <Text className="text-surface-600 text-xs">{unit}</Text>
                  </View>
                ))}
              </View>

              <View className="flex-row gap-3">
                {[
                  { key: "avg_hr", label: "FC media", unit: "bpm" },
                  { key: "max_hr", label: "FC max", unit: "bpm" },
                  { key: "temp", label: "Temp", unit: "C" },
                  { key: "kcal", label: "kcal", unit: "" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
                    <TextInput
                      className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(value) => setF(key, value)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#4a4b58"
                    />
                    {unit ? <Text className="text-surface-600 text-xs">{unit}</Text> : null}
                  </View>
                ))}
              </View>

              <View className="flex-row gap-3 mt-1">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
                  onPress={() => setShowModal(false)}
                >
                  <Text className="text-white font-semibold">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold">Salvar</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
