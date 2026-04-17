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
import { useUserMetrics } from "@/hooks/useUserProfile";
import { DailyLog } from "@/types";
import { SectionLabel } from "@/components/ui/Card";
import { computeDailyCalculations, formatWater } from "@/utils/calculations";
import { Ionicons } from "@expo/vector-icons";

type ActivityKey = "academia" | "boxe" | "surf" | "ciclismo" | "crossfit" | "musculacao";

const ACTIVITIES: {
  key: ActivityKey;
  label: string;
  icon: string;
  hasTempBpm: boolean;
}[] = [
  { key: "academia", label: "Academia", icon: "🏋️", hasTempBpm: true },
  { key: "boxe", label: "Boxe", icon: "🥊", hasTempBpm: true },
  { key: "surf", label: "Surf", icon: "🏄", hasTempBpm: true },
  { key: "ciclismo", label: "Ciclismo", icon: "🚴", hasTempBpm: true },
  { key: "crossfit", label: "CrossFit", icon: "⚡", hasTempBpm: false },
  { key: "musculacao", label: "Musculação", icon: "💪", hasTempBpm: false },
];

type FormState = {
  weight: string;
  surplus: string;
  // academia
  kcal_academia: string; min_academia: string; temp_academia: string; bpm_academia: string;
  // boxe
  kcal_boxe: string; min_boxe: string; temp_boxe: string; bpm_boxe: string;
  // surf
  kcal_surf: string; min_surf: string; temp_surf: string; bpm_surf: string;
  // ciclismo
  kcal_ciclismo: string; min_ciclismo: string; temp_ciclismo: string; bpm_ciclismo: string;
  // crossfit (no temp/bpm in DB)
  kcal_crossfit: string; min_crossfit: string;
  // musculacao (no temp/bpm in DB)
  kcal_musculacao: string; min_musculacao: string;
  // sauna
  min_sauna: string; temp_sauna: string; bpm_sauna: string;
  // outros
  kcal_outros: string;
};

const EMPTY_FORM: FormState = {
  weight: "", surplus: "",
  kcal_academia: "", min_academia: "", temp_academia: "", bpm_academia: "",
  kcal_boxe: "", min_boxe: "", temp_boxe: "", bpm_boxe: "",
  kcal_surf: "", min_surf: "", temp_surf: "", bpm_surf: "",
  kcal_ciclismo: "", min_ciclismo: "", temp_ciclismo: "", bpm_ciclismo: "",
  kcal_crossfit: "", min_crossfit: "",
  kcal_musculacao: "", min_musculacao: "",
  min_sauna: "", temp_sauna: "", bpm_sauna: "",
  kcal_outros: "",
};

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

function TargetRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-surface-700/40">
      <View className="flex-row items-center gap-2">
        <Text className="text-base">{icon}</Text>
        <Text className="text-surface-400 text-sm">{label}</Text>
      </View>
      <Text className="text-white text-sm font-bold">{value}</Text>
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

export default function RegistrarScreen() {
  const [today, setToday] = useState(() => new Date());
  const [saunaOpen, setSaunaOpen] = useState(false);
  const [outrosOpen, setOutrosOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setToday(new Date());
    }, [])
  );

  const { data: existing, isLoading } = useDailyLog(today);
  const { mutateAsync: save, isPending } = useUpsertDailyLog();
  const userMetrics = useUserMetrics();

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
        const val = existing[`min_${key}` as keyof DailyLog];
        if (typeof val === "number" && val > 0) active.add(key);
      });
      setSelectedActivities(active);
      setForm({
        weight: str(existing.weight_kg),
        surplus: str(existing.surplus_deficit_kcal),
        kcal_academia: str(existing.kcal_academia), min_academia: str(existing.min_academia),
        temp_academia: str(existing.temp_academia), bpm_academia: str(existing.bpm_academia),
        kcal_boxe: str(existing.kcal_boxe), min_boxe: str(existing.min_boxe),
        temp_boxe: str(existing.temp_boxe), bpm_boxe: str(existing.bpm_boxe),
        kcal_surf: str(existing.kcal_surf), min_surf: str(existing.min_surf),
        temp_surf: str(existing.temp_surf), bpm_surf: str(existing.bpm_surf),
        kcal_ciclismo: str(existing.kcal_ciclismo), min_ciclismo: str(existing.min_ciclismo),
        temp_ciclismo: str(existing.temp_ciclismo), bpm_ciclismo: str(existing.bpm_ciclismo),
        kcal_crossfit: str(existing.kcal_crossfit), min_crossfit: str(existing.min_crossfit),
        kcal_musculacao: str(existing.kcal_musculacao), min_musculacao: str(existing.min_musculacao),
        min_sauna: str(existing.min_sauna), temp_sauna: str(existing.temp_sauna),
        bpm_sauna: str(existing.bpm_sauna), kcal_outros: str(existing.kcal_outros),
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

  // Build a preview log to compute targets
  const weightNum = num(form.weight) ?? existing?.weight_kg ?? null;
  const previewLog: DailyLog = {
    id: "", user_id: "", date: format(today, "yyyy-MM-dd"),
    weight_kg: weightNum,
    kcal_academia: selectedActivities.has("academia") ? num(form.kcal_academia) : null,
    min_academia: selectedActivities.has("academia") ? num(form.min_academia) : null,
    temp_academia: selectedActivities.has("academia") ? num(form.temp_academia) : null,
    bpm_academia: selectedActivities.has("academia") ? num(form.bpm_academia) : null,
    kcal_boxe: selectedActivities.has("boxe") ? num(form.kcal_boxe) : null,
    min_boxe: selectedActivities.has("boxe") ? num(form.min_boxe) : null,
    temp_boxe: selectedActivities.has("boxe") ? num(form.temp_boxe) : null,
    bpm_boxe: selectedActivities.has("boxe") ? num(form.bpm_boxe) : null,
    kcal_surf: selectedActivities.has("surf") ? num(form.kcal_surf) : null,
    min_surf: selectedActivities.has("surf") ? num(form.min_surf) : null,
    temp_surf: selectedActivities.has("surf") ? num(form.temp_surf) : null,
    bpm_surf: selectedActivities.has("surf") ? num(form.bpm_surf) : null,
    kcal_ciclismo: selectedActivities.has("ciclismo") ? num(form.kcal_ciclismo) : null,
    min_ciclismo: selectedActivities.has("ciclismo") ? num(form.min_ciclismo) : null,
    temp_ciclismo: selectedActivities.has("ciclismo") ? num(form.temp_ciclismo) : null,
    bpm_ciclismo: selectedActivities.has("ciclismo") ? num(form.bpm_ciclismo) : null,
    kcal_crossfit: selectedActivities.has("crossfit") ? num(form.kcal_crossfit) : null,
    min_crossfit: selectedActivities.has("crossfit") ? num(form.min_crossfit) : null,
    kcal_musculacao: selectedActivities.has("musculacao") ? num(form.kcal_musculacao) : null,
    min_musculacao: selectedActivities.has("musculacao") ? num(form.min_musculacao) : null,
    kcal_corrida: null, min_corrida: null, temp_corrida: null, bpm_corrida: null,
    kcal_outros: num(form.kcal_outros),
    min_sauna: num(form.min_sauna), temp_sauna: num(form.temp_sauna), bpm_sauna: num(form.bpm_sauna),
    surplus_deficit_kcal: num(form.surplus),
    protein_g: null, carbs_g: null, water_consumed_ml: null,
    whoop_strain: existing?.whoop_strain ?? null,
    whoop_recovery: existing?.whoop_recovery ?? null,
    whoop_kcal: existing?.whoop_kcal ?? null,
    created_at: "", updated_at: "",
  };

  const targets = weightNum ? computeDailyCalculations(previewLog, today, userMetrics) : null;

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

    ACTIVITIES.forEach(({ key, hasTempBpm }) => {
      const active = selectedActivities.has(key);
      (payload as any)[`kcal_${key}`] = active ? num(form[`kcal_${key}` as keyof FormState]) : null;
      (payload as any)[`min_${key}`] = active ? num(form[`min_${key}` as keyof FormState]) : null;
      if (hasTempBpm) {
        (payload as any)[`temp_${key}`] = active ? num(form[`temp_${key}` as keyof FormState]) : null;
        (payload as any)[`bpm_${key}`] = active ? num(form[`bpm_${key}` as keyof FormState]) : null;
      }
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

        {/* ── Nutrição (metas calculadas) ────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 gap-1">
          <SectionLabel label="Nutrição 🥗" />
          {targets ? (
            <>
              <TargetRow icon="🥩" label="Proteína mínima" value={`${Math.round(targets.min_protein_g)} g`} />
              <TargetRow icon="🍚" label="Carboidrato mínimo" value={`${Math.round(targets.min_carb_g)} g`} />
              <TargetRow icon="💧" label="Água necessária" value={formatWater(targets.water_ml)} />
              <TargetRow icon="🔥" label="TDEE estimado" value={`${Math.round(targets.tdee_kcal).toLocaleString()} kcal`} />
            </>
          ) : (
            <Text className="text-surface-500 text-sm py-2">
              Informe o peso para ver as metas de nutrição.
            </Text>
          )}
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
                  <Text className={`text-sm font-semibold ${active ? "text-white" : "text-surface-500"}`}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {ACTIVITIES.filter(({ key }) => selectedActivities.has(key)).map(
            ({ key, label, icon, hasTempBpm }) => (
              <View key={key} className="border-t border-surface-700/50 pt-3 gap-2">
                <Text className="text-white text-sm font-bold">{icon} {label}</Text>
                <View className="flex-row gap-2">
                  <NumInput
                    label="kcal"
                    value={form[`kcal_${key}` as keyof FormState]}
                    onChange={(v) => set(`kcal_${key}` as keyof FormState, v)}
                    unit="kcal"
                  />
                  <NumInput
                    label="Duração"
                    value={form[`min_${key}` as keyof FormState]}
                    onChange={(v) => set(`min_${key}` as keyof FormState, v)}
                    unit="min"
                  />
                </View>
                {hasTempBpm && (
                  <View className="flex-row gap-2">
                    <NumInput
                      label="Temperatura"
                      value={form[`temp_${key}` as keyof FormState]}
                      onChange={(v) => set(`temp_${key}` as keyof FormState, v)}
                      unit="°C"
                      decimal
                    />
                    <NumInput
                      label="FC média"
                      value={form[`bpm_${key}` as keyof FormState]}
                      onChange={(v) => set(`bpm_${key}` as keyof FormState, v)}
                      unit="bpm"
                    />
                  </View>
                )}
              </View>
            )
          )}
        </View>

        {/* ── Sauna (colapsável) ────────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl overflow-hidden">
          <TouchableOpacity
            onPress={() => setSaunaOpen((v) => !v)}
            className="flex-row items-center justify-between p-4"
          >
            <SectionLabel label="Sauna 🧖" />
            <Ionicons
              name={saunaOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color="#72737f"
            />
          </TouchableOpacity>
          {saunaOpen && (
            <View className="px-4 pb-4 gap-2">
              <View className="flex-row gap-2">
                <NumInput label="Duração" value={form.min_sauna} onChange={(v) => set("min_sauna", v)} unit="min" />
                <NumInput label="Temperatura" value={form.temp_sauna} onChange={(v) => set("temp_sauna", v)} unit="°C" decimal />
                <NumInput label="FC média" value={form.bpm_sauna} onChange={(v) => set("bpm_sauna", v)} unit="bpm" />
              </View>
            </View>
          )}
        </View>

        {/* ── Outros (colapsável) ───────────────────────── */}
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl overflow-hidden">
          <TouchableOpacity
            onPress={() => setOutrosOpen((v) => !v)}
            className="flex-row items-center justify-between p-4"
          >
            <SectionLabel label="Outros" />
            <Ionicons
              name={outrosOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color="#72737f"
            />
          </TouchableOpacity>
          {outrosOpen && (
            <View className="px-4 pb-4">
              <NumInput
                label="Kcal outras atividades"
                value={form.kcal_outros}
                onChange={(v) => set("kcal_outros", v)}
                unit="kcal"
              />
            </View>
          )}
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
