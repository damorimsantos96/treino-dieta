import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_USER_APP_SETTINGS, DEFAULT_WATER_PRESETS } from "@/constants/appDefaults";
import {
  createWaterIntake,
  deleteWaterIntake,
  deleteWaterPreset,
  getDailyLog,
  getLatestWeightLog,
  getProfile,
  getUserAppSettings,
  getWaterIntakes,
  getWaterPresets,
  saveWaterPreset,
  upsertUserAppSettings,
} from "@/lib/api";
import {
  hasNotificationPermission,
  requestNotificationPermissions,
} from "@/lib/notifications";
import { Card, SectionLabel } from "@/components/ui/Card";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { buildDailyLog } from "@/utils/dailyLog";
import {
  computeDailyCalculations,
  formatWater,
  hydrationProgressStatus,
} from "@/utils/calculations";
import { WaterPreset } from "@/types";

function MetricTile({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <View className="flex-1 bg-surface-700/45 border border-surface-600/40 rounded-2xl p-3 gap-1">
      <Text className="text-surface-500 text-[11px] font-semibold uppercase tracking-wider">
        {label}
      </Text>
      <Text className={`text-lg font-bold ${tone}`}>{value}</Text>
    </View>
  );
}

function PresetButton({
  preset,
  onPress,
}: {
  preset: WaterPreset;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-sky-500/10 border border-sky-500/25 rounded-2xl px-4 py-3 min-w-[110px]"
    >
      <Text className="text-sky-300 text-xs font-semibold uppercase tracking-wider">
        {preset.label}
      </Text>
      <Text className="text-white text-base font-bold mt-1">
        {formatWater(preset.amount_ml)}
      </Text>
    </TouchableOpacity>
  );
}

export default function AguaScreen() {
  const queryClient = useQueryClient();
  const today = new Date();
  const dateStr = format(today, "yyyy-MM-dd");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [presetForm, setPresetForm] = useState<{ id?: string; label: string; amount: string }>({
    label: "",
    amount: "",
  });
  const [confirmDeletePreset, setConfirmDeletePreset] = useState(false);
  const [confirmDeleteIntakeId, setConfirmDeleteIntakeId] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState("");

  const { data: settings } = useQuery({
    queryKey: ["user_app_settings"],
    queryFn: getUserAppSettings,
  });
  const { data: presets = [], isLoading: loadingPresets } = useQuery({
    queryKey: ["water_presets"],
    queryFn: getWaterPresets,
  });
  const { data: intakes = [], isLoading: loadingIntakes } = useQuery({
    queryKey: ["water_intakes", dateStr],
    queryFn: () => getWaterIntakes(dateStr),
  });
  const { data: todayLog, isLoading: loadingLog } = useQuery({
    queryKey: ["daily_log", dateStr],
    queryFn: () => getDailyLog(today),
  });
  const { data: latestWeightLog } = useQuery({
    queryKey: ["daily_log_latest_weight"],
    queryFn: getLatestWeightLog,
  });
  const { data: profile } = useQuery({
    queryKey: ["user_profile"],
    queryFn: getProfile,
  });

  const effectiveSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(settings ?? {}),
  };

  const [settingsForm, setSettingsForm] = useState({
    water_start_time: effectiveSettings.water_start_time,
    water_end_time: effectiveSettings.water_end_time,
    water_reminders_enabled: effectiveSettings.water_reminders_enabled,
    water_reminder_interval_min: String(effectiveSettings.water_reminder_interval_min),
  });

  useEffect(() => {
    setSettingsForm({
      water_start_time: effectiveSettings.water_start_time,
      water_end_time: effectiveSettings.water_end_time,
      water_reminders_enabled: effectiveSettings.water_reminders_enabled,
      water_reminder_interval_min: String(effectiveSettings.water_reminder_interval_min),
    });
  }, [
    effectiveSettings.water_end_time,
    effectiveSettings.water_reminder_interval_min,
    effectiveSettings.water_reminders_enabled,
    effectiveSettings.water_start_time,
  ]);

  const { mutateAsync: saveSettings, isPending: savingSettings } = useMutation({
    mutationFn: upsertUserAppSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user_app_settings"] }),
  });
  const { mutateAsync: savePreset, isPending: savingPreset } = useMutation({
    mutationFn: saveWaterPreset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["water_presets"] }),
  });
  const { mutateAsync: addIntake, isPending: savingIntake } = useMutation({
    mutationFn: createWaterIntake,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["water_intakes", dateStr] }),
        queryClient.invalidateQueries({ queryKey: ["daily_log", dateStr] }),
        queryClient.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
    },
  });
  const { mutateAsync: removeIntake } = useMutation({
    mutationFn: deleteWaterIntake,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["water_intakes", dateStr] }),
        queryClient.invalidateQueries({ queryKey: ["daily_log", dateStr] }),
        queryClient.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
    },
  });
  const { mutateAsync: removePreset } = useMutation({
    mutationFn: deleteWaterPreset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["water_presets"] }),
  });

  const hydrationLog = useMemo(() => {
    return buildDailyLog(dateStr, {
      ...(todayLog ?? {}),
      weight_kg: todayLog?.weight_kg ?? latestWeightLog?.weight_kg ?? null,
    });
  }, [dateStr, latestWeightLog?.weight_kg, todayLog]);

  const userMetrics = useMemo(() => ({
    heightCm: profile?.height_cm ?? 172,
    birthDate: profile?.birth_date ? new Date(profile.birth_date) : new Date("1996-07-01"),
  }), [profile?.birth_date, profile?.height_cm]);

  const targetMl = hydrationLog.weight_kg
    ? computeDailyCalculations(hydrationLog, today, userMetrics).water_ml
    : 0;
  const consumedMl = intakes.reduce((sum, intake) => sum + intake.amount_ml, 0);
  const hydrationStatus = hydrationProgressStatus(
    targetMl,
    consumedMl,
    today,
    effectiveSettings.water_start_time,
    effectiveSettings.water_end_time
  );

  const isLoading = loadingPresets || loadingIntakes || loadingLog;
  const dateLabel = format(today, "EEEE, d 'de' MMMM", { locale: ptBR });

  async function movePreset(presetId: string, direction: "up" | "down") {
    const idx = presets.findIndex((p) => p.id === presetId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= presets.length) return;

    const a = presets[idx];
    const b = presets[swapIdx];
    await Promise.all([
      savePreset({ id: a.id, label: a.label, amount_ml: a.amount_ml, sort_order: swapIdx }),
      savePreset({ id: b.id, label: b.label, amount_ml: b.amount_ml, sort_order: idx }),
    ]);
  }

  async function handleQuickAdd(amountMl: number, presetId?: string) {
    await addIntake({
      logged_date: dateStr,
      occurred_at: new Date().toISOString(),
      amount_ml: amountMl,
      preset_id: presetId ?? null,
      source: presetId ? "preset" : "manual",
    });
  }

  async function handleSeedPresets() {
    for (const preset of DEFAULT_WATER_PRESETS) {
      await savePreset(preset);
    }
  }

  async function handleSavePreset() {
    const label = presetForm.label.trim();
    const amount = Number(presetForm.amount.replace(",", "."));
    if (!label) {
      Alert.alert("Revise o preset", "Informe um nome para a quantidade.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
      Alert.alert("Revise o preset", "Informe uma quantidade entre 1 e 5000 ml.");
      return;
    }

    await savePreset({
      id: presetForm.id,
      label,
      amount_ml: Math.round(amount),
      sort_order:
        presetForm.id
          ? presets.find((preset) => preset.id === presetForm.id)?.sort_order ?? 0
          : presets.length,
    });

    setPresetForm({ label: "", amount: "" });
    setPresetOpen(false);
  }

  async function handleSaveSettings() {
    const interval = Number(settingsForm.water_reminder_interval_min.replace(",", "."));
    if (!/^\d{2}:\d{2}$/.test(settingsForm.water_start_time) || !/^\d{2}:\d{2}$/.test(settingsForm.water_end_time)) {
      Alert.alert("Revise a janela", "Use o formato HH:mm para inicio e fim.");
      return;
    }
    if (!Number.isFinite(interval) || interval < 15 || interval > 720) {
      Alert.alert("Revise o intervalo", "O lembrete deve ficar entre 15 e 720 minutos.");
      return;
    }

    let remindersEnabled = settingsForm.water_reminders_enabled;
    if (remindersEnabled) {
      const permission = await requestNotificationPermissions();
      if (!hasNotificationPermission(permission)) {
        remindersEnabled = false;
        Alert.alert(
          "Notificacoes desativadas",
          "A permissao nao foi concedida, entao o lembrete foi salvo como desativado."
        );
      }
    }

    await saveSettings({
      water_start_time: settingsForm.water_start_time,
      water_end_time: settingsForm.water_end_time,
      water_reminders_enabled: remindersEnabled,
      water_reminder_interval_min: Math.round(interval),
    });

    setSettingsOpen(false);
  }

  async function handleSaveManual() {
    const amount = Number(manualAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
      Alert.alert("Revise a quantidade", "Informe um valor entre 1 e 5000 ml.");
      return;
    }

    await handleQuickAdd(Math.round(amount));
    setManualAmount("");
    setManualOpen(false);
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-surface-900 items-center justify-center">
        <ActivityIndicator color="#10b981" size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-900">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-10 gap-4"
      >
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest capitalize">
              {dateLabel}
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">Agua</Text>
          </View>
          <TouchableOpacity
            onPress={() => setSettingsOpen(true)}
            className="bg-surface-800 border border-surface-700/60 rounded-xl px-3 py-2.5"
          >
            <Ionicons name="settings-outline" size={16} color="#72737f" />
          </TouchableOpacity>
        </View>

        <Card className="gap-4">
          <SectionLabel label="Meta de hidratacao" />
          {targetMl > 0 ? (
            <>
              <View className="flex-row gap-3">
                <MetricTile label="Meta total" value={formatWater(targetMl)} tone="text-sky-300" />
                <MetricTile label="Consumido" value={formatWater(consumedMl)} tone="text-brand-400" />
                <MetricTile label="Faltam" value={formatWater(hydrationStatus.remainingMl)} tone="text-amber-300" />
              </View>
              <ProgressBar
                label="Progresso do dia"
                current={consumedMl}
                target={Math.max(targetMl, 1)}
                unit="ml"
                barColor="#38bdf8"
                icon="💧"
              />
              <View className="bg-surface-700/40 border border-surface-600/30 rounded-2xl p-3 gap-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                    Ritmo ideal
                  </Text>
                  <Text className="text-white text-sm font-bold">
                    {formatWater(hydrationStatus.expectedMl)} agora
                  </Text>
                </View>
                <Text className={`text-sm font-medium ${hydrationStatus.isBehind ? "text-amber-300" : "text-brand-400"}`}>
                  {hydrationStatus.isBehind
                    ? `Voce esta ${formatWater(Math.abs(hydrationStatus.deltaMl))} abaixo do esperado neste momento.`
                    : "Voce esta acompanhando o ritmo ideal de hidratacao."}
                </Text>
                <Text className="text-surface-500 text-xs">
                  Janela configurada: {effectiveSettings.water_start_time} - {effectiveSettings.water_end_time}
                </Text>
              </View>
              {!todayLog?.weight_kg && latestWeightLog?.weight_kg && (
                <Text className="text-surface-500 text-xs">
                  Meta estimada com base no peso mais recente registrado.
                </Text>
              )}
            </>
          ) : (
            <Text className="text-surface-500 text-sm">
              Registre pelo menos um peso para liberar a meta automatica de agua do dia.
            </Text>
          )}
        </Card>

        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <SectionLabel label="Quantidades salvas" />
            <TouchableOpacity
              onPress={() => {
                setPresetForm({ label: "", amount: "" });
                setPresetOpen(true);
              }}
              className="bg-surface-700 border border-surface-600/40 rounded-xl px-3 py-2"
            >
              <Text className="text-white text-xs font-bold">+ Quantidade</Text>
            </TouchableOpacity>
          </View>

          {presets.length > 0 ? (
            <View className="flex-row flex-wrap gap-3">
              {presets.map((preset) => (
                <PresetButton
                  key={preset.id}
                  preset={preset}
                  onPress={() => handleQuickAdd(preset.amount_ml, preset.id)}
                />
              ))}
            </View>
          ) : (
            <View className="bg-surface-700/35 border border-surface-600/30 rounded-2xl p-4 gap-3">
              <Text className="text-surface-400 text-sm">
                Crie suas quantidades favoritas para adicionar agua com um toque.
              </Text>
              <TouchableOpacity
                onPress={handleSeedPresets}
                className="bg-sky-500/10 border border-sky-500/25 rounded-xl py-3 items-center"
                disabled={savingPreset}
              >
                <Text className="text-sky-300 text-sm font-bold">
                  {savingPreset ? "Criando..." : "Criar sugestoes"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={() => setManualOpen(true)}
            className="bg-brand-500 rounded-2xl py-3.5 items-center"
            disabled={savingIntake}
          >
            <Text className="text-white font-bold text-sm">Adicionar quantidade manual</Text>
          </TouchableOpacity>
        </Card>

        <Card className="gap-3">
          <SectionLabel label="Consumo de hoje" />
          {intakes.length === 0 ? (
            <Text className="text-surface-500 text-sm">
              Nenhum consumo registrado ainda hoje.
            </Text>
          ) : (
            intakes.map((intake) => {
              const confirming = confirmDeleteIntakeId === intake.id;
              return (
                <View
                  key={intake.id}
                  className="py-2.5 border-b border-surface-700/40"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="gap-0.5 flex-1">
                      <Text className="text-white text-sm font-semibold">
                        {formatWater(intake.amount_ml)}
                      </Text>
                      <Text className="text-surface-500 text-xs">
                        {format(new Date(intake.occurred_at), "HH:mm")}
                        {intake.preset?.label ? ` · ${intake.preset.label}` : ""}
                      </Text>
                    </View>
                    {confirming ? (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => setConfirmDeleteIntakeId(null)}
                          className="bg-surface-700 border border-surface-600/40 rounded-xl px-3 py-1.5"
                        >
                          <Text className="text-white text-xs font-semibold">Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            setConfirmDeleteIntakeId(null);
                            removeIntake(intake.id);
                          }}
                          className="bg-red-500 rounded-xl px-3 py-1.5"
                        >
                          <Text className="text-white text-xs font-bold">Remover</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => setConfirmDeleteIntakeId(intake.id)}
                        className="p-2"
                      >
                        <Ionicons name="trash-outline" size={16} color="#f87171" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      <BottomSheetModal visible={presetOpen} onClose={() => { setPresetOpen(false); setConfirmDeletePreset(false); }}>
        <Text className="text-white text-xl font-bold">
          {presetForm.id ? "Editar quantidade" : "Nova quantidade"}
        </Text>
        <View className="gap-1.5">
          <Text className="text-surface-500 text-xs font-semibold">Nome</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={presetForm.label}
            onChangeText={(value) => setPresetForm((current) => ({ ...current, label: value }))}
            placeholder="Ex: Garrafa pequena"
            placeholderTextColor="#4a4b58"
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-surface-500 text-xs font-semibold">Quantidade (ml)</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={presetForm.amount}
            onChangeText={(value) => setPresetForm((current) => ({ ...current, amount: value }))}
            placeholder="500"
            placeholderTextColor="#4a4b58"
            keyboardType="number-pad"
          />
        </View>
        {presetForm.id && !confirmDeletePreset && (
          <TouchableOpacity
            onPress={() => setConfirmDeletePreset(true)}
            className="bg-red-500/10 border border-red-500/20 rounded-xl py-3 items-center"
          >
            <Text className="text-red-300 font-semibold">Excluir preset</Text>
          </TouchableOpacity>
        )}
        {presetForm.id && confirmDeletePreset && (
          <View className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 gap-2">
            <Text className="text-red-300 text-sm font-semibold text-center">
              Excluir "{presetForm.label}"?
            </Text>
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={() => setConfirmDeletePreset(false)}
                className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-2.5 items-center"
              >
                <Text className="text-white text-sm font-semibold">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  await removePreset(presetForm.id!);
                  setConfirmDeletePreset(false);
                  setPresetOpen(false);
                  setPresetForm({ label: "", amount: "" });
                }}
                className="flex-1 bg-red-500 rounded-xl py-2.5 items-center"
              >
                <Text className="text-white text-sm font-bold">Excluir</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {presets.length > 0 && (
          <View className="gap-2">
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
              Quantidades salvas
            </Text>
            {presets.map((preset, index) => (
              <View
                key={preset.id}
                className="flex-row items-center gap-1 border-b border-surface-700/40"
              >
                <View className="items-center gap-0.5 pr-1">
                  <TouchableOpacity
                    disabled={index === 0 || savingPreset}
                    onPress={() => movePreset(preset.id, "up")}
                    className="p-1"
                  >
                    <Ionicons
                      name="chevron-up"
                      size={14}
                      color={index === 0 ? "#2c2d36" : "#72737f"}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={index === presets.length - 1 || savingPreset}
                    onPress={() => movePreset(preset.id, "down")}
                    className="p-1"
                  >
                    <Ionicons
                      name="chevron-down"
                      size={14}
                      color={index === presets.length - 1 ? "#2c2d36" : "#72737f"}
                    />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setConfirmDeletePreset(false);
                    setPresetForm({
                      id: preset.id,
                      label: preset.label,
                      amount: String(preset.amount_ml),
                    });
                  }}
                  className="flex-1 flex-row items-center justify-between py-2.5"
                >
                  <Text className="text-white text-sm font-semibold">{preset.label}</Text>
                  <Text className="text-surface-500 text-xs">{formatWater(preset.amount_ml)}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={() => setPresetOpen(false)}
            className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
          >
            <Text className="text-white font-semibold">Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSavePreset}
            className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
            disabled={savingPreset}
          >
            {savingPreset ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold">Salvar</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetModal>

      <BottomSheetModal visible={manualOpen} onClose={() => setManualOpen(false)}>
        <Text className="text-white text-xl font-bold">Adicionar agua</Text>
        <View className="gap-1.5">
          <Text className="text-surface-500 text-xs font-semibold">Quantidade (ml)</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={manualAmount}
            onChangeText={setManualAmount}
            placeholder="350"
            placeholderTextColor="#4a4b58"
            keyboardType="number-pad"
          />
        </View>
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={() => setManualOpen(false)}
            className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
          >
            <Text className="text-white font-semibold">Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSaveManual}
            className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
            disabled={savingIntake}
          >
            {savingIntake ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold">Adicionar</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetModal>

      <BottomSheetModal visible={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <Text className="text-white text-xl font-bold">Configuracoes da agua</Text>
        <Text className="text-surface-500 text-xs -mt-2">
          A meta do dia acompanha o calculo de agua necessario para hoje.
        </Text>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-1.5">
            <Text className="text-surface-500 text-xs font-semibold">Inicio</Text>
            <TextInput
              className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
              value={settingsForm.water_start_time}
              onChangeText={(value) => setSettingsForm((current) => ({ ...current, water_start_time: value }))}
              placeholder="07:00"
              placeholderTextColor="#4a4b58"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="text-surface-500 text-xs font-semibold">Fim</Text>
            <TextInput
              className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
              value={settingsForm.water_end_time}
              onChangeText={(value) => setSettingsForm((current) => ({ ...current, water_end_time: value }))}
              placeholder="22:00"
              placeholderTextColor="#4a4b58"
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        <TouchableOpacity
          onPress={() =>
            setSettingsForm((current) => ({
              ...current,
              water_reminders_enabled: !current.water_reminders_enabled,
            }))
          }
          className="flex-row items-center gap-3"
        >
          <View
            className={`w-5 h-5 rounded-md border-2 items-center justify-center ${
              settingsForm.water_reminders_enabled
                ? "bg-brand-500 border-brand-600"
                : "border-surface-600"
            }`}
          >
            {settingsForm.water_reminders_enabled && (
              <Text className="text-white text-xs font-bold">✓</Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-white text-sm font-semibold">Lembretes no APK</Text>
            <Text className="text-surface-500 text-xs mt-0.5">
              Envia uma notificacao quando voce estiver atras do ritmo ideal.
            </Text>
          </View>
        </TouchableOpacity>
        <View className="gap-1.5">
          <Text className="text-surface-500 text-xs font-semibold">Intervalo do lembrete (min)</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={settingsForm.water_reminder_interval_min}
            onChangeText={(value) =>
              setSettingsForm((current) => ({ ...current, water_reminder_interval_min: value }))
            }
            placeholder="60"
            placeholderTextColor="#4a4b58"
            keyboardType="number-pad"
          />
          <Text className="text-surface-500 text-xs">
            O Android executa essas verificacoes em segundo plano com intervalo minimo de 15 minutos.
          </Text>
        </View>
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={() => setSettingsOpen(false)}
            className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
          >
            <Text className="text-white font-semibold">Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSaveSettings}
            className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
            disabled={savingSettings}
          >
            {savingSettings ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold">Salvar</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </View>
  );
}
