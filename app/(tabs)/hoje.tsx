import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDailyLog } from "@/hooks/useDailyLog";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { computeDailyCalculations, formatWater, formatDuration } from "@/utils/calculations";
import { MetricCard } from "@/components/ui/MetricCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Card } from "@/components/ui/Card";

const today = new Date();

export default function HojeScreen() {
  const { data: log, isLoading, refetch, isRefetching } = useDailyLog(today);
  const userMetrics = useUserMetrics();

  const calc = log
    ? computeDailyCalculations(log, today, userMetrics)
    : null;

  const surplus = log?.surplus_deficit_kcal ?? 0;
  const targetKcal = calc ? calc.tdee_kcal + surplus : 0;
  const loggedKcal = calc?.total_activity_kcal ?? 0;

  const dateLabel = format(today, "EEEE, d 'de' MMMM", { locale: ptBR });
  const dateCapitalized =
    dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  return (
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-14 pb-8 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor="#22c55e"
        />
      }
    >
      {/* Header */}
      <View className="flex-row justify-between items-start">
        <View>
          <Text className="text-surface-600 text-sm">{dateCapitalized}</Text>
          <Text className="text-white text-2xl font-bold mt-0.5">Hoje</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/configuracoes")}
          className="bg-surface-800 rounded-full w-10 h-10 items-center justify-center"
        >
          <Text className="text-lg">⚙️</Text>
        </TouchableOpacity>
        {log?.weight_kg && (
          <View className="bg-surface-800 rounded-xl px-3 py-2 items-center">
            <Text className="text-white text-xl font-bold">
              {log.weight_kg.toFixed(1)}
            </Text>
            <Text className="text-surface-600 text-xs">kg</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color="#22c55e" size="large" />
        </View>
      ) : !log ? (
        /* No data yet — prompt to log */
        <Card className="items-center py-8 gap-3">
          <Text className="text-4xl">📋</Text>
          <Text className="text-white text-base font-semibold">
            Nenhum dado registrado hoje
          </Text>
          <TouchableOpacity
            className="mt-2 bg-brand-500 rounded-xl px-6 py-3"
            onPress={() => router.push("/(tabs)/registrar")}
          >
            <Text className="text-white font-bold">Registrar agora</Text>
          </TouchableOpacity>
        </Card>
      ) : (
        <>
          {/* Caloric balance */}
          <Card>
            <Text className="text-surface-600 text-xs font-medium uppercase tracking-wider mb-3">
              Balanço calórico
            </Text>
            <View className="flex-row justify-between items-center mb-4">
              <View className="items-center">
                <Text className="text-white text-2xl font-bold">
                  {Math.round(calc?.tdee_kcal ?? 0)}
                </Text>
                <Text className="text-surface-600 text-xs">Gasto</Text>
              </View>
              <View className="items-center">
                <Text
                  className={`text-2xl font-bold ${
                    surplus >= 0 ? "text-yellow-400" : "text-brand-400"
                  }`}
                >
                  {surplus >= 0 ? "+" : ""}
                  {Math.round(surplus)}
                </Text>
                <Text className="text-surface-600 text-xs">
                  {surplus >= 0 ? "Superávit" : "Déficit"}
                </Text>
              </View>
              <View className="items-center">
                <Text className="text-white text-2xl font-bold">
                  {Math.round(targetKcal)}
                </Text>
                <Text className="text-surface-600 text-xs">Meta kcal</Text>
              </View>
            </View>

            {/* Activity calories breakdown */}
            {loggedKcal > 0 && (
              <View className="border-t border-surface-700 pt-3">
                <Text className="text-surface-600 text-xs mb-2">
                  Atividades hoje
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {[
                    { label: "Academia", val: log.kcal_academia, icon: "🏋️" },
                    { label: "Boxe", val: log.kcal_boxe, icon: "🥊" },
                    { label: "Surf", val: log.kcal_surf, icon: "🏄" },
                    { label: "Corrida", val: log.kcal_corrida, icon: "🏃" },
                    { label: "CrossFit", val: log.kcal_crossfit, icon: "⚡" },
                    { label: "Musculação", val: log.kcal_musculacao, icon: "💪" },
                    { label: "Outros", val: log.kcal_outros, icon: "🔥" },
                    { label: "Whoop", val: log.whoop_kcal, icon: "📡" },
                  ]
                    .filter((a) => (a.val ?? 0) > 0)
                    .map((a) => (
                      <View
                        key={a.label}
                        className="bg-surface-700 rounded-lg px-2 py-1 flex-row items-center gap-1"
                      >
                        <Text className="text-xs">{a.icon}</Text>
                        <Text className="text-white text-xs">
                          {a.label}: {Math.round(a.val!)} kcal
                        </Text>
                      </View>
                    ))}
                </View>
              </View>
            )}
          </Card>

          {/* Macros & hydration */}
          <Card className="gap-4">
            <Text className="text-surface-600 text-xs font-medium uppercase tracking-wider">
              Metas do dia
            </Text>
            <ProgressBar
              label="Proteína mínima"
              icon="🥩"
              current={0}
              target={calc?.min_protein_g ?? 0}
              unit="g"
              color="bg-red-500"
            />
            <ProgressBar
              label="Carboidrato mínimo"
              icon="🍚"
              current={0}
              target={calc?.min_carb_g ?? 0}
              unit="g"
              color="bg-yellow-500"
            />
            <ProgressBar
              label="Hidratação"
              icon="💧"
              current={0}
              target={calc?.water_ml ?? 0}
              unit="ml"
              color="bg-blue-500"
            />
          </Card>

          {/* Quick stats grid */}
          <View className="flex-row flex-wrap gap-3">
            <MetricCard
              label="Água necessária"
              value={formatWater(calc?.water_ml ?? 0)}
              icon="💧"
              color="text-blue-400"
            />
            <MetricCard
              label="Proteína mínima"
              value={Math.round(calc?.min_protein_g ?? 0).toString()}
              unit="g"
              icon="🥩"
              color="text-red-400"
            />
            <MetricCard
              label="Carbo mínimo"
              value={Math.round(calc?.min_carb_g ?? 0).toString()}
              unit="g"
              icon="🍚"
              color="text-yellow-400"
            />
            <MetricCard
              label="Atividade"
              value={formatDuration(calc?.total_activity_min ?? 0)}
              icon="⏱️"
              color="text-brand-400"
            />
          </View>

          {/* Whoop section */}
          {(log.whoop_strain || log.whoop_recovery) && (
            <Card>
              <Text className="text-surface-600 text-xs font-medium uppercase tracking-wider mb-3">
                Whoop
              </Text>
              <View className="flex-row gap-4">
                {log.whoop_strain && (
                  <View className="flex-1 items-center">
                    <Text className="text-white text-2xl font-bold">
                      {log.whoop_strain.toFixed(1)}
                    </Text>
                    <Text className="text-surface-600 text-xs">Strain</Text>
                  </View>
                )}
                {log.whoop_recovery && (
                  <View className="flex-1 items-center">
                    <Text
                      className={`text-2xl font-bold ${
                        log.whoop_recovery >= 67
                          ? "text-brand-400"
                          : log.whoop_recovery >= 34
                          ? "text-yellow-400"
                          : "text-red-400"
                      }`}
                    >
                      {log.whoop_recovery}%
                    </Text>
                    <Text className="text-surface-600 text-xs">Recovery</Text>
                  </View>
                )}
              </View>
            </Card>
          )}

          {/* Edit button */}
          <TouchableOpacity
            className="bg-surface-800 border border-surface-700 rounded-xl py-3 items-center"
            onPress={() => router.push("/(tabs)/registrar")}
          >
            <Text className="text-white font-medium">✏️  Editar registro</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}
