import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useBiometrics } from "@/hooks/useBiometrics";
import { supabase } from "@/lib/supabase";
import { getProfile, upsertProfile } from "@/lib/api";
import { SyncCandidate } from "@/types";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";

type SyncState = "idle" | "loading" | "success" | "error";

function SectionTitle({ title }: { title: string }) {
  return (
    <Text className="text-surface-600 text-xs font-semibold uppercase tracking-wider mt-4 mb-2 px-1">
      {title}
    </Text>
  );
}

function SettingsRow({
  icon,
  label,
  sub,
  action,
  actionLabel,
  actionColor = "text-brand-400",
  loading = false,
}: {
  icon: string;
  label: string;
  sub?: string;
  action?: () => void;
  actionLabel?: string;
  actionColor?: string;
  loading?: boolean;
}) {
  return (
    <View className="bg-surface-800 rounded-2xl px-4 py-3 flex-row items-center gap-3 mb-2">
      <Text className="text-xl">{icon}</Text>
      <View className="flex-1">
        <Text className="text-white font-medium">{label}</Text>
        {sub && <Text className="text-surface-600 text-xs mt-0.5">{sub}</Text>}
      </View>
      {action && actionLabel && (
        <TouchableOpacity onPress={action} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#22c55e" />
          ) : (
            <Text className={`text-sm font-semibold ${actionColor}`}>
              {actionLabel}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

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
      // Fall through to text/message handling.
    }
  }
  if (context && typeof context.text === "function") {
    try {
      const text = await context.text();
      if (text) return text;
    } catch {
      // Fall through to the Supabase client message.
    }
  }
  return error?.message ?? "Sincronizacao falhou.";
}

export default function ConfiguracoesScreen() {
  const { signOut, user } = useAuthStore();
  const { isAvailable, isEnabled, enableBiometrics, disableBiometrics } = useBiometrics();
  const qc = useQueryClient();
  const [whoopSync, setWhoopSync] = useState<SyncState>("idle");
  const [garminSync, setGarminSync] = useState<SyncState>("idle");
  const [syncProvider, setSyncProvider] = useState<"whoop" | "garmin" | null>(null);
  const [candidates, setCandidates] = useState<SyncCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    birth_date: "1996-07-01",
    height_cm: "172",
  });

  const { data: profile } = useQuery({
    queryKey: ["user_profile"],
    queryFn: getProfile,
  });

  const { mutateAsync: saveProfile, isPending: savingProfile } = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_profile"] }),
  });

  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      name: profile.name ?? "",
      birth_date: profile.birth_date ?? "1996-07-01",
      height_cm: String(profile.height_cm ?? 172),
    });
  }, [profile]);

  async function callSyncFunction(
    provider: "whoop" | "garmin",
    mode: "list" | "import",
    ids: string[] = []
  ) {
    const { data, error } = await supabase.functions.invoke(`sync-${provider}`, {
      body: { mode, ids },
    });
    if (error) {
      throw new Error(await extractFunctionError(error));
    }
    if (data?.error || data?.fallback) {
      throw new Error(formatFunctionErrorPayload(data));
    }
    return data;
  }

  async function previewSync(provider: "whoop" | "garmin") {
    const setState = provider === "whoop" ? setWhoopSync : setGarminSync;
    setState("loading");
    try {
      const data = await callSyncFunction(provider, "list");
      const list = (data.candidates ?? []) as SyncCandidate[];
      setCandidates(list);
      setSelectedIds(new Set());
      setSyncProvider(provider);
      setState("success");
    } catch (err: any) {
      setState("error");
      Alert.alert(`Erro ${provider === "whoop" ? "Whoop" : "Garmin"}`, err.message);
    } finally {
      setTimeout(() => setState("idle"), 3000);
    }
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
      const data = await callSyncFunction(provider, "import", ids);
      setState("success");
      setSyncProvider(null);
      setCandidates([]);
      setSelectedIds(new Set());
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

  async function handleSaveProfile() {
    const height = Number(profileForm.height_cm.replace(",", "."));
    if (!Number.isFinite(height) || height < 120 || height > 230) {
      Alert.alert("Revise o perfil", "Altura deve ficar entre 120 e 230 cm.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(profileForm.birth_date)) {
      Alert.alert("Revise o perfil", "Data de nascimento deve usar YYYY-MM-DD.");
      return;
    }

    try {
      await saveProfile({
        name: profileForm.name.trim(),
        birth_date: profileForm.birth_date,
        height_cm: Math.round(height),
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err: any) {
      Alert.alert("Erro", err.message);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sair", "Deseja desconectar da sua conta?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
          } finally {
            qc.clear();
            router.replace("/(auth)/login");
          }
        },
      },
    ]);
  }

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

  return (
    <>
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-14 pb-10"
    >
      <View className="flex-row items-center gap-3 mb-6">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-brand-400 text-base">← Voltar</Text>
        </TouchableOpacity>
        <Text className="text-white text-2xl font-bold">Configurações</Text>
      </View>

      {/* ── Segurança ─── */}
      <SectionTitle title="Segurança" />
      {isAvailable && (
        <SettingsRow
          icon="🔒"
          label="Biometria"
          sub={isEnabled ? "Ativada — toque para desativar" : "Desativada — toque para ativar"}
          action={isEnabled ? disableBiometrics : enableBiometrics}
          actionLabel={isEnabled ? "Desativar" : "Ativar"}
          actionColor={isEnabled ? "text-red-400" : "text-brand-400"}
        />
      )}

      {/* ── Integrações ─── */}
      <SectionTitle title="Perfil" />
      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2 gap-3">
        <Text className="text-surface-600 text-xs leading-5">
          Altura e nascimento entram no calculo do gasto diario.
        </Text>
        <View className="gap-1.5">
          <Text className="text-surface-500 text-xs font-semibold">Nome</Text>
          <TextInput
            className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
            value={profileForm.name}
            onChangeText={(value) => setProfileForm((current) => ({ ...current, name: value }))}
            placeholder="Diego"
            placeholderTextColor="#4a4b58"
          />
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-1.5">
            <Text className="text-surface-500 text-xs font-semibold">Nascimento</Text>
            <TextInput
              className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
              value={profileForm.birth_date}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, birth_date: value }))}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#4a4b58"
            />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="text-surface-500 text-xs font-semibold">Altura</Text>
            <TextInput
              className="bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3"
              value={profileForm.height_cm}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, height_cm: value }))}
              keyboardType="number-pad"
              placeholder="172"
              placeholderTextColor="#4a4b58"
            />
          </View>
        </View>
        <TouchableOpacity
          className="bg-brand-500 rounded-xl py-3 items-center"
          onPress={handleSaveProfile}
          disabled={savingProfile}
        >
          {savingProfile ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-sm">Salvar perfil</Text>
          )}
        </TouchableOpacity>
        {profileSaved && (
          <Text className="text-brand-400 text-xs font-semibold text-center">
            Perfil salvo com sucesso.
          </Text>
        )}
      </View>

      <SectionTitle title="Integrações" />

      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2">
        <View className="flex-row items-center gap-3">
          <Text className="text-xl">⌚</Text>
          <View className="flex-1">
            <Text className="text-white font-medium">Whoop</Text>
            <Text className="text-surface-600 text-xs mt-0.5">
              Conecta via OAuth e lista atividades recentes para importar kcal, tempo e FC media
            </Text>
          </View>
          {whoopSync === "loading" && <ActivityIndicator size="small" color="#22c55e" />}
        </View>
        <View className="flex-row gap-2 mt-3">
          <TouchableOpacity
            className="flex-1 bg-surface-700 rounded-xl py-3 items-center"
            onPress={connectWhoop}
            disabled={whoopSync === "loading"}
          >
            <Text className="text-white font-bold text-sm">Conectar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-brand-500 rounded-xl py-3 items-center"
            onPress={() => previewSync("whoop")}
            disabled={whoopSync === "loading"}
          >
            <Text className="text-white font-bold text-sm">
              {whoopSync === "success" ? "Feito" : whoopSync === "error" ? "Falhou" : "Verificar"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <SettingsRow
        icon="🏃"
        label="Garmin Connect"
        sub="Lista corridas e importa intervalos sem kcal duplicada"
        action={() => previewSync("garmin")}
        actionLabel={
          garminSync === "success" ? "✓ Feito" :
          garminSync === "error" ? "Falhou" : "Verificar"
        }
        actionColor={
          garminSync === "success" ? "text-brand-400" :
          garminSync === "error" ? "text-red-400" : "text-brand-400"
        }
        loading={garminSync === "loading"}
      />

      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2">
        <Text className="text-surface-600 text-xs leading-5">
          O Whoop preenche atividades no registro diario. O Garmin cria corridas com intervalos. Itens ja importados aparecem travados na selecao.
        </Text>
      </View>

      {/* ── Conta ─── */}
      <SectionTitle title="Conta" />
      <SettingsRow
        icon="🚪"
        label="Sair da conta"
        sub={user?.email ?? ""}
        action={handleSignOut}
        actionLabel="Sair"
        actionColor="text-red-400"
      />

      {/* ── Sobre ─── */}
      <SectionTitle title="Sobre" />
      <View className="bg-surface-800 rounded-2xl px-4 py-3">
        <Text className="text-surface-600 text-xs leading-5">
          Treino & Dieta v1.0.0{"\n"}
          Dados: Supabase (PostgreSQL){"\n"}
          Build: EAS (Expo Application Services)
        </Text>
      </View>
    </ScrollView>

    <BottomSheetModal
      visible={!!syncProvider}
      onClose={() => setSyncProvider(null)}
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
            Selecione somente o que deseja importar. Itens ja importados ficam marcados.
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
              <Text className="text-surface-500 text-sm py-8 text-center">
                Nenhum item encontrado.
              </Text>
            ) : (
              candidates.map((candidate) => {
                const selected = selectedIds.has(candidate.id);
                return (
                  <TouchableOpacity
                    key={candidate.id}
                    disabled={candidate.already_imported}
                    onPress={() => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(candidate.id)) next.delete(candidate.id);
                        else next.add(candidate.id);
                        return next;
                      });
                    }}
                    className={`rounded-2xl px-4 py-3 mb-2 border ${
                      candidate.already_imported
                        ? "bg-surface-700/40 border-surface-700"
                        : selected
                        ? "bg-brand-500/10 border-brand-500/30"
                        : "bg-surface-700/50 border-surface-700"
                    }`}
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
                          <Text className="text-white text-xs font-bold">✓</Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-white text-sm font-bold flex-1">
                            {candidate.name}
                          </Text>
                          {candidate.already_imported && (
                            <Text className="text-brand-400 text-xs font-semibold">Importado</Text>
                          )}
                        </View>
                        <Text className="text-surface-500 text-xs mt-1">
                          {formatCandidateMeta(candidate)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
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
