import { useMemo, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ionicons } from "@expo/vector-icons";
import { DailyLog, IntervalType, RunActivity, RunSession } from "@/types";
import { formatDuration, formatPace } from "@/utils/calculations";

const INTERVAL_COLORS: Record<IntervalType, { bg: string; text: string; border: string }> = {
  Easy: { bg: "rgba(34,197,94,0.12)", text: "#22c55e", border: "rgba(34,197,94,0.25)" },
  Tempo: { bg: "rgba(234,179,8,0.12)", text: "#eab308", border: "rgba(234,179,8,0.25)" },
  Threshold: { bg: "rgba(249,115,22,0.12)", text: "#f97316", border: "rgba(249,115,22,0.25)" },
  Intervals: { bg: "rgba(239,68,68,0.12)", text: "#ef4444", border: "rgba(239,68,68,0.25)" },
  VO2max: { bg: "rgba(168,85,247,0.12)", text: "#a855f7", border: "rgba(168,85,247,0.25)" },
  "Long Run": { bg: "rgba(59,130,246,0.12)", text: "#3b82f6", border: "rgba(59,130,246,0.25)" },
  Race: { bg: "rgba(236,72,153,0.12)", text: "#ec4899", border: "rgba(236,72,153,0.25)" },
  Outro: { bg: "rgba(113,113,127,0.12)", text: "#71717f", border: "rgba(113,113,127,0.25)" },
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

function averageThermalSensation(activities: RunActivity[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const activity of activities) {
    if (activity.thermal_sensation_c == null) continue;
    const duration = activityDuration(activity) || 1;
    weighted += activity.thermal_sensation_c * duration;
    weight += duration;
  }
  return weight > 0 ? Math.round((weighted / weight) * 10) / 10 : null;
}

function formatTemperature(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(1).replace(".", ",");
  return `${text}°C`;
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
    <View className="flex-row items-center justify-between border-b border-surface-700/30 py-2.5">
      <View className="flex-1 flex-row items-center gap-2">
        <View
          className="rounded-md border px-2 py-0.5"
          style={{ backgroundColor: color.bg, borderColor: color.border }}
        >
          <Text className="text-xs font-bold" style={{ color: color.text }}>
            {interval.interval_index ?? "-"}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-3">
          {duration && <Text className="text-xs text-surface-500">{duration}</Text>}
          {pace && <Text className="text-xs text-surface-500">{pace}/km</Text>}
          {interval.avg_hr && <Text className="text-xs text-surface-500">{interval.avg_hr} bpm</Text>}
        </View>
      </View>
      <Text className="ml-2 text-sm font-bold text-white">
        {interval.distance_km?.toFixed(2) ?? "-"} km
      </Text>
    </View>
  );
}

function DayCard({
  date,
  activities,
  dayLog,
  onDelete,
}: {
  date: string;
  activities: RunActivity[];
  dayLog?: DailyLog | null;
  onDelete: (id: string, date: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalKm = activities.reduce((sum, item) => sum + activityDistance(item), 0);
  const totalDuration = activities.reduce((sum, item) => sum + activityDuration(item), 0);
  const totalKcalFromActivities = activities.reduce((sum, item) => sum + (item.calories_kcal ?? 0), 0);
  const totalKcal = totalKcalFromActivities > 0 ? totalKcalFromActivities : (dayLog?.kcal_corrida ?? 0);
  const avgHr = averageHr(activities);
  const avgThermal = averageThermalSensation(activities);
  const avgPace = totalKm > 0 && totalDuration > 0 ? totalDuration / totalKm : null;
  const totalIntervals = activities.reduce((sum, item) => sum + (item.intervals?.length ?? 0), 0);
  const dateLabel = format(parseISO(date), "d 'de' MMM", { locale: ptBR });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      className="mb-2.5 rounded-2xl border border-surface-700/60 bg-surface-800 px-4 py-3.5"
      onPress={() => setExpanded((value) => !value)}
      onLongPress={() => {
        if (activities.length === 1) {
          Alert.alert("Excluir corrida?", "Remove a sessao e seus intervalos.", [
            { text: "Cancelar", style: "cancel" },
            { text: "Excluir", style: "destructive", onPress: () => onDelete(activities[0].id, date) },
          ]);
        }
      }}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={14}
          color="#72737f"
        />
        <Text className="text-sm font-medium text-surface-400">{dateLabel}</Text>
        <View className="rounded-md bg-surface-700/60 px-1.5 py-0.5">
          <Text className="text-xs text-surface-500">
            {activities.length} {activities.length === 1 ? "corrida" : "corridas"}
          </Text>
        </View>
        {totalIntervals > 0 && (
          <View className="rounded-md bg-surface-700/60 px-1.5 py-0.5">
            <Text className="text-xs text-surface-500">{totalIntervals} int.</Text>
          </View>
        )}
        <Text className="ml-auto text-base font-bold text-white">{totalKm.toFixed(2)} km</Text>
      </View>

      <View className="mt-2 flex-row flex-wrap gap-4">
        {totalDuration > 0 && <Text className="text-xs text-surface-500">{formatDuration(totalDuration)}</Text>}
        {avgPace && <Text className="text-xs text-surface-500">{formatPace(avgPace)}/km</Text>}
        {avgHr && <Text className="text-xs text-surface-500">{avgHr} bpm</Text>}
        {avgThermal != null && <Text className="text-xs text-surface-500">{formatTemperature(avgThermal)}</Text>}
        {totalKcal > 0 && <Text className="text-xs text-surface-500">{Math.round(totalKcal)} kcal</Text>}
      </View>

      {expanded && (
        <View className="mt-3 border-t border-surface-700/40 pt-1">
          {activities.length > 1 &&
            activities.map((activity) => (
              <View key={activity.id} className="mt-2">
                <Text className="mb-1 text-xs font-semibold text-surface-400">{activity.name ?? "Corrida"}</Text>
                {(activity.intervals ?? []).map((interval) => (
                  <IntervalRow key={interval.id} interval={interval} />
                ))}
              </View>
            ))}
          {activities.length === 1 &&
            (activities[0].intervals ?? []).map((interval) => (
              <IntervalRow key={interval.id} interval={interval} />
            ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

type RunHistorySectionProps = {
  activities: RunActivity[];
  logsByDate: Record<string, DailyLog | null | undefined>;
  open: boolean;
  onToggle: () => void;
  onDelete: (id: string, date: string) => void;
};

export function RunHistorySection({
  activities,
  logsByDate,
  open,
  onToggle,
  onDelete,
}: RunHistorySectionProps) {
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

  return (
    <View className="gap-3 pt-2">
      <TouchableOpacity
        onPress={onToggle}
        className="flex-row items-center justify-between rounded-2xl border border-surface-700/50 bg-surface-900/50 px-4 py-3"
      >
        <View className="flex-1 gap-1 pr-4">
          <Text className="text-sm font-bold text-white">Historico de corridas</Text>
          <Text className="text-xs text-surface-500">
            {activities.length > 0
              ? `${activities.length} ${activities.length === 1 ? "corrida" : "corridas"} no periodo`
              : "Nenhuma corrida neste periodo."}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color="#a1a1aa"
        />
      </TouchableOpacity>

      {open && (
        <View>
          {sortedDates.length > 0 ? (
            sortedDates.map((date) => (
              <DayCard
                key={date}
                date={date}
                activities={grouped[date]}
                dayLog={logsByDate[date]}
                onDelete={onDelete}
              />
            ))
          ) : (
            <Text className="text-sm text-surface-500">Sem corridas neste periodo.</Text>
          )}
        </View>
      )}
    </View>
  );
}
