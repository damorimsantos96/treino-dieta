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
import { addDays, format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { useDailyLog } from "@/hooks/useDailyLog";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { getDailyLogs } from "@/lib/api";
import { computeDailyCalculations, formatWater, formatDuration } from "@/utils/calculations";
import { AvaBootsRecommendation, selectAvaBootsProtocol } from "@/utils/avaboots";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card, SectionLabel } from "@/components/ui/Card";
import { Ionicons } from "@expo/vector-icons";
import { DailyLog } from "@/types";

type ActivityEntry = { label: string; key: keyof DailyLog; icon: string };

const ACTIVITIES: ActivityEntry[] = [
  { label: "Boxe", key: "kcal_boxe", icon: "🥊" },
  { label: "Surf", key: "kcal_surf", icon: "🏄" },
  { label: "Ciclismo", key: "kcal_ciclismo", icon: "🚴" },
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

function AvaBootsCard({ recommendation }: { recommendation: AvaBootsRecommendation }) {
  return (
    <Card className="gap-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <SectionLabel label="AvaBoots" />
          <Text className="text-white text-lg font-bold tracking-tight">
            {recommendation.title}
          </Text>
          <Text className="text-surface-500 text-xs mt-1">
            Proximo treino estimado em{" "}
            {Math.max(0, Math.round(recommendation.minutesUntilTraining / 60))} h
          </Text>
        </View>
        <View className="w-11 h-11 rounded-xl bg-sky-500/10 border border-sky-500/20 items-center justify-center">
          <Ionicons name="body-outline" size={22} color="#38bdf8" />
        </View>
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1 bg-surface-700/50 border border-surface-600/40 rounded-xl p-3">
          <Text className="text-surface-500 text-[10px] font-bold uppercase tracking-widest">
            Tempo
          </Text>
          <Text className="text-white text-xl font-bold mt-1">{recommendation.duration} min</Text>
        </View>
        <View className="flex-1 bg-surface-700/50 border border-surface-600/40 rounded-xl p-3">
          <Text className="text-surface-500 text-[10px] font-bold uppercase tracking-widest">
            Pressao
          </Text>
          <Text className="text-white text-xl font-bold mt-1">{recommendation.pressure}</Text>
          <Text className="text-surface-500 text-[10px]">mmHg</Text>
        </View>
        <View className="flex-1 bg-surface-700/50 border border-surface-600/40 rounded-xl p-3">
          <Text className="text-surface-500 text-[10px] font-bold uppercase tracking-widest">
            Modo
          </Text>
          <Text className="text-white text-xl font-bold mt-1">{recommendation.mode}</Text>
          <Text className="text-surface-500 text-[10px]">{recommendation.modeLabel}</Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Text className="text-surface-500 text-xs">Hoje {recommendation.todayLoad}/100</Text>
        <Text className="text-surface-500 text-xs">Ontem {recommendation.yesterdayLoad}/100</Text>
        <Text className="text-surface-500 text-xs">Amanha {recommendation.tomorrowLoad}/100</Text>
      </View>

      <View className="gap-1 border-t border-surface-700/50 pt-3">
        {recommendation.rationale.slice(0, 2).map((item) => (
          <View key={item} className="flex-row gap-2">
            <Ionicons name="checkmark-circle" size={14} color="#10b981" />
            <Text className="text-surface-400 text-xs flex-1">{item}</Text>
          </View>
        ))}
        <Text className="text-surface-500 text-[11px] mt-1">{recommendation.caution}</Text>
      </View>
    </Card>
  );
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
  const isToday = format(today, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
  const dateStr = format(today, "yyyy-MM-dd");
  const yesterdayStr = format(subDays(today, 1), "yyyy-MM-dd");

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["daily_logs", "avaboots", dateStr],
    queryFn: () => getDailyLogs(subDays(today, 56), today),
    enabled: isToday,
  });

  const avaBootsRecommendation = isToday
    ? selectAvaBootsProtocol({
        todayLog: log,
        yesterdayLog: recentLogs.find((item) => item.date === yesterdayStr),
        historicalLogs: recentLogs.filter((item) => item.date !== dateStr),
        now: new Date(),
      })
    : null;

  return (
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-6 pb-8 gap-4"
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
        <View className="flex-row items-center gap-1">
          <TouchableOpacity onPress={() => setToday((d) => subDays(d, 1))} className="p-1">
            <Ionicons name="chevron-back" size={20} color="#72737f" />
          </TouchableOpacity>
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
              {dateCapitalized}
            </Text>
            <Text className="text-white text-3xl font-bold mt-0.5 tracking-tight">
              {isToday ? "Hoje" : format(today, "d MMM", { locale: ptBR })}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setToday((d) => addDays(d, 1))}
            disabled={isToday}
            className="p-1"
          >
            <Ionicons name="chevron-forward" size={20} color={isToday ? "#2c2d36" : "#72737f"} />
          </TouchableOpacity>
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
        </View>
      </View>

      {!isLoading && avaBootsRecommendation && (
        <AvaBootsCard recommendation={avaBootsRecommendation} />
      )}

      {isLoading ? (
        <View className="items-center py-20">
          <ActivityIndicator color="#10b981" size="large" />
        </View>
      ) : !log ? (
        <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-8 items-center gap-4">
          <View className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 items-center justify-center">
            <Text className="text-3xl">📋</Text>
          </View>
          <View className="items-center gap-1">
            <Text className="text-white text-base font-bold">Nenhum dado hoje</Text>
            <Text className="text-surface-500 text-sm text-center">
              Registre seu treino para ver as métricas
            </Text>
          </View>
          <TouchableOpacity
            className="bg-brand-500 rounded-xl px-8 py-3 mt-1"
            onPress={() => router.push({ pathname: "/(tabs)/registrar", params: { date: dateStr } })}
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

          {/* ── Metas de Nutrição ────────────────────────── */}
          {calc && (
            <Card className="gap-3">
              <SectionLabel label="Metas de Nutrição" />
              <View className="flex-row gap-3">
                <View className="flex-1 bg-rose-500/8 border border-rose-500/20 rounded-xl p-3 items-center gap-1">
                  <Text className="text-xl">🥩</Text>
                  <Text className="text-rose-400 text-lg font-bold">{Math.round(calc.min_protein_g)}g</Text>
                  <Text className="text-surface-500 text-xs text-center">Proteína mín.</Text>
                </View>
                <View className="flex-1 bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 items-center gap-1">
                  <Text className="text-xl">🍚</Text>
                  <Text className="text-amber-400 text-lg font-bold">{Math.round(calc.min_carb_g)}g</Text>
                  <Text className="text-surface-500 text-xs text-center">Carbo mín.</Text>
                </View>
                <View className="flex-1 bg-sky-500/8 border border-sky-500/20 rounded-xl p-3 items-center gap-1">
                  <Text className="text-xl">💧</Text>
                  <Text className="text-sky-400 text-lg font-bold">{formatWater(calc.water_ml)}</Text>
                  <Text className="text-surface-500 text-xs text-center">Água neces.</Text>
                </View>
              </View>
            </Card>
          )}

          {/* ── Métricas grid bento ──────────────────────── */}
          <View className="flex-row flex-wrap gap-3">
            <MetricCard
              label="Atividade total"
              value={formatDuration(calc?.total_activity_min ?? 0)}
              icon="⏱️"
              valueColor="text-brand-400"
              tint="bg-brand-500/8"
              border="border-brand-500/20"
            />
            <MetricCard
              label="Kcal atividade"
              value={Math.round(calc?.total_activity_kcal ?? 0).toLocaleString()}
              unit="kcal"
              icon="🔥"
              valueColor="text-orange-400"
              tint="bg-orange-500/8"
              border="border-orange-500/20"
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
                    {log.whoop_strain >= 18 ? "Carga muito alta"
                      : log.whoop_strain >= 14 ? "Carga alta"
                      : log.whoop_strain >= 10 ? "Moderado" : "Leve"}
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
                    {log.whoop_recovery >= 67 ? "Bem recuperado"
                      : log.whoop_recovery >= 34 ? "Moderado" : "Pouco recuperado"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Edit button ──────────────────────────────── */}
          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 bg-surface-800 border border-surface-700/60 rounded-xl py-3.5"
            onPress={() => router.push({ pathname: "/(tabs)/registrar", params: { date: dateStr } })}
          >
            <Ionicons name="create-outline" size={16} color="#72737f" />
            <Text className="text-surface-400 font-semibold text-sm">Editar registro</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}
