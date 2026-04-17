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
} from "react-native";
import { format, parseISO, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRunSessions, upsertRunSession, deleteRunSession, syncRunSessionsToDaily } from "@/lib/api";
import { RunSession, IntervalType } from "@/types";
import { formatPace, formatDuration } from "@/utils/calculations";
import { Ionicons } from "@expo/vector-icons";

type PeriodKey = "7d" | "30d" | "3m" | "6m" | "12m";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "3m", label: "3m" },
  { key: "6m", label: "6m" },
  { key: "12m", label: "12m" },
];

function periodFrom(key: PeriodKey): Date {
  const now = new Date();
  if (key === "7d") return subDays(now, 7);
  if (key === "30d") return subDays(now, 30);
  if (key === "3m") return subMonths(now, 3);
  if (key === "6m") return subMonths(now, 6);
  return subMonths(now, 12);
}

const INTERVAL_TYPES: IntervalType[] = [
  "Easy", "Tempo", "Threshold", "Intervals", "VO2max", "Long Run", "Race", "Outro",
];

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

function IntervalRow({ session, onDelete }: { session: RunSession; onDelete: () => void }) {
  const color = INTERVAL_COLORS[session.interval_type as IntervalType] ?? INTERVAL_COLORS.Outro;
  const pace = session.pace_min_km && session.pace_min_km > 1 ? formatPace(session.pace_min_km) : null;
  const duration = session.duration_min && session.duration_min > 0
    ? formatDuration(session.duration_min)
    : null;

  return (
    <TouchableOpacity
      onLongPress={() =>
        Alert.alert("Excluir intervalo?", "Esta ação não pode ser desfeita.", [
          { text: "Cancelar", style: "cancel" },
          { text: "Excluir", style: "destructive", onPress: onDelete },
        ])
      }
      className="flex-row items-center justify-between py-2.5 border-b border-surface-700/30"
    >
      <View className="flex-row items-center gap-2 flex-1">
        <View
          className="px-2 py-0.5 rounded-md border"
          style={{ backgroundColor: color.bg, borderColor: color.border }}
        >
          <Text className="text-xs font-bold" style={{ color: color.text }}>
            {session.interval_type}
          </Text>
        </View>
        <View className="flex-row gap-3">
          {duration && (
            <Text className="text-surface-500 text-xs">⏱ {duration}</Text>
          )}
          {pace && (
            <Text className="text-surface-500 text-xs">🏃 {pace}/km</Text>
          )}
          {session.avg_hr && (
            <Text className="text-surface-500 text-xs">❤️ {session.avg_hr} bpm</Text>
          )}
        </View>
      </View>
      <Text className="text-white text-sm font-bold ml-2">
        {session.distance_km?.toFixed(2) ?? "—"} km
      </Text>
    </TouchableOpacity>
  );
}

function DayCard({
  date,
  sessions,
  onDelete,
}: {
  date: string;
  sessions: RunSession[];
  onDelete: (id: string, date: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const totalKm = sessions.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const totalDuration = sessions.reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const validHr = sessions.filter((r) => r.avg_hr);
  const avgHr = validHr.length
    ? Math.round(validHr.reduce((s, r) => s + r.avg_hr!, 0) / validHr.length)
    : null;
  const totalKcal = sessions.reduce((s, r) => s + (r.calories_kcal ?? 0), 0);

  const parsed = parseISO(date);
  const dateLabel = format(parsed, "d 'de' MMM", { locale: ptBR });

  return (
    <TouchableOpacity
      onPress={() => setExpanded((v) => !v)}
      className="bg-surface-800 border border-surface-700/60 rounded-2xl px-4 py-3.5 mb-2.5"
      activeOpacity={0.75}
    >
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center gap-2">
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={14}
            color="#72737f"
          />
          <Text className="text-surface-400 text-sm font-medium">{dateLabel}</Text>
          <View className="bg-surface-700/60 rounded-md px-1.5 py-0.5">
            <Text className="text-surface-500 text-xs">{sessions.length} int.</Text>
          </View>
        </View>
        <Text className="text-white text-base font-bold">{totalKm.toFixed(2)} km</Text>
      </View>

      <View className="flex-row gap-4 mt-2">
        {totalDuration > 0 && (
          <Text className="text-surface-500 text-xs">
            ⏱ {formatDuration(totalDuration)}
          </Text>
        )}
        {avgHr && (
          <Text className="text-surface-500 text-xs">❤️ {avgHr} bpm</Text>
        )}
        {totalKcal > 0 && (
          <Text className="text-surface-500 text-xs">
            🔥 {Math.round(totalKcal)} kcal
          </Text>
        )}
      </View>

      {expanded && (
        <View className="mt-3 border-t border-surface-700/40 pt-2 gap-0.5">
          {sessions.map((s) => (
            <IntervalRow key={s.id} session={s} onDelete={() => onDelete(s.id, date)} />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

function SummaryBar({ sessions }: { sessions: RunSession[] }) {
  const totalKm = sessions.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const validPaces = sessions.filter((r) => r.pace_min_km && r.pace_min_km > 1);
  const avgPace = validPaces.length
    ? validPaces.reduce((a, r) => a + r.pace_min_km!, 0) / validPaces.length
    : 0;
  const validHr = sessions.filter((r) => r.avg_hr);
  const avgHr = validHr.length
    ? Math.round(validHr.reduce((a, r) => a + r.avg_hr!, 0) / validHr.length)
    : 0;

  // Count unique days
  const uniqueDays = new Set(sessions.map((s) => s.date)).size;

  const stats = [
    { label: "km total", value: totalKm.toFixed(1), color: "text-brand-400" },
    { label: "corridas", value: uniqueDays.toString(), color: "text-sky-400" },
    { label: "pace médio", value: avgPace ? formatPace(avgPace) : "—", color: "text-amber-400" },
    { label: "FC média", value: avgHr ? `${avgHr}` : "—", color: "text-rose-400" },
  ];

  return (
    <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 flex-row mb-4">
      {stats.map((s, i) => (
        <View
          key={i}
          className={`flex-1 items-center ${i < stats.length - 1 ? "border-r border-surface-700/50" : ""}`}
        >
          <Text className={`text-xl font-bold ${s.color}`}>{s.value}</Text>
          <Text className="text-surface-500 text-xs mt-0.5">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function CorridasScreen() {
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const from = useMemo(() => periodFrom(period), [period]);

  const qc = useQueryClient();
  const { data: sessions = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["run_sessions", period],
    queryFn: () => getRunSessions(from, new Date(), 1000),
  });

  const { mutateAsync: save, isPending: saving } = useMutation({
    mutationFn: upsertRunSession,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["run_sessions"] });
      qc.invalidateQueries({ queryKey: ["daily_log"] });
      syncRunSessionsToDaily(vars.date).catch(() => {});
    },
  });
  const { mutateAsync: remove } = useMutation({
    mutationFn: deleteRunSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run_sessions"] });
      qc.invalidateQueries({ queryKey: ["daily_log"] });
    },
  });

  async function handleDelete(id: string, date: string) {
    await remove(id);
    syncRunSessionsToDaily(date).catch(() => {});
  }

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    date: format(new Date(), "yyyy-MM-dd"),
    interval_type: "Easy",
  });

  function setF(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Group sessions by date
  const grouped = useMemo(() => {
    const map: Record<string, RunSession[]> = {};
    for (const s of sessions) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }
    // Sort intervals within each day by distance desc
    for (const date of Object.keys(map)) {
      map[date].sort((a, b) => (b.distance_km ?? 0) - (a.distance_km ?? 0));
    }
    return map;
  }, [sessions]);

  const sortedDates = useMemo(
    () => Object.keys(grouped).sort((a, b) => b.localeCompare(a)),
    [grouped]
  );

  async function handleSave() {
    if (!form.interval_type) return;
    try {
      await save({
        date: form.date,
        interval_type: (form.interval_type || "Easy") as IntervalType,
        distance_km: form.distance ? parseFloat(form.distance) : undefined,
        duration_min: form.duration ? parseFloat(form.duration) : undefined,
        pace_min_km: form.pace ? parseFloat(form.pace) : undefined,
        avg_hr: form.avg_hr ? parseInt(form.avg_hr) : undefined,
        max_hr: form.max_hr ? parseInt(form.max_hr) : undefined,
        thermal_sensation_c: form.temp ? parseFloat(form.temp) : undefined,
        calories_kcal: form.kcal ? parseFloat(form.kcal) : undefined,
        notes: form.notes || null,
      });
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
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#10b981" />
        }
      >
        {/* Header */}
        <View className="flex-row justify-between items-center mb-4">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
              Corridas
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">Histórico</Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-4 py-2.5 border border-brand-600"
            onPress={() => setShowModal(true)}
            style={{ shadowColor: "#10b981", shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 }}
          >
            <Text className="text-white font-bold text-sm">+ Intervalo</Text>
          </TouchableOpacity>
        </View>

        {/* Period selector */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-1.5 flex-row gap-1 mb-4">
          {PERIODS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              className={`flex-1 py-2 rounded-xl items-center ${
                period === key ? "bg-brand-500" : ""
              }`}
              onPress={() => setPeriod(key)}
            >
              <Text
                className={`text-sm font-bold ${
                  period === key ? "text-white" : "text-surface-500"
                }`}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator color="#10b981" size="large" className="mt-12" />
        ) : (
          <>
            {sessions.length > 0 && <SummaryBar sessions={sessions} />}
            {sortedDates.map((date) => (
              <DayCard
                key={date}
                date={date}
                sessions={grouped[date]}
                onDelete={handleDelete}
              />
            ))}
            {sessions.length === 0 && (
              <View className="items-center py-16 gap-3">
                <Text className="text-4xl">🏃</Text>
                <Text className="text-white font-semibold">Nenhuma corrida neste período</Text>
                <Text className="text-surface-500 text-sm">Toque em + Intervalo para adicionar</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Add interval modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 border border-surface-700/60 rounded-t-3xl px-5 pt-6 pb-10 gap-4">
              <View className="w-10 h-1 bg-surface-600 rounded-full self-center mb-2" />
              <Text className="text-white text-xl font-bold">Novo intervalo</Text>
              <Text className="text-surface-500 text-xs -mt-2">
                Cada corrida é composta por vários intervalos nesta data.
              </Text>

              {/* Date */}
              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Data (YYYY-MM-DD)</Text>
                <TextInput
                  className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
                  value={form.date}
                  onChangeText={(v) => setF("date", v)}
                  placeholderTextColor="#4a4b58"
                />
              </View>

              {/* Type selector */}
              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Tipo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {INTERVAL_TYPES.map((t) => {
                      const c = INTERVAL_COLORS[t];
                      const active = form.interval_type === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setF("interval_type", t)}
                          className="px-3 py-1.5 rounded-lg border"
                          style={{
                            backgroundColor: active ? c.bg : "rgba(44,45,54,0.5)",
                            borderColor: active ? c.border : "#2c2d36",
                          }}
                        >
                          <Text className="text-xs font-bold" style={{ color: active ? c.text : "#72737f" }}>
                            {t}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {/* Row 1: distance / duration / pace */}
              <View className="flex-row gap-3">
                {[
                  { key: "distance", label: "Distância", unit: "km" },
                  { key: "duration", label: "Duração", unit: "min" },
                  { key: "pace", label: "Pace", unit: "min/km" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
                    <TextInput
                      className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(v) => setF(key, v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#4a4b58"
                    />
                    <Text className="text-surface-600 text-xs">{unit}</Text>
                  </View>
                ))}
              </View>

              {/* Row 2: hr / temp / kcal */}
              <View className="flex-row gap-3">
                {[
                  { key: "avg_hr", label: "FC média", unit: "bpm" },
                  { key: "max_hr", label: "FC máx", unit: "bpm" },
                  { key: "temp", label: "Temp", unit: "°C" },
                  { key: "kcal", label: "kcal", unit: "" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
                    <TextInput
                      className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(v) => setF(key, v)}
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
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-bold">Salvar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
