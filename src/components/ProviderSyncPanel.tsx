import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ActivityKey, SyncCandidate } from "@/types";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";

type SyncState = "idle" | "loading" | "success" | "error";
type ProviderName = "whoop" | "garmin";
type ProviderSyncPanelProps = {
  variant?: "full" | "compact";
};

type ProviderConfig = {
  compactLabel: string;
  fullLabel: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const ACTIVITY_OPTIONS: { key: ActivityKey; label: string }[] = [
  { key: "musculacao", label: "Musculacao" },
  { key: "crossfit", label: "CrossFit" },
  { key: "boxe", label: "Boxe" },
  { key: "surf", label: "Surf" },
  { key: "ciclismo", label: "Ciclismo" },
  { key: "corrida", label: "Corrida" },
  { key: "sauna" as ActivityKey, label: "Sauna" },
  { key: "outros", label: "Outros" },
];

const PROVIDER_CONFIG: Record<ProviderName, ProviderConfig> = {
  whoop: {
    compactLabel: "Whoop",
    fullLabel: "Whoop",
    description: "Conecta via OAuth e lista atividades recentes para importar kcal, tempo e FC media",
    icon: "watch-outline",
  },
  garmin: {
    compactLabel: "Garmin",
    fullLabel: "Garmin Connect",
    description: "Lista corridas e importa intervalos sem kcal duplicada",
    icon: "speedometer-outline",
  },
};

function formatCandidateMeta(candidate: SyncCandidate): string {
  const parts = [
    candidate.date,
    candidate.distance_km ? `${candidate.distance_km.toFixed(2)} km` : null,
    candidate.duration_min ? `${Math.round(candidate.duration_min)} min` : null,
    candidate.kcal ? `${Math.round(candidate.kcal)} kcal` : null,
    candidate.avg_hr ? `${candidate.avg_hr} bpm` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

function formatFunctionErrorPayload(payload: any): string {
  if (!payload || typeof payload !== "object") return "Sincronizacao falhou.";
  const code = payload.code ? `${payload.code}: ` : "";
  const message = payload.error ?? payload.message ?? "Sincronizacao falhou.";
  const stage = payload.stage ? ` Etapa: ${payload.stage}.` : "";
  const requestId = payload.requestId ? ` ID: ${payload.requestId}.` : "";
  return `${code}${message}${stage}${requestId}`.trim();
}

async function extractFunctionError(error: any): Promise<string> {
  const context = error?.context;
  if (context && typeof context.json === "function") {
    try {
      return formatFunctionErrorPayload(await context.json());
    } catch {
      // fall through
    }
  }
  if (context && typeof context.text === "function") {
    try {
      const text = await context.text();
      if (text) return text;
    } catch {
      // fall through
    }
  }
  return error?.message ?? "Sincronizacao falhou.";
}

function showAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

function getProviderState(
  provider: ProviderName,
  whoopSync: SyncState,
  garminSync: SyncState
): SyncState {
  return provider === "whoop" ? whoopSync : garminSync;
}

function getCompactCardClasses(state: SyncState): string {
  if (state === "success") return "bg-brand-500/10 border-brand-500/30";
  if (state === "error") return "bg-red-500/10 border-red-500/30";
  return "bg-surface-700/50 border-surface-700";
}

function getCompactTextClasses(state: SyncState): string {
  if (state === "success") return "text-brand-300";
  if (state === "error") return "text-red-300";
  return "text-white";
}

function getIconColor(state: SyncState): string {
  if (state === "success") return "#34d399";
  if (state === "error") return "#f87171";
  return "#a1a1aa";
}

export function ProviderSyncPanel({ variant = "full" }: ProviderSyncPanelProps) {
  const qc = useQueryClient();
  const [whoopSync, setWhoopSync] = useState<SyncState>("idle");
  const [garminSync, setGarminSync] = useState<SyncState>("idle");
  const [syncProvider, setSyncProvider] = useState<ProviderName | null>(null);
  const [candidates, setCandidates] = useState<SyncCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activityOverrides, setActivityOverrides] = useState<Record<string, ActivityKey>>({});

  const importableCandidates = candidates.filter((candidate) => !candidate.already_imported);
  const selectedImportableCount = importableCandidates.filter((candidate) =>
    selectedIds.has(candidate.id)
  ).length;
  const allImportableSelected =
    importableCandidates.length > 0 && selectedImportableCount === importableCandidates.length;

  function toggleAllCandidates() {
    setSelectedIds(
      allImportableSelected
        ? new Set()
        : new Set(importableCandidates.map((candidate) => candidate.id))
    );
  }

  async function callSyncFunction(
    provider: ProviderName,
    mode: "list" | "import" | "reclassify" | "reimport",
    ids: string[] = [],
    overrides: Record<string, ActivityKey> = {}
  ) {
    const { data, error } = await supabase.functions.invoke(`sync-${provider}`, {
      body: { mode, ids, overrides },
    });
    if (error) throw new Error(await extractFunctionError(error));
    if (data?.error || data?.fallback) throw new Error(formatFunctionErrorPayload(data));
    return data;
  }

  async function connectWhoop() {
    setWhoopSync("loading");
    try {
      const { data, error } = await supabase.functions.invoke("whoop-oauth", {
        body: { mode: "start" },
      });
      if (error) throw new Error(await extractFunctionError(error));
      if (data?.error) throw new Error(formatFunctionErrorPayload(data));
      if (!data?.authUrl) throw new Error("Whoop nao retornou URL de autorizacao.");
      await Linking.openURL(data.authUrl);
      Alert.alert(
        "Conectar Whoop",
        "Autorize o acesso no Whoop. Depois volte para o app e toque em Verificar."
      );
    } catch (err: any) {
      Alert.alert("Erro Whoop", err.message);
    } finally {
      setWhoopSync("idle");
    }
  }

  async function previewSync(provider: ProviderName) {
    const setState = provider === "whoop" ? setWhoopSync : setGarminSync;
    setState("loading");
    try {
      const data = await callSyncFunction(provider, "list");
      if ((data?.repaired ?? 0) > 0) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["daily_log"] }),
          qc.invalidateQueries({ queryKey: ["daily_logs"] }),
        ]);
      }
      const list = (data.candidates ?? []) as SyncCandidate[];
      setCandidates(list);
      setSelectedIds(new Set());
      setActivityOverrides({});
      setSyncProvider(provider);
      setState("success");
    } catch (err: any) {
      setState("error");
      Alert.alert(`Erro ${provider === "whoop" ? "Whoop" : "Garmin"}`, err.message);
    } finally {
      setTimeout(() => setState("idle"), 3000);
    }
  }

  async function importSelected() {
    if (!syncProvider) return;
    const ids = Array.from(selectedIds).filter((id) =>
      candidates.some((candidate) => candidate.id === id && !candidate.already_imported)
    );
    if (ids.length === 0) {
      Alert.alert("Nada selecionado", "Escolha pelo menos um item novo para importar.");
      return;
    }
    const provider = syncProvider;
    const setState = provider === "whoop" ? setWhoopSync : setGarminSync;
    setState("loading");
    try {
      const data = await callSyncFunction(provider, "import", ids, activityOverrides);
      setState("success");
      setSyncProvider(null);
      setCandidates([]);
      setSelectedIds(new Set());
      setActivityOverrides({});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
        qc.invalidateQueries({ queryKey: ["run_activities"] }),
        qc.invalidateQueries({ queryKey: ["run_sessions"] }),
      ]);
      Alert.alert(provider === "whoop" ? "Whoop" : "Garmin", data.message);
    } catch (err: any) {
      setState("error");
      Alert.alert("Erro", err.message);
    } finally {
      setTimeout(() => setState("idle"), 3000);
    }
  }

  async function reimportWhoopActivity(candidate: SyncCandidate) {
    setWhoopSync("loading");
    try {
      const data = await callSyncFunction("whoop", "reimport", [candidate.id]);
      setWhoopSync("success");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
      const refreshed = await callSyncFunction("whoop", "list");
      setCandidates((refreshed.candidates ?? []) as SyncCandidate[]);
      showAlert("Whoop", data.message);
    } catch (err: any) {
      setWhoopSync("error");
      showAlert("Erro", err.message);
    } finally {
      setTimeout(() => setWhoopSync("idle"), 3000);
    }
  }

  async function reimportGarminActivity(candidate: SyncCandidate) {
    setGarminSync("loading");
    try {
      const data = await callSyncFunction("garmin", "reimport", [candidate.id]);
      setGarminSync("success");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
        qc.invalidateQueries({ queryKey: ["run_activities"] }),
        qc.invalidateQueries({ queryKey: ["run_sessions"] }),
      ]);
      const refreshed = await callSyncFunction("garmin", "list");
      setCandidates((refreshed.candidates ?? []) as SyncCandidate[]);
      showAlert("Garmin", data.message);
    } catch (err: any) {
      setGarminSync("error");
      showAlert("Erro", err.message);
    } finally {
      setTimeout(() => setGarminSync("idle"), 3000);
    }
  }

  async function reclassifyWorkout(provider: ProviderName, id: string, key: ActivityKey) {
    const setState = provider === "whoop" ? setWhoopSync : setGarminSync;
    setState("loading");
    try {
      const data = await callSyncFunction(provider, "reclassify", [id], { [id]: key });
      setState("success");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
      ]);
      const refreshed = await callSyncFunction(provider, "list");
      setCandidates((refreshed.candidates ?? []) as SyncCandidate[]);
      showAlert(provider === "whoop" ? "Whoop" : "Garmin", data.message);
    } catch (err: any) {
      setState("error");
      showAlert("Erro", err.message);
    } finally {
      setTimeout(() => setState("idle"), 3000);
    }
  }

  function renderCompactCard(provider: ProviderName) {
    const state = getProviderState(provider, whoopSync, garminSync);
    const config = PROVIDER_CONFIG[provider];

    return (
      <TouchableOpacity
        key={provider}
        onPress={() => previewSync(provider)}
        disabled={state === "loading"}
        className={`flex-1 min-w-[140px] rounded-xl border px-3.5 py-3 ${getCompactCardClasses(state)}`}
      >
        <View className="flex-row items-center gap-2.5">
          <View className="w-8 h-8 rounded-full bg-surface-800 items-center justify-center">
            <Ionicons name={config.icon} size={16} color={getIconColor(state)} />
          </View>
          <Text className={`flex-1 text-sm font-semibold ${getCompactTextClasses(state)}`}>
            {config.compactLabel}
          </Text>
          {state === "loading" && <ActivityIndicator size="small" color="#22c55e" />}
        </View>
      </TouchableOpacity>
    );
  }

  function renderFullRow(provider: ProviderName) {
    const state = getProviderState(provider, whoopSync, garminSync);
    const config = PROVIDER_CONFIG[provider];

    return (
      <View key={provider} className="bg-surface-800 rounded-2xl px-4 py-3 mb-2">
        <View className="flex-row items-center gap-3">
          <View className="w-9 h-9 rounded-full bg-surface-700/70 items-center justify-center">
            <Ionicons name={config.icon} size={18} color={getIconColor(state)} />
          </View>
          <View className="flex-1">
            <Text className="text-white font-medium">{config.fullLabel}</Text>
            <Text className="text-surface-600 text-xs mt-0.5">{config.description}</Text>
          </View>
          {state === "loading" ? (
            <ActivityIndicator size="small" color="#22c55e" />
          ) : provider === "whoop" ? (
            <View className="flex-row items-center gap-3">
              <TouchableOpacity onPress={connectWhoop}>
                <Text className="text-surface-400 text-sm font-semibold">Conectar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => previewSync("whoop")}>
                <Text
                  className={`text-sm font-semibold ${
                    state === "error" ? "text-red-400" : "text-brand-400"
                  }`}
                >
                  {state === "success" ? "Feito" : state === "error" ? "Falhou" : "Verificar"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => previewSync("garmin")}>
              <Text
                className={`text-sm font-semibold ${
                  state === "error" ? "text-red-400" : "text-brand-400"
                }`}
              >
                {state === "success" ? "Feito" : state === "error" ? "Falhou" : "Verificar"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      {variant === "compact" ? (
        <View className="flex-row flex-wrap gap-2">
          {renderCompactCard("whoop")}
          {renderCompactCard("garmin")}
        </View>
      ) : (
        <>
          {renderFullRow("whoop")}
          {renderFullRow("garmin")}
        </>
      )}

      <BottomSheetModal
        visible={!!syncProvider}
        onClose={() => {
          setSyncProvider(null);
          setActivityOverrides({});
        }}
        scroll
        maxHeight="82%"
      >
        <View className="flex-row justify-between items-center">
          <Text className="text-white text-xl font-bold">
            {syncProvider === "whoop" ? "Atividades Whoop" : "Corridas Garmin"}
          </Text>
          <TouchableOpacity onPress={() => setSyncProvider(null)}>
            <Text className="text-surface-500 text-sm font-semibold">Fechar</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-surface-500 text-xs leading-5">
          Selecione somente o que deseja importar. No Garmin, itens ja importados continuam marcados e podem ser reimportados.
        </Text>
        {candidates.length > 0 && (
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-surface-500 text-xs flex-1">
              {selectedImportableCount}/{importableCandidates.length} novos selecionados
            </Text>
            <TouchableOpacity
              onPress={toggleAllCandidates}
              disabled={importableCandidates.length === 0}
              className={`rounded-xl px-3 py-2 ${
                importableCandidates.length === 0 ? "bg-surface-700/40" : "bg-surface-700"
              }`}
            >
              <Text className="text-white text-xs font-bold">
                {allImportableSelected ? "Desmarcar tudo" : "Marcar tudo"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView className="max-h-[360px]">
          {candidates.length === 0 ? (
            <Text className="text-surface-500 text-sm py-8 text-center">Nenhum item encontrado.</Text>
          ) : (
            candidates.map((candidate) => {
              const selected = selectedIds.has(candidate.id);
              const isOutros = candidate.mapping_key === "outros";
              const overrideKey = activityOverrides[candidate.id];
              return (
                <View
                  key={candidate.id}
                  className={`rounded-2xl px-4 py-3 mb-2 border ${
                    candidate.already_imported
                      ? "bg-surface-700/40 border-surface-700"
                      : selected
                        ? "bg-brand-500/10 border-brand-500/30"
                        : "bg-surface-700/50 border-surface-700"
                  }`}
                >
                  <TouchableOpacity
                    disabled={candidate.already_imported}
                    onPress={() => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(candidate.id)) next.delete(candidate.id);
                        else next.add(candidate.id);
                        return next;
                      });
                    }}
                  >
                    <View className="flex-row items-start gap-3">
                      <View
                        className={`w-5 h-5 rounded-md border-2 items-center justify-center mt-0.5 ${
                          selected || candidate.already_imported
                            ? "bg-brand-500 border-brand-600"
                            : "border-surface-600"
                        }`}
                      >
                        {(selected || candidate.already_imported) && (
                          <Ionicons name="checkmark" size={12} color="#ffffff" />
                        )}
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-white text-sm font-bold flex-1">
                            {candidate.name}
                          </Text>
                          {candidate.already_imported && !isOutros && syncProvider !== "whoop" && (
                            <Text className="text-brand-400 text-xs font-semibold">Importado</Text>
                          )}
                          {candidate.already_imported && !isOutros && syncProvider === "whoop" && (
                            <TouchableOpacity
                              onPress={() => {
                                if (Platform.OS === "web") {
                                  if (window.confirm("Reimportar atividade?\nIsso vai atualizar os dados com os valores mais recentes do Whoop.")) {
                                    reimportWhoopActivity(candidate);
                                  }
                                  return;
                                }
                                Alert.alert(
                                  "Reimportar atividade",
                                  "Isso vai atualizar os dados desta atividade com os valores mais recentes do Whoop.",
                                  [
                                    { text: "Cancelar", style: "cancel" },
                                    { text: "Reimportar", onPress: () => reimportWhoopActivity(candidate) },
                                  ]
                                );
                              }}
                              className="bg-sky-500/15 border border-sky-500/30 rounded-lg px-2 py-1"
                            >
                              <Text className="text-sky-300 text-xs font-semibold">Reimportar</Text>
                            </TouchableOpacity>
                          )}
                          {candidate.already_imported && syncProvider === "garmin" && (
                            <TouchableOpacity
                              onPress={() => {
                                if (Platform.OS === "web") {
                                  if (window.confirm("Reimportar corrida?\nIsso vai substituir os intervalos importados anteriormente por essa atividade.")) {
                                    reimportGarminActivity(candidate);
                                  }
                                  return;
                                }
                                Alert.alert(
                                  "Reimportar corrida",
                                  "Isso vai atualizar a corrida Garmin e substituir os intervalos importados anteriormente por essa atividade.",
                                  [
                                    { text: "Cancelar", style: "cancel" },
                                    { text: "Reimportar", onPress: () => reimportGarminActivity(candidate) },
                                  ]
                                );
                              }}
                              className="bg-sky-500/15 border border-sky-500/30 rounded-lg px-2 py-1"
                            >
                              <Text className="text-sky-300 text-xs font-semibold">Reimportar</Text>
                            </TouchableOpacity>
                          )}
                          {candidate.already_imported && isOutros && syncProvider === "whoop" && (
                            <TouchableOpacity
                              onPress={() => {
                                const key = activityOverrides[candidate.id];
                                if (!key || key === "outros") {
                                  if (Platform.OS === "web") {
                                    window.alert("Escolha uma atividade abaixo antes de reclassificar.");
                                  } else {
                                    Alert.alert(
                                      "Selecione o tipo",
                                      "Escolha uma atividade abaixo antes de reclassificar."
                                    );
                                  }
                                  return;
                                }
                                const label = ACTIVITY_OPTIONS.find((option) => option.key === key)?.label;
                                if (Platform.OS === "web") {
                                  if (window.confirm(`Mover para "${label}"?`)) {
                                    reclassifyWorkout("whoop", candidate.id, key);
                                  }
                                  return;
                                }
                                Alert.alert(
                                  "Reclassificar atividade",
                                  `Mover para "${label}"?`,
                                  [
                                    { text: "Cancelar", style: "cancel" },
                                    {
                                      text: "Reclassificar",
                                      onPress: () => reclassifyWorkout("whoop", candidate.id, key),
                                    },
                                  ]
                                );
                              }}
                              className="bg-amber-500/15 border border-amber-500/30 rounded-lg px-2 py-1"
                            >
                              <Text className="text-amber-300 text-xs font-semibold">
                                Reclassificar
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <Text className="text-surface-500 text-xs mt-1">
                          {formatCandidateMeta(candidate)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {isOutros && syncProvider === "whoop" && (
                    <View className="mt-2.5 pt-2.5 border-t border-surface-700/60 gap-2">
                      <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                        Tipo de atividade
                      </Text>
                      <View className="flex-row flex-wrap gap-1.5">
                        {ACTIVITY_OPTIONS.map((option) => {
                          const isSelected = (overrideKey ?? "outros") === option.key;
                          return (
                            <TouchableOpacity
                              key={option.key}
                              onPress={() =>
                                setActivityOverrides((previous) => ({
                                  ...previous,
                                  [candidate.id]: option.key,
                                }))
                              }
                              className={`rounded-xl px-3 py-1.5 border ${
                                isSelected
                                  ? option.key === "outros"
                                    ? "bg-surface-600 border-surface-500"
                                    : "bg-brand-500 border-brand-600"
                                  : "bg-surface-700/60 border-surface-600/40"
                              }`}
                            >
                              <Text
                                className={`text-xs font-semibold ${
                                  isSelected && option.key !== "outros"
                                    ? "text-white"
                                    : "text-surface-400"
                                }`}
                              >
                                {option.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {!candidate.already_imported && (!overrideKey || overrideKey === "outros") && (
                        <Text className="text-amber-400/70 text-xs">
                          Selecione o tipo para evitar que fique em "Outros".
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        <TouchableOpacity
          className="bg-brand-500 rounded-xl py-3.5 items-center"
          onPress={importSelected}
          disabled={whoopSync === "loading" || garminSync === "loading"}
        >
          {whoopSync === "loading" || garminSync === "loading" ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold">Importar selecionados</Text>
          )}
        </TouchableOpacity>
      </BottomSheetModal>
    </>
  );
}
