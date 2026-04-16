import { useState, useEffect } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDailyLog, useUpsertDailyLog } from "@/hooks/useDailyLog";
import { DailyLog } from "@/types";

const today = new Date();

type ActivityKey = "academia" | "boxe" | "surf" | "corrida" | "crossfit" | "musculacao";

const ACTIVITIES: { key: ActivityKey; label: string; icon: string }[] = [
  { key: "academia", label: "Academia", icon: "🏋️" },
  { key: "boxe", label: "Boxe", icon: "🥊" },
  { key: "surf", label: "Surf", icon: "🏄" },
  { key: "corrida", label: "Corrida", icon: "🏃" },
  { key: "crossfit", label: "CrossFit", icon: "⚡" },
  { key: "musculacao", label: "Musculação", icon: "💪" },
];

function NumInput({
  label,
  value,
  onChange,
  unit,
  placeholder = "0",
  decimal = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
  decimal?: boolean;
}) {
  return (
    <View className="flex-1 gap-1">
      <Text className="text-surface-600 text-xs">{label}</Text>
      <View className="flex-row items-center bg-surface-700 rounded-xl px-3 py-2.5">
        <TextInput
          className="flex-1 text-white text-sm"
          value={value}
          onChangeText={onChange}
          keyboardType={decimal ? "decimal-pad" : "number-pad"}
          placeholder={placeholder}
          placeholderTextColor="#475569"
        />
        {unit && (
          <Text className="text-surface-600 text-xs ml-1">{unit}</Text>
        )}
      </View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-surface-600 text-xs font-semibold uppercase tracking-wider mt-2">
      {title}
    </Text>
  );
}

type FormState = Record<string, string>;

function num(v: string): number | null {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? null : n;
}

function str(v: number | null | undefined): string {
  return v != null ? v.toString() : "";
}

export default function RegistrarScreen() {
  const { data: existing, isLoading } = useDailyLog(today);
  const { mutateAsync: save, isPending } = useUpsertDailyLog();

  const [selectedActivities, setSelectedActivities] = useState<Set<ActivityKey>>(new Set());
  const [form, setForm] = useState<FormState>({});

  useEffect(() => {
    if (!existing) return;
    const active = new Set<ActivityKey>();
    ACTIVITIES.forEach(({ key }) => {
      const min = (existing as any)[`min_${key}`];
      if (min && min > 0) active.add(key);
    });
    setSelectedActivities(active);
    setForm({
      weight: str(existing.weight_kg),
      surplus: str(existing.surplus_deficit_kcal),
      min_sauna: str(existing.min_sauna),
      temp_sauna: str(existing.temp_sauna),
      bpm_sauna: str(existing.bpm_sauna),
      kcal_outros: str(existing.kcal_outros),
      ...Object.fromEntries(
        ACTIVITIES.flatMap(({ key }) => [
          [`kcal_${key}`, str((existing as any)[`kcal_${key}`])],
          [`min_${key}`, str((existing as any)[`min_${key}`])],
          [`temp_${key}`, str((existing as any)[`temp_${key}`])],
          [`bpm_${key}`, str((existing as any)[`bpm_${key}`])],
        ])
      ),
    });
  }, [existing]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleActivity(key: ActivityKey) {
    setSelectedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    const payload: Partial<DailyLog> & { date: string } = {
      date: format(today, "yyyy-MM-dd"),
      weight_kg: num(form.weight),
      surplus_deficit_kcal: num(form.surplus),
      min_sauna: num(form.min_sauna),
      temp_sauna: num(form.temp_sauna),
      bpm_sauna: num(form.bpm_sauna),
      kcal_outros: num(form.kcal_outros),
    };

    ACTIVITIES.forEach(({ key }) => {
      (payload as any)[`kcal_${key}`] = selectedActivities.has(key) ? num(form[`kcal_${key}`]) : null;
      (payload as any)[`min_${key}`] = selectedActivities.has(key) ? num(form[`min_${key}`]) : null;
      (payload as any)[`temp_${key}`] = selectedActivities.has(key) ? num(form[`temp_${key}`]) : null;
      (payload as any)[`bpm_${key}`] = selectedActivities.has(key) ? num(form[`bpm_${key}`]) : null;
    });

    try {
      await save(payload);
      Alert.alert("✅ Salvo!", "Registro do dia atualizado.");
    } catch (err: any) {
      Alert.alert("Erro", err.message ?? "Não foi possível salvar.");
    }
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-surface-900 items-center justify-center">
        <ActivityIndicator color="#22c55e" size="large" />
      </View>
    );
  }

  const dateLabel = format(today, "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-900"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-14 pb-10 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text className="text-surface-600 text-sm capitalize">{dateLabel}</Text>
          <Text className="text-white text-2xl font-bold">Registrar</Text>
        </View>

        {/* ── Peso ─────────────────────────────────────── */}
        <View className="bg-surface-800 rounded-2xl p-4 gap-3">
          <SectionHeader title="Corpo" />
          <View className="flex-row gap-3">
            <NumInput
              label="Peso"
              value={form.weight ?? ""}
              onChange={(v) => set("weight", v)}
              unit="kg"
              decimal
            />
            <NumInput
              label="Superávit / Déficit"
              value={form.surplus ?? ""}
              onChange={(v) => set("surplus", v)}
              unit="kcal"
              decimal
            />
          </View>
        </View>

        {/* ── Atividades ────────────────────────────────── */}
        <View className="bg-surface-800 rounded-2xl p-4 gap-3">
          <SectionHeader title="Atividades" />
          <Text className="text-surface-600 text-xs">
            Toque para ativar a atividade
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ACTIVITIES.map(({ key, label, icon }) => {
              const active = selectedActivities.has(key);
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => toggleActivity(key)}
                  className={`px-3 py-2 rounded-xl flex-row items-center gap-1 ${
                    active ? "bg-brand-500" : "bg-surface-700"
                  }`}
                >
                  <Text className="text-sm">{icon}</Text>
                  <Text
                    className={`text-sm font-medium ${
                      active ? "text-white" : "text-surface-600"
                    }`}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Per-activity fields */}
          {ACTIVITIES.filter(({ key }) => selectedActivities.has(key)).map(
            ({ key, label, icon }) => (
              <View
                key={key}
                className="border-t border-surface-700 pt-3 gap-2"
              >
                <Text className="text-white text-sm font-semibold">
                  {icon} {label}
                </Text>
                <View className="flex-row gap-2">
                  <NumInput
                    label="kcal"
                    value={form[`kcal_${key}`] ?? ""}
                    onChange={(v) => set(`kcal_${key}`, v)}
                    unit="kcal"
                  />
                  <NumInput
                    label="Duração"
                    value={form[`min_${key}`] ?? ""}
                    onChange={(v) => set(`min_${key}`, v)}
                    unit="min"
                  />
                </View>
                <View className="flex-row gap-2">
                  <NumInput
                    label="Temperatura"
                    value={form[`temp_${key}`] ?? ""}
                    onChange={(v) => set(`temp_${key}`, v)}
                    unit="°C"
                    decimal
                  />
                  <NumInput
                    label="FC média"
                    value={form[`bpm_${key}`] ?? ""}
                    onChange={(v) => set(`bpm_${key}`, v)}
                    unit="bpm"
                  />
                </View>
              </View>
            )
          )}
        </View>

        {/* ── Sauna ────────────────────────────────────── */}
        <View className="bg-surface-800 rounded-2xl p-4 gap-3">
          <SectionHeader title="Sauna 🧖" />
          <View className="flex-row gap-2">
            <NumInput
              label="Duração"
              value={form.min_sauna ?? ""}
              onChange={(v) => set("min_sauna", v)}
              unit="min"
            />
            <NumInput
              label="Temperatura"
              value={form.temp_sauna ?? ""}
              onChange={(v) => set("temp_sauna", v)}
              unit="°C"
              decimal
            />
            <NumInput
              label="FC média"
              value={form.bpm_sauna ?? ""}
              onChange={(v) => set("bpm_sauna", v)}
              unit="bpm"
            />
          </View>
        </View>

        {/* ── Outros ───────────────────────────────────── */}
        <View className="bg-surface-800 rounded-2xl p-4 gap-3">
          <SectionHeader title="Outros" />
          <NumInput
            label="Kcal outras atividades"
            value={form.kcal_outros ?? ""}
            onChange={(v) => set("kcal_outros", v)}
            unit="kcal"
          />
        </View>

        {/* ── Save ─────────────────────────────────────── */}
        <TouchableOpacity
          className="bg-brand-500 rounded-2xl py-4 items-center mt-2"
          onPress={handleSave}
          disabled={isPending}
        >
          {isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-base">
              💾 Salvar registro
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
