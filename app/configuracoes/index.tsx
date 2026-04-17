import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/stores/auth";
import { useBiometrics } from "@/hooks/useBiometrics";
import { supabase, supabaseUrl } from "@/lib/supabase";

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

export default function ConfiguracoesScreen() {
  const { signOut, user } = useAuthStore();
  const { isAvailable, isEnabled, enableBiometrics, disableBiometrics } = useBiometrics();
  const [whoopSync, setWhoopSync] = useState<SyncState>("idle");
  const [garminSync, setGarminSync] = useState<SyncState>("idle");

  async function syncWhoop() {
    setWhoopSync("loading");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/sync-whoop`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro desconhecido");
      setWhoopSync("success");
      Alert.alert("✅ Whoop", data.message);
    } catch (err: any) {
      setWhoopSync("error");
      Alert.alert("Erro Whoop", err.message);
    } finally {
      setTimeout(() => setWhoopSync("idle"), 3000);
    }
  }

  async function syncGarmin() {
    setGarminSync("loading");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/sync-garmin`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const data = await res.json();
      if (!res.ok || data.fallback) {
        throw new Error(data.error ?? "API Garmin falhou. Tente novamente.");
      }
      setGarminSync("success");
      Alert.alert("✅ Garmin", data.message);
    } catch (err: any) {
      setGarminSync("error");
      Alert.alert(
        "Erro Garmin",
        `${err.message}\n\nDica: Use o input manual na aba Corridas como fallback.`
      );
    } finally {
      setTimeout(() => setGarminSync("idle"), 3000);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sair", "Deseja desconectar da sua conta?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  return (
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
      <SectionTitle title="Integrações" />

      <SettingsRow
        icon="⌚"
        label="Whoop"
        sub="Sincroniza strain, recovery e calorias dos últimos 30 dias"
        action={syncWhoop}
        actionLabel={
          whoopSync === "success" ? "✓ Feito" :
          whoopSync === "error" ? "Falhou" : "Sincronizar"
        }
        actionColor={
          whoopSync === "success" ? "text-brand-400" :
          whoopSync === "error" ? "text-red-400" : "text-brand-400"
        }
        loading={whoopSync === "loading"}
      />

      <SettingsRow
        icon="🏃"
        label="Garmin Connect"
        sub="Importa corridas recentes automaticamente (API não-oficial)"
        action={syncGarmin}
        actionLabel={
          garminSync === "success" ? "✓ Feito" :
          garminSync === "error" ? "Falhou" : "Sincronizar"
        }
        actionColor={
          garminSync === "success" ? "text-brand-400" :
          garminSync === "error" ? "text-red-400" : "text-brand-400"
        }
        loading={garminSync === "loading"}
      />

      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2">
        <Text className="text-surface-600 text-xs leading-5">
          💡 Se a sincronização do Garmin falhar, use o botão <Text className="text-white">+ Nova</Text> na aba Corridas para inserir manualmente. O fallback é sempre disponível.
        </Text>
      </View>

      {/* ── Whoop OAuth setup ─── */}
      <SectionTitle title="Configurar Whoop" />
      <View className="bg-surface-800 rounded-2xl px-4 py-3 mb-2 gap-2">
        <Text className="text-white text-sm font-medium">
          Para configurar o Whoop pela primeira vez:
        </Text>
        <Text className="text-surface-600 text-xs leading-5">
          1. Crie uma conta em developer.whoop.com{"\n"}
          2. Crie um novo app com redirect URI: treinodieta://whoop-callback{"\n"}
          3. Copie o Client ID e Client Secret{"\n"}
          4. Cole nas variáveis de ambiente do Supabase (Settings → Edge Functions){"\n"}
          5. Use o botão abaixo para autorizar o acesso
        </Text>
        <TouchableOpacity
          className="bg-brand-500 rounded-xl py-2.5 items-center mt-2"
          onPress={() => Alert.alert("Em breve", "Fluxo OAuth será adicionado na próxima versão.")}
        >
          <Text className="text-white font-semibold text-sm">
            🔗 Autorizar Whoop
          </Text>
        </TouchableOpacity>
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
  );
}
