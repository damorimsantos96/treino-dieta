import { useState } from "react";
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
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRunSessions, useUpsertRunSession, useDeleteRunSession } from "@/hooks/useRunSessions";
import { RunSession, IntervalType } from "@/types";
import { formatPace, formatDuration } from "@/utils/calculations";
import { SectionLabel } from "@/components/ui/Card";

const INTERVAL_TYPES: IntervalType[] = [
  "Easy", "Tempo", "Threshold", "Intervals", "VO2max", "Long Run", "Race", "Outro",
];

const INTERVAL_COLORS: Record<IntervalType, { bg: string; text: string; border: string }> = {
  Easy:      { bg: "rgba(34,197,94,0.12)",   text: "#22c55e", border: "rgba(34,197,94,0.25)"  },
  Tempo:     { bg: "rgba(234,179,8,0.12)",   text: "#eab308", border: "rgba(234,179,8,0.25)"  },
  Threshold: { bg: "rgba(249,115,22,0.12)",  text: "#f97316", border: "rgba(249,115,22,0.25)" },
  Intervals: { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", border: "rgba(239,68,68,0.25)"  },
  VO2max:    { bg: "rgba(168,85,247,0.12)",  text: "#a855f7", border: "rgba(168,85,247,0.25)" },
  "Long Run":{ bg: "rgba(59,130,246,0.12)",  text: "#3b82f6", border: "rgba(59,130,246,0.25)" },
  Race:      { bg: "rgba(236,72,153,0.12)",  text: "#ec4899", border: "rgba(236,72,153,0.25)" },
  Outro:     { bg: "rgba(113,113,127,0.12)", text: "#71717f", border: "rgba(113,113,127,0.25)"},
};

function SessionRow({ session, onDelete }: { session: RunSession; onDelete: (id: string) => void }) {
  const date = parseISO(session.date);
  const pace = session.pace_min_km ? formatPace(session.pace_min_km) : "—";
  const color = INTERVAL_COLORS[session.interval_type as IntervalType] ?? INTERVAL_COLORS.Outro;

  return (
    <TouchableOpacity
      onLongPress={() =>
        Alert.alert("Excluir sessão?", "Esta ação não pode ser desfeita.", [
          { text: "Cancelar", style: "cancel" },
          { text: "Excluir", style: "destructive", onPress: () => onDelete(session.id) },
        ])
      }
      className="bg-surface-800 border border-surface-700/60 rounded-2xl px-4 py-3.5 mb-2.5"
    >
      <View className="flex-row justify-between items-center mb-2">
        <View className="flex-row items-center gap-2">
          <View
            className="px-2.5 py-1 rounded-lg border"
            style={{ backgroundColor: color.bg, borderColor: color.border }}
          >
            <Text className="text-xs font-bold" style={{ color: color.text }}>
              {session.interval_type}
            </Text>
          </View>
          <Text className="text-surface-500 text-xs font-medium">
            {format(date, "dd 'de' MMM", { locale: ptBR })}
          </Text>
        </View>
        <Text className="text-white text-base font-bold">
          {session.distance_km?.toFixed(2) ?? "—"} km
        </Text>
      </View>
      <View className="flex-row gap-4">
        <Text className="text-surface-500 text-xs">
          ⏱ {session.duration_min ? formatDuration(session.duration_min) : "—"}
        </Text>
        <Text className="text-surface-500 text-xs">🏃 {pace}/km</Text>
        <Text className="text-surface-500 text-xs">❤️ {session.avg_hr ?? "—"} bpm</Text>
        <Text className="text-surface-500 text-xs">
          🔥 {session.calories_kcal ? Math.round(session.calories_kcal) : "—"} kcal
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SummaryRow({ sessions }: { sessions: RunSession[] }) {
  const totalKm = sessions.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const paces = sessions.filter((r) => r.pace_min_km).map((r) => r.pace_min_km!);
  const avgPace = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
  const hrs = sessions.filter((r) => r.avg_hr).map((r) => r.avg_hr!);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;

  const stats = [
    { label: "km total", value: totalKm.toFixed(1), color: "text-brand-400" },
    { label: "sessões", value: sessions.length.toString(), color: "text-sky-400" },
    { label: "pace médio", value: avgPace ? formatPace(avgPace) : "—", color: "text-amber-400" },
    { label: "FC média", value: avgHr ? `${avgHr}` : "—", color: "text-rose-400" },
  ];

  return (
    <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 flex-row mb-4">
      {stats.map((s, i) => (
        <View key={i} className={`flex-1 items-center ${i < stats.length - 1 ? "border-r border-surface-700/50" : ""}`}>
          <Text className={`text-xl font-bold ${s.color}`}>{s.value}</Text>
          <Text className="text-surface-500 text-xs mt-0.5">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function CorridasScreen() {
  const { data: sessions = [], isLoading, refetch, isRefetching } = useRunSessions(3);
  const { mutateAsync: save, isPending: saving } = useUpsertRunSession();
  const { mutateAsync: remove } = useDeleteRunSession();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    date: format(new Date(), "yyyy-MM-dd"),
    interval_type: "Easy",
  });

  function setF(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.interval_type) return;
    try {
      await save({
        date: form.date,
        interval_type: form.interval_type,
        distance_km: form.distance ? parseFloat(form.distance) : undefined,
        duration_min: form.duration ? parseFloat(form.duration) : undefined,
        pace_min_km: form.pace ? parseFloat(form.pace) : undefined,
        avg_hr: form.avg_hr ? parseInt(form.avg_hr) : undefined,
        max_hr: form.max_hr ? parseInt(form.max_hr) : undefined,
        thermal_sensation_c: form.temp ? parseFloat(form.temp) : undefined,
        calories_kcal: form.kcal ? parseFloat(form.kcal) : undefined,
        notes: form.notes || undefined,
      });
      setShowModal(false);
      setForm({ date: format(new Date(), "yyyy-MM-dd"), interval_type: "Easy" });
    } catch (err: any) {
      Alert.alert("Erro", err.message);
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
        <View className="flex-row justify-between items-center mb-5">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
              Últimos 3 meses
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">Corridas</Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-4 py-2.5 border border-brand-600"
            onPress={() => setShowModal(true)}
            style={{ shadowColor: "#10b981", shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 }}
          >
            <Text className="text-white font-bold text-sm">+ Nova</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#10b981" size="large" className="mt-12" />
        ) : (
          <>
            <SummaryRow sessions={sessions} />
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} onDelete={(id) => remove(id)} />
            ))}
            {sessions.length === 0 && (
              <View className="items-center py-16 gap-3">
                <Text className="text-4xl">🏃</Text>
                <Text className="text-white font-semibold">Nenhuma corrida registrada</Text>
                <Text className="text-surface-500 text-sm">Toque em + Nova para adicionar</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Add session modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 border border-surface-700/60 rounded-t-3xl px-5 pt-6 pb-10 gap-4">
              <View className="w-10 h-1 bg-surface-600 rounded-full self-center mb-2" />
              <Text className="text-white text-xl font-bold">Nova sessão</Text>

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

              {/* Row 1 */}
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

              {/* Row 2 */}
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
                    {unit && <Text className="text-surface-600 text-xs">{unit}</Text>}
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
