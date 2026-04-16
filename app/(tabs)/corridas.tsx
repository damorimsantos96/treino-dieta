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
import { Card } from "@/components/ui/Card";

const INTERVAL_TYPES: IntervalType[] = [
  "Easy", "Tempo", "Threshold", "Intervals", "VO2max", "Long Run", "Race", "Outro",
];

const INTERVAL_COLORS: Record<IntervalType, string> = {
  Easy: "bg-green-700",
  Tempo: "bg-yellow-600",
  Threshold: "bg-orange-600",
  Intervals: "bg-red-600",
  VO2max: "bg-purple-600",
  "Long Run": "bg-blue-600",
  Race: "bg-pink-600",
  Outro: "bg-surface-600",
};

function SessionRow({
  session,
  onDelete,
}: {
  session: RunSession;
  onDelete: (id: string) => void;
}) {
  const date = parseISO(session.date);
  const pace = session.pace_min_km ? formatPace(session.pace_min_km) : "—";
  const color = INTERVAL_COLORS[session.interval_type as IntervalType] ?? "bg-surface-600";

  return (
    <TouchableOpacity
      onLongPress={() =>
        Alert.alert("Excluir sessão?", "Esta ação não pode ser desfeita.", [
          { text: "Cancelar", style: "cancel" },
          { text: "Excluir", style: "destructive", onPress: () => onDelete(session.id) },
        ])
      }
      className="bg-surface-800 rounded-xl px-4 py-3 mb-2"
    >
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center gap-2">
          <View className={`${color} rounded-lg px-2 py-0.5`}>
            <Text className="text-white text-xs font-semibold">
              {session.interval_type}
            </Text>
          </View>
          <Text className="text-surface-600 text-xs">
            {format(date, "dd/MM", { locale: ptBR })}
          </Text>
        </View>
        <Text className="text-white text-sm font-bold">
          {session.distance_km?.toFixed(2) ?? "—"} km
        </Text>
      </View>
      <View className="flex-row justify-between mt-2">
        <Text className="text-surface-600 text-xs">
          ⏱️ {session.duration_min ? formatDuration(session.duration_min) : "—"}
        </Text>
        <Text className="text-surface-600 text-xs">🏃 {pace}/km</Text>
        <Text className="text-surface-600 text-xs">
          ❤️ {session.avg_hr ?? "—"} bpm
        </Text>
        <Text className="text-surface-600 text-xs">
          🔥 {session.calories_kcal ? Math.round(session.calories_kcal) : "—"} kcal
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SummaryCard({ sessions }: { sessions: RunSession[] }) {
  const totalKm = sessions.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const totalMin = sessions.reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const paces = sessions.filter((r) => r.pace_min_km).map((r) => r.pace_min_km!);
  const avgPace = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
  const hrs = sessions.filter((r) => r.avg_hr).map((r) => r.avg_hr!);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;

  return (
    <Card className="flex-row flex-wrap gap-3 mb-4">
      <View className="flex-1 items-center">
        <Text className="text-white text-xl font-bold">{totalKm.toFixed(1)}</Text>
        <Text className="text-surface-600 text-xs">km total</Text>
      </View>
      <View className="flex-1 items-center">
        <Text className="text-white text-xl font-bold">{sessions.length}</Text>
        <Text className="text-surface-600 text-xs">sessões</Text>
      </View>
      <View className="flex-1 items-center">
        <Text className="text-white text-xl font-bold">
          {avgPace ? formatPace(avgPace) : "—"}
        </Text>
        <Text className="text-surface-600 text-xs">pace médio</Text>
      </View>
      <View className="flex-1 items-center">
        <Text className="text-white text-xl font-bold">{avgHr || "—"}</Text>
        <Text className="text-surface-600 text-xs">FC média</Text>
      </View>
    </Card>
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
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#22c55e"
          />
        }
      >
        <View className="flex-row justify-between items-center mb-4">
          <View>
            <Text className="text-surface-600 text-sm">Últimos 3 meses</Text>
            <Text className="text-white text-2xl font-bold">Corridas</Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-4 py-2"
            onPress={() => setShowModal(true)}
          >
            <Text className="text-white font-bold">+ Nova</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#22c55e" className="mt-12" />
        ) : (
          <>
            <SummaryCard sessions={sessions} />
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} onDelete={(id) => remove(id)} />
            ))}
            {sessions.length === 0 && (
              <Text className="text-surface-600 text-center mt-8">
                Nenhuma corrida registrada.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Add session modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 rounded-t-3xl px-5 pt-5 pb-10 gap-4">
              <Text className="text-white text-lg font-bold">Nova sessão</Text>

              {/* Date */}
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">Data (YYYY-MM-DD)</Text>
                <TextInput
                  className="bg-surface-700 text-white rounded-xl px-4 py-3"
                  value={form.date}
                  onChangeText={(v) => setF("date", v)}
                  placeholderTextColor="#475569"
                />
              </View>

              {/* Interval type */}
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">Tipo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {INTERVAL_TYPES.map((t) => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => setF("interval_type", t)}
                        className={`px-3 py-1.5 rounded-lg ${
                          form.interval_type === t ? "bg-brand-500" : "bg-surface-700"
                        }`}
                      >
                        <Text className="text-white text-xs font-medium">{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Metrics row 1 */}
              <View className="flex-row gap-3">
                {[
                  { key: "distance", label: "Distância", unit: "km" },
                  { key: "duration", label: "Duração", unit: "min" },
                  { key: "pace", label: "Pace", unit: "min/km" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-600 text-xs">{label}</Text>
                    <TextInput
                      className="bg-surface-700 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(v) => setF(key, v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#475569"
                    />
                    <Text className="text-surface-600 text-xs">{unit}</Text>
                  </View>
                ))}
              </View>

              {/* Metrics row 2 */}
              <View className="flex-row gap-3">
                {[
                  { key: "avg_hr", label: "FC média", unit: "bpm" },
                  { key: "max_hr", label: "FC máx", unit: "bpm" },
                  { key: "temp", label: "Temp", unit: "°C" },
                  { key: "kcal", label: "kcal", unit: "" },
                ].map(({ key, label, unit }) => (
                  <View key={key} className="flex-1 gap-1">
                    <Text className="text-surface-600 text-xs">{label}</Text>
                    <TextInput
                      className="bg-surface-700 text-white rounded-xl px-3 py-2.5 text-sm"
                      value={form[key] ?? ""}
                      onChangeText={(v) => setF(key, v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#475569"
                    />
                    {unit && <Text className="text-surface-600 text-xs">{unit}</Text>}
                  </View>
                ))}
              </View>

              <View className="flex-row gap-3 mt-2">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 rounded-xl py-3 items-center"
                  onPress={() => setShowModal(false)}
                >
                  <Text className="text-white font-medium">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3 items-center"
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

