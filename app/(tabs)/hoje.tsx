import { useState, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDailyLog } from "@/hooks/useDailyLog";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { computeDailyCalculations, formatWater, formatDuration } from "@/utils/calculations";
import { MetricCard } from "@/components/ui/MetricCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Card, SectionLabel } from "@/components/ui/Card";
import { Ionicons } from "@expo/vector-icons";
import { DailyLog } from "@/types";

type ActivityEntry = { label: string; key: keyof DailyLog; icon: string };

const ACTIVITIES: ActivityEntry[] = [
  { label: "Academia", key: "kcal_academia", icon: "🏋️" },
  { label: "Boxe", key: "kcal_boxe", icon: "🥊" },
  { label: "Surf", key: "kcal_surf", icon: "🏄" },
  { label: "Corrida", key: "kcal_corrida", icon: "🏃" },
  { label: "CrossFit", key: "kcal_crossfit", icon: "⚡" },
  { label: "Musculação", key: "kcal_musculacao", icon: "💪" },
  { label: "Outros", key: "kcal_outros", icon: "🔥" },
  { label: "Whoop", key: "whoop_kcal", icon: "📡" },
];

function recoveryColor(pct: number): string {
  if (pct >= 67) return "#10b981";
  if (pct >= 34) return "#f59e0b";
  return "#f43f5e";
}

export default function HojeScreen() {
  const [today, setToday] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      setToday(new Date());
    }, [])
  );

  const { data: log, isLoading, refetch, isRefetching } = useDailyLog(today);
  const userMetrics = useUserMetrics();

  const calc = log ? computeDailyCalculations(log, today, userMetrics) : null;
  const surplus = log?.surplus_deficit_kcal ?? 0;
  const targetKcal = calc ? calc.tdee_kcal + surplus : 0;

  const dateLabel = format(today, "EEEE, d 'de' MMMM", { locale: ptBR });
  const dateCapitalized = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  return (
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-14 pb-8 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor="#10b981"
        />
      }
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <View className="flex-row justify-between items-center">
        <View>
          <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
            {dateCapitalized}
          </Text>
          <Text className="text-white text-3xl font-bold mt-0.5 tracking-tight">Hoje</Text>
        </View>
        <View className="flex-row items-center gap-2">
          {log?.weight_kg && (
            <View className="bg-surface-800 border border-surface-700/60 rounded-xl px-3 py-2 items-center">
              <Text className="text-white text-lg font-bold leading-tight">
                {log.weight_kg.toFixed(1)}
              </Text>
              <Text className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">
                kg
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => router.push("/configuracoes")}
            className="bg-surface-800 border border-surface-700/60 rounded-xl w-10 h-10 items-center justify-center"
          >
            <Ionicons name="settings-outline" size={18} color="#72737f" />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View className="items-center py-20">
          <ActivityIndicator color="#10b981" size="large" />
        </View>
      ) : !log ? (
        /* ── Empty state ─────────────────────────────────── */
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-8 items-center gap-4">
          <View className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 items-center justify-center">
            <Text className="text-3xl">📋</Text>
          </View>
          <View className="items-center gap-1">
            <Text className="text-white text-base font-bold">Nenhum dado hoje</Text>
            <Text className="text-surface-500 text-sm text-center">
              Registre seu treino e alimentação para ver as métricas
            </Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-8 py-3 mt-1"
            onPress={() => router.push("/(tabs)/registrar")}
          >
            <Text className="text-white font-bold text-sm">Registrar agora</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* ── Hero: Balanço Calórico ────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Balanço Calórico" />
            <View className="flex-row justify-between items-center px-2">
              <View className="items-center gap-1">
                <Text className="text-white text-3xl font-bold tracking-tight">
                  {Math.round(calc?.tdee_kcal ?? 0).toLocaleString()}
                </Text>
                <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                  Gasto
                </Text>
              </View>

              <View className="items-center gap-1">
                <View
                  className="px-3 py-1 rounded-lg"
                  style={{
                    backgroundColor: surplus >= 0 ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)",
                  }}
                >
                  <Text
                    className="text-xl font-bold"
                    style={{ color: surplus >= 0 ? "#f59e0b" : "#10b981" }}
                  >
                    {surplus >= 0 ? "+" : ""}
                    {Math.round(surplus)}
                  </Text>
                </View>
                <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                  {surplus >= 0 ? "Superávit" : "Déficit"}
                </Text>
              </View>

              <View className="items-center gap-1">
                <Text className="text-white text-3xl font-bold tracking-tight">
                  {Math.round(targetKcal).toLocaleString()}
                </Text>
                <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                  Meta kcal
                </Text>
              </View>
            </View>

            {/* Activity pills */}
            {(() => {
              const active = ACTIVITIES.filter((a) => {
                const val = log[a.key];
                return typeof val === "number" && val > 0;
              });
              if (active.length === 0) return null;
              return (
                <View className="border-t border-surface-700/50 pt-3">
                  <Text className="text-surface-500 text-xs mb-2 font-medium">
                    Atividades registradas
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {active.map((a) => (
                      <View
                        key={a.key}
                        className="flex-row items-center gap-1 bg-surface-700/50 border border-surface-600/40 rounded-lg px-2.5 py-1.5"
                      >
                        <Text className="text-xs">{a.icon}</Text>
                        <Text className="text-white text-xs font-medium">{a.label}</Text>
                        <Text className="text-brand-400 text-xs font-bold ml-0.5">
                          {Math.round(log[a.key] as number)} kcal
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}
          </Card>

          {/* ── Metas do dia ─────────────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Metas do Dia" />
            <ProgressBar
              label="Proteína mínima"
              icon="🥩"
              current={log.protein_g ?? 0}
              target={calc?.min_protein_g ?? 0}
              unit="g"
              barColor="#f43f5e"
            />
            <ProgressBar
              label="Carboidrato mínimo"
              icon="🍚"
              current={log.carbs_g ?? 0}
              target={calc?.min_carb_g ?? 0}
              unit="g"
              barColor="#f59e0b"
            />
            <ProgressBar
              label="Hidratação"
              icon="💧"
              current={log.water_consumed_ml ?? 0}
              target={calc?.water_ml ?? 0}
              unit="ml"
              barColor="#38bdf8"
            />
          </Card>

          {/* ── Métricas grid bento ──────────────────────── */}
          <View className="flex-row flex-wrap gap-3">
            <MetricCard
              label="Água necessária"
              value={formatWater(calc?.water_ml ?? 0)}
              icon="💧"
              valueColor="text-sky-400"
              tint="bg-sky-500/8"
              border="border-sky-500/20"
            />
            <MetricCard
              label="Proteína mínima"
              value={Math.round(calc?.min_protein_g ?? 0).toString()}
              unit="g"
              icon="🥩"
              valueColor="text-rose-400"
              tint="bg-rose-500/8"
              border="border-rose-500/20"
            />
            <MetricCard
              label="Carbo mínimo"
              value={Math.round(calc?.min_carb_g ?? 0).toString()}
              unit="g"
              icon="🍚"
              valueColor="text-amber-400"
              tint="bg-amber-500/8"
              border="border-amber-500/20"
            />
            <MetricCard
              label="Atividade"
              value={formatDuration(calc?.total_activity_min ?? 0)}
              icon="⏱️"
              valueColor="text-brand-400"
              tint="bg-brand-500/8"
              border="border-brand-500/20"
            />
          </View>

          {/* ── Whoop ────────────────────────────────────── */}
          {(log.whoop_strain || log.whoop_recovery) && (
            <View className="flex-row gap-3">
              {log.whoop_strain && (
                <View className="flex-1 bg-orange-500/8 border border-orange-500/20 rounded-2xl p-4">
                  <Text className="text-surface-500 text-xs font-bold uppercase tracking-widest mb-2">
                    Whoop Strain
                  </Text>
                  <Text className="text-orange-400 text-3xl font-bold tracking-tight">
                    {log.whoop_strain.toFixed(1)}
                  </Text>
                  <Text className="text-surface-500 text-xs mt-1">
                    {log.whoop_strain >= 18
                      ? "Carga muito alta"
                      : log.whoop_strain >= 14
                      ? "Carga alta"
                      : log.whoop_strain >= 10
                      ? "Moderado"
                      : "Leve"}
                  </Text>
                </View>
              )}
              {log.whoop_recovery && (
                <View
                  className="flex-1 rounded-2xl p-4 border"
                  style={{
                    backgroundColor: `${recoveryColor(log.whoop_recovery)}14`,
                    borderColor: `${recoveryColor(log.whoop_recovery)}30`,
                  }}
                >
                  <Text className="text-surface-500 text-xs font-bold uppercase tracking-widest mb-2">
                    Recovery
                  </Text>
                  <Text
                    className="text-3xl font-bold tracking-tight"
                    style={{ color: recoveryColor(log.whoop_recovery) }}
                  >
                    {log.whoop_recovery}%
                  </Text>
                  <Text className="text-surface-500 text-xs mt-1">
                    {log.whoop_recovery >= 67
                      ? "Bem recuperado"
                      : log.whoop_recovery >= 34
                      ? "Moderado"
                      : "Pouco recuperado"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Edit button ──────────────────────────────── */}
          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 bg-surface-800 border border-surface-700/60 rounded-xl py-3.5"
            onPress={() => router.push("/(tabs)/registrar")}
          >
            <Ionicons name="create-outline" size={16} color="#72737f" />
            <Text className="text-surface-400 font-semibold text-sm">Editar registro</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}
