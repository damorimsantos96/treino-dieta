import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useBiometrics } from "@/hooks/useBiometrics";
import { getProfile, getUserAppSettings, upsertProfile, upsertUserAppSettings } from "@/lib/api";
import { DEFAULT_USER_APP_SETTINGS } from "@/constants/appDefaults";
import {
  getHealthConnectAvailability,
  openHealthConnectAppSettings,
  openHealthConnectManager,
  requestHealthConnectPermissions,
  syncHealthConnectWeights,
} from "@/lib/healthConnect";
import { ProviderSyncPanel } from "@/components/ProviderSyncPanel";

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

export default function ConfiguracoesScreen() {
  const { signOut, user } = useAuthStore();
  const { isAvailable, isEnabled, enableBiometrics, disableBiometrics } = useBiometrics();
  const qc = useQueryClient();
  const [profileSaved, setProfileSaved] = useState(false);
  const [healthConnectBusy, setHealthConnectBusy] = useState<"idle" | "permissions" | "sync" | "save">("idle");
  const [profileForm, setProfileForm] = useState({
    name: "",
    birth_date: "1996-07-01",
    height_cm: "172",
  });

  const { data: profile } = useQuery({
    queryKey: ["user_profile"],
    queryFn: getProfile,
  });

  const { data: appSettings } = useQuery({
    queryKey: ["user_app_settings"],
    queryFn: getUserAppSettings,
  });

  const { data: healthConnectAvailability, refetch: refetchHealthConnectAvailability } = useQuery({
    queryKey: ["health_connect_availability"],
    queryFn: getHealthConnectAvailability,
  });

  const { mutateAsync: saveProfile, isPending: savingProfile } = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_profile"] }),
  });

  const { mutateAsync: saveAppSettings } = useMutation({
    mutationFn: upsertUserAppSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_app_settings"] }),
  });

  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      name: profile.name ?? "",
      birth_date: profile.birth_date ?? "1996-07-01",
      height_cm: String(profile.height_cm ?? 172),
    });
  }, [profile]);

  const effectiveAppSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(appSettings ?? {}),
  };

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

  async function handleGrantHealthConnect() {
    setHealthConnectBusy("permissions");
    try {
      const availability = await requestHealthConnectPermissions({ includeBackground: true });
      await saveAppSettings({
        health_connect_enabled: availability.hasWeightAccess,
        health_connect_background_enabled: availability.hasBackgroundAccess,
        health_connect_last_error: availability.hasWeightAccess
          ? null
          : "Permissao de leitura de peso nao foi concedida.",
      });
      await refetchHealthConnectAvailability();
      Alert.alert(
        "Saude Connect",
        availability.hasWeightAccess
          ? availability.hasBackgroundAccess
            ? "Permissoes de peso e leitura em segundo plano concedidas."
            : "Permissao de peso concedida. A leitura em segundo plano ficou desativada."
          : "A permissao de leitura de peso nao foi concedida."
      );
    } catch (err: any) {
      Alert.alert("Saude Connect", err.message);
    } finally {
      setHealthConnectBusy("idle");
    }
  }

  async function handleSaveHealthConnectSettings(next: {
    enabled?: boolean;
    backgroundEnabled?: boolean;
    lastError?: string | null;
    lastSyncAt?: string | null;
  }) {
    setHealthConnectBusy("save");
    try {
      await saveAppSettings({
        health_connect_enabled: next.enabled ?? effectiveAppSettings.health_connect_enabled,
        health_connect_background_enabled:
          next.backgroundEnabled ?? effectiveAppSettings.health_connect_background_enabled,
        health_connect_last_error:
          next.lastError === undefined ? effectiveAppSettings.health_connect_last_error : next.lastError,
        health_connect_last_sync_at:
          next.lastSyncAt === undefined ? effectiveAppSettings.health_connect_last_sync_at : next.lastSyncAt,
      });
    } finally {
      setHealthConnectBusy("idle");
    }
  }

  async function handleToggleHealthConnectEnabled() {
    const nextEnabled = !effectiveAppSettings.health_connect_enabled;

    if (nextEnabled && !healthConnectAvailability?.hasWeightAccess) {
      await handleGrantHealthConnect();
      return;
    }

    await handleSaveHealthConnectSettings({
      enabled: nextEnabled,
      backgroundEnabled: nextEnabled
        ? effectiveAppSettings.health_connect_background_enabled
        : false,
      lastError: null,
    });
  }

  async function handleToggleHealthConnectBackground() {
    const nextBackground = !effectiveAppSettings.health_connect_background_enabled;

    if (nextBackground && !healthConnectAvailability?.hasBackgroundAccess) {
      await handleGrantHealthConnect();
      return;
    }

    await handleSaveHealthConnectSettings({
      enabled: true,
      backgroundEnabled: nextBackground,
      lastError: null,
    });
  }

  async function handleSyncHealthConnectNow() {
    setHealthConnectBusy("sync");
    try {
      const result = await syncHealthConnectWeights();
      await saveAppSettings({
        health_connect_enabled: true,
        health_connect_last_sync_at: new Date().toISOString(),
        health_connect_last_error: null,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["daily_log"] }),
        qc.invalidateQueries({ queryKey: ["daily_logs"] }),
        qc.invalidateQueries({ queryKey: ["health_connect_availability"] }),
      ]);
      Alert.alert(
        "Saude Connect",
        result.syncedDates > 0
          ? `Peso sincronizado em ${result.syncedDates} dia(s).`
          : "Nenhum peso novo foi encontrado para sincronizar agora."
      );
    } catch (err: any) {
      await saveAppSettings({
        health_connect_last_error: err.message,
      }).catch(() => {
        // Ignore persistence failures for the status message.
      });
      Alert.alert("Saude Connect", err.message);
    } finally {
      setHealthConnectBusy("idle");
    }
  }

  async function handleSignOut() {
    async function performSignOut() {
      try {
        await signOut();
      } finally {
        qc.clear();
        router.replace("/(auth)/login");
      }
    }

    if (Platform.OS === "web") {
      if (window.confirm("Deseja desconectar da sua conta?")) {
        await performSignOut();
      }
      return;
    }

    Alert.alert("Sair", "Deseja desconectar da sua conta?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: performSignOut },
    ]);
  }

  const healthConnectSupported = healthConnectAvailability?.platformSupported && healthConnectAvailability?.isAvailable;
  const healthConnectStatusLabel = !healthConnectAvailability?.platformSupported
    ? "Disponivel somente no Android."
    : healthConnectAvailability.needsProviderUpdate
    ? "Atualize o provider do Health Connect neste dispositivo."
    : !healthConnectAvailability.isAvailable
    ? "Health Connect nao esta disponivel agora neste dispositivo."
    : healthConnectAvailability.hasWeightAccess
    ? effectiveAppSettings.health_connect_background_enabled
      ? "Peso sincronizado automaticamente com leitura em segundo plano."
      : "Peso pronto para sincronizar. A leitura em segundo plano esta desligada."
    : "Conceda a permissao de peso para ler os dados vindos do Withings via Health Connect.";


  return (
    <>
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-6 pb-10"
    >
      <View className="mb-6">
        <Text className="text-white text-3xl font-bold tracking-tight">Configurações</Text>
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

      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2 gap-3">
        <View className="flex-row items-center gap-3">
          <Text className="text-xl">⚕️</Text>
          <View className="flex-1">
            <Text className="text-white font-medium">Saude Connect / Withings</Text>
            <Text className="text-surface-600 text-xs mt-0.5">
              Le o peso que chega ao Health Connect e atualiza automaticamente o app.
            </Text>
          </View>
          {healthConnectBusy !== "idle" && (
            <ActivityIndicator size="small" color="#22c55e" />
          )}
        </View>

        <Text className="text-surface-600 text-xs leading-5">
          {healthConnectStatusLabel}
        </Text>

        {!!effectiveAppSettings.health_connect_last_sync_at && (
          <Text className="text-surface-500 text-xs">
            Ultima sincronizacao: {format(new Date(effectiveAppSettings.health_connect_last_sync_at), "dd/MM/yyyy HH:mm")}
          </Text>
        )}
        {!!effectiveAppSettings.health_connect_last_error && (
          <Text className="text-red-300 text-xs leading-5">
            Ultimo erro: {effectiveAppSettings.health_connect_last_error}
          </Text>
        )}

        <TouchableOpacity
          className="flex-row items-center gap-3"
          onPress={handleToggleHealthConnectEnabled}
          disabled={!healthConnectAvailability?.platformSupported || healthConnectBusy !== "idle"}
        >
          <View
            className={`w-5 h-5 rounded-md border-2 items-center justify-center ${
              effectiveAppSettings.health_connect_enabled
                ? "bg-brand-500 border-brand-600"
                : "border-surface-600"
            }`}
          >
            {effectiveAppSettings.health_connect_enabled && (
              <Text className="text-white text-xs font-bold">✓</Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-white text-sm font-semibold">Sincronizacao automatica</Text>
            <Text className="text-surface-500 text-xs mt-0.5">
              Faz a leitura do peso sempre que o app volta para o foreground.
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-row items-center gap-3"
          onPress={handleToggleHealthConnectBackground}
          disabled={!healthConnectSupported || healthConnectBusy !== "idle"}
        >
          <View
            className={`w-5 h-5 rounded-md border-2 items-center justify-center ${
              effectiveAppSettings.health_connect_background_enabled
                ? "bg-brand-500 border-brand-600"
                : "border-surface-600"
            }`}
          >
            {effectiveAppSettings.health_connect_background_enabled && (
              <Text className="text-white text-xs font-bold">✓</Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-white text-sm font-semibold">Leitura em segundo plano</Text>
            <Text className="text-surface-500 text-xs mt-0.5">
              Permite que o Android leia novos pesos em background quando a permissao existir.
            </Text>
          </View>
        </TouchableOpacity>

        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 bg-surface-700 rounded-xl py-3 items-center"
            onPress={handleGrantHealthConnect}
            disabled={!healthConnectAvailability?.platformSupported || healthConnectBusy !== "idle"}
          >
            <Text className="text-white font-bold text-sm">Permitir acesso</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-brand-500 rounded-xl py-3 items-center"
            onPress={handleSyncHealthConnectNow}
            disabled={!healthConnectSupported || !healthConnectAvailability?.hasWeightAccess || healthConnectBusy !== "idle"}
          >
            <Text className="text-white font-bold text-sm">Sincronizar agora</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 bg-surface-700/70 border border-surface-600/40 rounded-xl py-3 items-center"
            onPress={openHealthConnectManager}
            disabled={!healthConnectAvailability?.platformSupported}
          >
            <Text className="text-white font-semibold text-sm">Gerenciar dados</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-surface-700/70 border border-surface-600/40 rounded-xl py-3 items-center"
            onPress={openHealthConnectAppSettings}
            disabled={!healthConnectAvailability?.platformSupported}
          >
            <Text className="text-white font-semibold text-sm">Abrir app</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ProviderSyncPanel />

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

    </>
  );
}
