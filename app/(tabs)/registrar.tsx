import { useState, useCallback, useRef } from "react";
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
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { addDays, format, parseISO, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDailyLog, useUpsertDailyLog } from "@/hooks/useDailyLog";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { DailyLog } from "@/types";
import { SectionLabel } from "@/components/ui/Card";
import { ProviderSyncPanel } from "@/components/ProviderSyncPanel";
import { computeDailyCalculations, formatWater } from "@/utils/calculations";
import { Ionicons } from "@expo/vector-icons";

type ActivityKey = "boxe" | "surf" | "ciclismo" | "crossfit" | "musculacao";

const ACTIVITIES: {
  key: ActivityKey;
  label: string;
  icon: string;
  hasTempBpm: boolean;
}[] = [
  { key: "boxe", label: "Boxe", icon: "🥊", hasTempBpm: true },
  { key: "surf", label: "Surf", icon: "🏄", hasTempBpm: true },
  { key: "ciclismo", label: "Ciclismo", icon: "🚴", hasTempBpm: true },
  { key: "crossfit", label: "CrossFit", icon: "⚡", hasTempBpm: false },
  { key: "musculacao", label: "Musculação", icon: "💪", hasTempBpm: true },
];

type FormState = {
  weight: string;
  surplus: string;
  // boxe
  kcal_boxe: string; min_boxe: string; temp_boxe: string; bpm_boxe: string;
  // surf
  kcal_surf: string; min_surf: string; temp_surf: string; bpm_surf: string;
  // ciclismo
  kcal_ciclismo: string; min_ciclismo: string; temp_ciclismo: string; bpm_ciclismo: string;
  // crossfit (no temp/bpm in DB)
  kcal_crossfit: string; min_crossfit: string;
  // musculacao
  kcal_musculacao: string; min_musculacao: string; temp_musculacao: string; bpm_musculacao: string;
  // sauna
  min_sauna: string; temp_sauna: string; bpm_sauna: string;
  // outros
  kcal_outros: string;
};

const EMPTY_FORM: FormState = {
  weight: "", surplus: "",
  kcal_boxe: "", min_boxe: "", temp_boxe: "", bpm_boxe: "",
  kcal_surf: "", min_surf: "", temp_surf: "", bpm_surf: "",
  kcal_ciclismo: "", min_ciclismo: "", temp_ciclismo: "", bpm_ciclismo: "",
  kcal_crossfit: "", min_crossfit: "",
  kcal_musculacao: "", min_musculacao: "", temp_musculacao: "", bpm_musculacao: "",
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
  signed = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
  decimal?: boolean;
  signed?: boolean;
}) {
  const isNegative = signed && value.startsWith("-");
  const displayValue = signed ? value.replace(/^-/, "") : value;

  const handleSignedChange = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    onChange(isNegative && clean ? `-${clean}` : clean);
  };

  const toggleSign = () => {
    if (!value) return;
    onChange(isNegative ? value.slice(1) : `-${value}`);
  };

  return (
    <View className="flex-1 gap-1.5" style={{ minWidth: 0 }}>
      <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
      <View className="flex-row gap-1.5" style={{ minWidth: 0 }}>
        {signed && (
          <TouchableOpacity
            onPress={toggleSign}
            className={`items-center justify-center rounded-xl px-3 border ${
              isNegative
                ? "bg-red-500/15 border-red-500/30"
                : "bg-surface-700/50 border-surface-700"
            }`}
          >
            <Text className={`text-base font-bold ${isNegative ? "text-red-400" : "text-surface-400"}`}>
              {isNegative ? "−" : "+"}
            </Text>
          </TouchableOpacity>
        )}
        <View
          className="flex-1 flex-row items-center bg-surface-700/50 border border-surface-700 rounded-xl px-3 py-2.5"
          style={{ minWidth: 0 }}
        >
          <TextInput
            className="flex-1 text-white text-sm"
            style={{ minWidth: 0, padding: 0 }}
            value={signed ? displayValue : value}
            onChangeText={signed ? handleSignedChange : onChange}
            keyboardType={decimal ? "decimal-pad" : "number-pad"}
            placeholder={placeholder}
            placeholderTextColor="#4a4b58"
            selectTextOnFocus
          />
          {unit && (
            <Text className="text-surface-500 text-xs font-medium ml-1 shrink-0">{unit}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function SyncedStat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <View className="flex-1 gap-1.5" style={{ minWidth: 0 }}>
      <Text className="text-surface-500 text-xs font-semibold">{label}</Text>
      <View
        className="flex-row items-center bg-surface-700/30 border border-surface-700/50 rounded-xl px-3 py-2.5"
        style={{ minWidth: 0 }}
      >
        <Text className="flex-1 text-white text-sm" style={{ minWidth: 0 }}>
          {String(value)}
        </Text>
        {unit && (
          <Text className="text-surface-500 text-xs font-medium ml-1 shrink-0">{unit}</Text>
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
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function str(v: number | null | undefined): string {
  return v != null ? v.toString() : "";
}

function sumNullable(...values: Array<number | null | undefined>): number | null {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function validateNumber(
  value: string,
  label: string,
  errors: string[],
  options: { min?: number; max?: number; integer?: boolean } = {}
) {
  const raw = value.trim();
  if (!raw) return;

  const n = num(raw);
  if (n == null) {
    errors.push(`${label}: informe um número válido.`);
    return;
  }
  if (options.integer && !Number.isInteger(n)) {
    errors.push(`${label}: informe um número inteiro.`);
  }
  if (options.min != null && n < options.min) {
    errors.push(`${label}: mínimo ${options.min}.`);
  }
  if (options.max != null && n > options.max) {
    errors.push(`${label}: máximo ${options.max}.`);
  }
}

export default function RegistrarScreen() {
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const saveRedirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [today, setToday] = useState(() =>
    dateParam ? parseISO(String(dateParam)) : new Date()
  );
  const [saunaOpen, setSaunaOpen] = useState(false);
  const [outrosOpen, setOutrosOpen] = useState(false);
  const [saveRedirecting, setSaveRedirecting] = useState(false);
  const isToday = format(today, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  useFocusEffect(
    useCallback(() => {
      if (dateParam) {
        setToday(parseISO(String(dateParam)));
      }
    }, [dateParam])
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
        const val = key === "musculacao"
          ? sumNullable(existing.min_musculacao, existing.min_academia)
          : existing[`min_${key}` as keyof DailyLog];
        if (typeof val === "number" && val > 0) active.add(key);
      });
      setSelectedActivities(active);
      setForm({
        weight: str(existing.weight_kg),
        surplus: str(existing.surplus_deficit_kcal),
        kcal_boxe: str(existing.kcal_boxe), min_boxe: str(existing.min_boxe),
        temp_boxe: str(existing.temp_boxe), bpm_boxe: str(existing.bpm_boxe),
        kcal_surf: str(existing.kcal_surf), min_surf: str(existing.min_surf),
        temp_surf: str(existing.temp_surf), bpm_surf: str(existing.bpm_surf),
        kcal_ciclismo: str(existing.kcal_ciclismo), min_ciclismo: str(existing.min_ciclismo),
        temp_ciclismo: str(existing.temp_ciclismo), bpm_ciclismo: str(existing.bpm_ciclismo),
        kcal_crossfit: str(existing.kcal_crossfit), min_crossfit: str(existing.min_crossfit),
        kcal_musculacao: str(sumNullable(existing.kcal_musculacao, existing.kcal_academia)),
        min_musculacao: str(sumNullable(existing.min_musculacao, existing.min_academia)),
        temp_musculacao: str(existing.temp_musculacao ?? existing.temp_academia),
        bpm_musculacao: str(existing.bpm_musculacao ?? existing.bpm_academia),
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
    kcal_academia: null,
    min_academia: null,
    temp_academia: null,
    bpm_academia: null,
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
    temp_musculacao: selectedActivities.has("musculacao") ? num(form.temp_musculacao) : null,
    bpm_crossfit: existing?.bpm_crossfit ?? null,
    bpm_musculacao: selectedActivities.has("musculacao") ? num(form.bpm_musculacao) : null,
    kcal_corrida: null, min_corrida: null, temp_corrida: null, bpm_corrida: null,
    kcal_outros: num(form.kcal_outros),
    min_outros: existing?.min_outros ?? null,
    min_sauna: num(form.min_sauna), temp_sauna: num(form.temp_sauna), bpm_sauna: num(form.bpm_sauna),
    surplus_deficit_kcal: num(form.surplus),
    protein_g: null, carbs_g: null, water_consumed_ml: null,
    whoop_strain: existing?.whoop_strain ?? null,
    whoop_recovery: existing?.whoop_recovery ?? null,
    whoop_kcal: existing?.whoop_kcal ?? null,
    bpm_outros: existing?.bpm_outros ?? null,
    created_at: "", updated_at: "",
  };

  const targets = weightNum ? computeDailyCalculations(previewLog, today, userMetrics) : null;

  useFocusEffect(
    useCallback(() => {
      setSaveRedirecting(false);
      if (saveRedirectTimeoutRef.current) {
        clearTimeout(saveRedirectTimeoutRef.current);
      }
    }, [])
  );

  async function handleSave() {
    const errors: string[] = [];
    validateNumber(form.weight, "Peso", errors, { min: 20, max: 300 });
    validateNumber(form.surplus, "Superávit / Déficit", errors, { min: -10000, max: 10000 });
    validateNumber(form.min_sauna, "Sauna duração", errors, { min: 0, max: 240 });
    validateNumber(form.temp_sauna, "Sauna temperatura", errors, { min: 0, max: 130 });
    validateNumber(form.bpm_sauna, "Sauna FC média", errors, { min: 30, max: 240, integer: true });
    validateNumber(form.kcal_outros, "Kcal outras atividades", errors, { min: 0, max: 10000 });

    ACTIVITIES.forEach(({ key, label, hasTempBpm }) => {
      if (!selectedActivities.has(key)) return;
      validateNumber(form[`kcal_${key}` as keyof FormState], `${label} kcal`, errors, { min: 0, max: 10000 });
      validateNumber(form[`min_${key}` as keyof FormState], `${label} duração`, errors, { min: 0, max: 1440 });
      if (hasTempBpm) {
        validateNumber(form[`temp_${key}` as keyof FormState], `${label} temperatura`, errors, { min: -30, max: 70 });
        validateNumber(form[`bpm_${key}` as keyof FormState], `${label} FC média`, errors, { min: 30, max: 240, integer: true });
      }
    });

    if (errors.length > 0) {
      Alert.alert("Revise os dados", errors.join("\n"));
      return;
    }

    const payload: Partial<DailyLog> & { date: string } = {
      date: format(today, "yyyy-MM-dd"),
      weight_kg: num(form.weight),
      surplus_deficit_kcal: num(form.surplus),
      min_sauna: num(form.min_sauna),
      temp_sauna: num(form.temp_sauna),
      bpm_sauna: num(form.bpm_sauna),
      kcal_outros: num(form.kcal_outros),
      kcal_academia: null,
      min_academia: null,
      temp_academia: null,
      bpm_academia: null,
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
      if (saveRedirectTimeoutRef.current) {
        clearTimeout(saveRedirectTimeoutRef.current);
      }
      setSaveRedirecting(true);
      saveRedirectTimeoutRef.current = setTimeout(() => {
        router.replace("/(tabs)/hoje");
      }, 900);
    } catch (err: unknown) {
      setSaveRedirecting(false);
      const message = err instanceof Error ? err.message : "Nao foi possivel salvar.";
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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-10 gap-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {/* Header */}
        <View className="flex-row justify-between items-end">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest capitalize">
              {dateLabel}
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">Registrar</Text>
          </View>
          <View className="flex-row items-center gap-0.5 pb-1">
            <TouchableOpacity
              onPress={() => setToday((d) => subDays(d, 1))}
              className="p-2"
            >
              <Ionicons name="chevron-back" size={20} color="#72737f" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setToday((d) => addDays(d, 1))}
              disabled={isToday}
              className="p-2"
            >
              <Ionicons name="chevron-forward" size={20} color={isToday ? "#2c2d36" : "#72737f"} />
            </TouchableOpacity>
          </View>
        </View>

        {saveRedirecting && (
          <View className="bg-brand-500/10 border border-brand-500/25 rounded-2xl px-4 py-3 flex-row items-center gap-3">
            <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
            <View className="flex-1">
              <Text className="text-brand-400 text-sm font-bold">Registro salvo</Text>
              <Text className="text-surface-400 text-xs mt-0.5">
                Seu registro foi atualizado com sucesso. Abrindo Hoje...
              </Text>
            </View>
          </View>
        )}

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
              signed
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

          <ProviderSyncPanel variant="compact" />

          {/* Corrida — sincronizada do Garmin (read-only) */}
          {(existing?.kcal_corrida != null || existing?.min_corrida != null) && (
            <View className="border-t border-surface-700/50 pt-3 gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-sm font-bold">🏃 Corrida</Text>
                <View className="bg-blue-500/15 border border-blue-500/30 rounded-lg px-2 py-0.5">
                  <Text className="text-blue-400 text-xs font-semibold">Garmin</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                {existing.kcal_corrida != null && (
                  <SyncedStat label="kcal" value={existing.kcal_corrida} unit="kcal" />
                )}
                {existing.min_corrida != null && (
                  <SyncedStat label="Duração" value={existing.min_corrida} unit="min" />
                )}
              </View>
              <View className="flex-row gap-2">
                <SyncedStat
                  label="Temperatura"
                  value={existing?.temp_corrida != null ? existing.temp_corrida : "—"}
                  unit={existing?.temp_corrida != null ? "°C" : undefined}
                />
                <SyncedStat
                  label="FC média"
                  value={existing?.bpm_corrida != null ? existing.bpm_corrida : "—"}
                  unit={existing?.bpm_corrida != null ? "bpm" : undefined}
                />
              </View>
            </View>
          )}

          {/* Whoop — sincronizado (read-only) */}
          {(existing?.whoop_kcal != null || existing?.whoop_strain != null) && (
            <View className="border-t border-surface-700/50 pt-3 gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-sm font-bold">📡 Whoop</Text>
                <View className="bg-purple-500/15 border border-purple-500/30 rounded-lg px-2 py-0.5">
                  <Text className="text-purple-400 text-xs font-semibold">Whoop</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                {existing.whoop_kcal != null && (
                  <SyncedStat label="kcal" value={existing.whoop_kcal} unit="kcal" />
                )}
                {existing.whoop_strain != null && (
                  <SyncedStat label="Strain" value={existing.whoop_strain} />
                )}
                {existing.whoop_recovery != null && (
                  <SyncedStat label="Recovery" value={`${existing.whoop_recovery}%`} />
                )}
              </View>
            </View>
          )}

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
          disabled={isPending || saveRedirecting}
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
