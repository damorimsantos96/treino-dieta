import { useState, useCallback } from "react";
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
import { useFocusEffect } from "expo-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDailyLog, useUpsertDailyLog } from "@/hooks/useDailyLog";
import { DailyLog } from "@/types";
import { SectionLabel } from "@/components/ui/Card";

type ActivityKey = "academia" | "boxe" | "surf" | "corrida" | "crossfit" | "musculacao";

const ACTIVITIES: { key: ActivityKey; label: string; icon: string }[] = [
  { key: "academia", label: "Academia", icon: "🏋️" },
  { key: "boxe", label: "Boxe", icon: "🥊" },
  { key: "surf", label: "Surf", icon: "🏄" },
  { key: "corrida", label: "Corrida", icon: "🏃" },
  { key: "crossfit", label: "CrossFit", icon: "⚡" },
  { key: "musculacao", label: "Musculação", icon: "💪" },
];

type ActivityFields = {
  [K in ActivityKey as `kcal_${K}` | `min_${K}` | `temp_${K}` | `bpm_${K}`]: string;
};

type FormState = {
  weight: string;
  surplus: string;
  protein_g: string;
  carbs_g: string;
  water_consumed_ml: string;
  min_sauna: string;
  temp_sauna: string;
  bpm_sauna: string;
  kcal_outros: string;
} & ActivityFields;

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
    <View className="flex-1 gap-1.5">
      <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
      <View className="flex-row items-center bg-surface-700/50 border border-surface-700 rounded-xl px-3 py-2.5">
        <TextInput
          className="flex-1 text-white text-sm"
          value={value}
          onChangeText={onChange}
          keyboardType={decimal ? "decimal-pad" : "number-pad"}
          placeholder={placeholder}
          placeholderTextColor="#4a4b58"
        />
        {unit && (
          <Text className="text-surface-500 text-xs font-medium ml-1">{unit}</Text>
        )}
      </View>
    </View>
  );
}

function num(v: string): number | null {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? null : n;
}

function str(v: number | null | undefined): string {
  return v != null ? v.toString() : "";
}

const EMPTY_FORM: FormState = {
  weight: "", surplus: "", protein_g: "", carbs_g: "", water_consumed_ml: "",
  min_sauna: "", temp_sauna: "", bpm_sauna: "", kcal_outros: "",
  kcal_academia: "", min_academia: "", temp_academia: "", bpm_academia: "",
  kcal_boxe: "", min_boxe: "", temp_boxe: "", bpm_boxe: "",
  kcal_surf: "", min_surf: "", temp_surf: "", bpm_surf: "",
  kcal_corrida: "", min_corrida: "", temp_corrida: "", bpm_corrida: "",
  kcal_crossfit: "", min_crossfit: "", temp_crossfit: "", bpm_crossfit: "",
  kcal_musculacao: "", min_musculacao: "", temp_musculacao: "", bpm_musculacao: "",
};

export default function RegistrarScreen() {
  const [today, setToday] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      setToday(new Date());
    }, [])
  );

  const { data: existing, isLoading } = useDailyLog(today);
  const { mutateAsync: save, isPending } = useUpsertDailyLog();

  const [selectedActivities, setSelectedActivities] = useState<Set<ActivityKey>>(new Set());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useFocusEffect(
    useCallback(() => {
      if (!existing) {
        setForm(EMPTY_FORM);
        setSelectedActivities(new Set());
        return;
      }
      const active = new Set<ActivityKey>();
      ACTIVITIES.forEach(({ key }) => {
        const minKey = `min_${key}` as keyof DailyLog;
        const val = existing[minKey];
        if (typeof val === "number" && val > 0) active.add(key);
      });
      setSelectedActivities(active);
      setForm({
        weight: str(existing.weight_kg),
        surplus: str(existing.surplus_deficit_kcal),
        protein_g: str(existing.protein_g),
        carbs_g: str(existing.carbs_g),
        water_consumed_ml: str(existing.water_consumed_ml),
        min_sauna: str(existing.min_sauna),
        temp_sauna: str(existing.temp_sauna),
        bpm_sauna: str(existing.bpm_sauna),
        kcal_outros: str(existing.kcal_outros),
        kcal_academia: str(existing.kcal_academia), min_academia: str(existing.min_academia),
        temp_academia: str(existing.temp_academia), bpm_academia: str(existing.bpm_academia),
        kcal_boxe: str(existing.kcal_boxe), min_boxe: str(existing.min_boxe),
        temp_boxe: str(existing.temp_boxe), bpm_boxe: str(existing.bpm_boxe),
        kcal_surf: str(existing.kcal_surf), min_surf: str(existing.min_surf),
        temp_surf: str(existing.temp_surf), bpm_surf: str(existing.bpm_surf),
        kcal_corrida: str(existing.kcal_corrida), min_corrida: str(existing.min_corrida),
        temp_corrida: str(existing.temp_corrida), bpm_corrida: str(existing.bpm_corrida),
        kcal_crossfit: str(existing.kcal_crossfit), min_crossfit: str(existing.min_crossfit),
        temp_crossfit: str(existing.temp_crossfit), bpm_crossfit: str(existing.bpm_crossfit),
        kcal_musculacao: str(existing.kcal_musculacao), min_musculacao: str(existing.min_musculacao),
        temp_musculacao: str(existing.temp_musculacao), bpm_musculacao: str(existing.bpm_musculacao),
      });
    }, [existing])
  );

  function set(key: keyof FormState, value: string) {
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
      protein_g: num(form.protein_g),
      carbs_g: num(form.carbs_g),
      water_consumed_ml: num(form.water_consumed_ml),
      min_sauna: num(form.min_sauna),
      temp_sauna: num(form.temp_sauna),
      bpm_sauna: num(form.bpm_sauna),
      kcal_outros: num(form.kcal_outros),
    };

    ACTIVITIES.forEach(({ key }) => {
      const active = selectedActivities.has(key);
      payload[`kcal_${key}` as keyof DailyLog] = active ? num(form[`kcal_${key}` as keyof FormState]) : null as never;
      payload[`min_${key}` as keyof DailyLog] = active ? num(form[`min_${key}` as keyof FormState]) : null as never;
      payload[`temp_${key}` as keyof DailyLog] = active ? num(form[`temp_${key}` as keyof FormState]) : null as never;
      payload[`bpm_${key}` as keyof DailyLog] = active ? num(form[`bpm_${key}` as keyof FormState]) : null as never;
    });

    try {
      await save(payload);
      Alert.alert("✅ Salvo!", "Registro do dia atualizado.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      Alert.alert("Erro", message);
    }
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-surface-900 items-center justify-center">
        <ActivityIndicator color="#10b981" size="large" />
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
        contentContainerClassName="px-4 pt-14 pb-10 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View>
          <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest capitalize">
            {dateLabel}
          </Text>
          <Text className="text-white text-3xl font-bold tracking-tight">Registrar</Text>
        </View>

        {/* ── Corpo ─────────────────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-3">
          <SectionLabel label="Corpo" />
          <View className="flex-row gap-3">
            <NumInput
              label="Peso"
              value={form.weight}
              onChange={(v) => set("weight", v)}
              unit="kg"
              decimal
            />
            <NumInput
              label="Superávit / Déficit"
              value={form.surplus}
              onChange={(v) => set("surplus", v)}
              unit="kcal"
              decimal
            />
          </View>
        </View>

        {/* ── Nutrição ──────────────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-3">
          <SectionLabel label="Nutrição 🥗" />
          <View className="flex-row gap-3">
            <NumInput
              label="Proteína"
              value={form.protein_g}
              onChange={(v) => set("protein_g", v)}
              unit="g"
            />
            <NumInput
              label="Carboidrato"
              value={form.carbs_g}
              onChange={(v) => set("carbs_g", v)}
              unit="g"
            />
          </View>
          <NumInput
            label="Água consumida"
            value={form.water_consumed_ml}
            onChange={(v) => set("water_consumed_ml", v)}
            unit="ml"
          />
        </View>

        {/* ── Atividades ────────────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-3">
          <SectionLabel label="Atividades" />
          <View className="flex-row flex-wrap gap-2">
            {ACTIVITIES.map(({ key, label, icon }) => {
              const active = selectedActivities.has(key);
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => toggleActivity(key)}
                  className={`px-3 py-2 rounded-xl flex-row items-center gap-1.5 border ${
                    active
                      ? "bg-brand-500 border-brand-600"
                      : "bg-surface-700/50 border-surface-700"
                  }`}
                >
                  <Text className="text-sm">{icon}</Text>
                  <Text
                    className={`text-sm font-semibold ${
                      active ? "text-white" : "text-surface-500"
                    }`}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {ACTIVITIES.filter(({ key }) => selectedActivities.has(key)).map(
            ({ key, label, icon }) => (
              <View key={key} className="border-t border-surface-700/50 pt-3 gap-2">
                <Text className="text-white text-sm font-bold">
                  {icon} {label}
                </Text>
                <View className="flex-row gap-2">
                  <NumInput
                    label="kcal"
                    value={form[`kcal_${key}`]}
                    onChange={(v) => set(`kcal_${key}`, v)}
                    unit="kcal"
                  />
                  <NumInput
                    label="Duração"
                    value={form[`min_${key}`]}
                    onChange={(v) => set(`min_${key}`, v)}
                    unit="min"
                  />
                </View>
                <View className="flex-row gap-2">
                  <NumInput
                    label="Temperatura"
                    value={form[`temp_${key}`]}
                    onChange={(v) => set(`temp_${key}`, v)}
                    unit="°C"
                    decimal
                  />
                  <NumInput
                    label="FC média"
                    value={form[`bpm_${key}`]}
                    onChange={(v) => set(`bpm_${key}`, v)}
                    unit="bpm"
                  />
                </View>
              </View>
            )
          )}
        </View>

        {/* ── Sauna ────────────────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-3">
          <SectionLabel label="Sauna 🧖" />
          <View className="flex-row gap-2">
            <NumInput
              label="Duração"
              value={form.min_sauna}
              onChange={(v) => set("min_sauna", v)}
              unit="min"
            />
            <NumInput
              label="Temperatura"
              value={form.temp_sauna}
              onChange={(v) => set("temp_sauna", v)}
              unit="°C"
              decimal
            />
            <NumInput
              label="FC média"
              value={form.bpm_sauna}
              onChange={(v) => set("bpm_sauna", v)}
              unit="bpm"
            />
          </View>
        </View>

        {/* ── Outros ───────────────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-3">
          <SectionLabel label="Outros" />
          <NumInput
            label="Kcal outras atividades"
            value={form.kcal_outros}
            onChange={(v) => set("kcal_outros", v)}
            unit="kcal"
          />
        </View>

        {/* ── Save ─────────────────────────────────────── */}
        <TouchableOpacity
          className="bg-brand-500 rounded-2xl py-4 items-center mt-1"
          onPress={handleSave}
          disabled={isPending}
          style={{ shadowColor: "#10b981", shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 }}
        >
          {isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-base tracking-wide">
              Salvar registro
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
