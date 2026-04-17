import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  subDays,
  subMonths,
  format,
  parseISO,
  eachWeekOfInterval,
  endOfWeek,
} from "date-fns";
import { getDailyLogs, getRunSessions } from "@/lib/api";
import { computeDailyCalculations } from "@/utils/calculations";
import { useUserMetrics } from "@/hooks/useUserProfile";
import { Card, SectionLabel } from "@/components/ui/Card";

const { width } = Dimensions.get("window");
const CHART_WIDTH = width - 64;

type Period = "30d" | "90d" | "6m" | "1y";

const PERIODS: { key: Period; label: string }[] = [
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "6m", label: "6m" },
  { key: "1y", label: "1a" },
];

function periodToDate(p: Period): Date {
  const now = new Date();
  if (p === "30d") return subDays(now, 30);
  if (p === "90d") return subDays(now, 90);
  if (p === "6m") return subMonths(now, 6);
  return subMonths(now, 12);
}

function SimpleBarChart({
  data,
  color = "#10b981",
  height = 120,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(4, (CHART_WIDTH - 32) / data.length - 3);

  return (
    <View style={{ height }}>
      <View className="flex-row items-end justify-between h-full">
        {data.map((d, i) => (
          <View key={i} className="items-center" style={{ width: barWidth }}>
            <View
              style={{
                width: barWidth,
                height: Math.max(3, (d.value / max) * (height - 20)),
                backgroundColor: color,
                borderRadius: 4,
                opacity: 0.85,
              }}
            >
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "40%",
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: 4,
                }}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SparkLine({
  data,
  color = "#10b981",
  height = 80,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pointW = CHART_WIDTH / (data.length - 1);

  return (
    <View style={{ height, position: "relative" }}>
      {data.map((v, i) => {
        if (i === 0) return null;
        const prev = data[i - 1];
        const x1 = (i - 1) * pointW;
        const x2 = i * pointW;
        const y1 = height - ((prev - min) / range) * height;
        const y2 = height - ((v - min) / range) * height;
        const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: x1,
              top: Math.min(y1, y2) - 1,
              width: len,
              height: 2.5,
              backgroundColor: color,
              borderRadius: 2,
              transformOrigin: "left center",
              transform: [{ rotate: `${angle}deg` }],
              opacity: 0.9,
            }}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: (data.length - 1) * pointW - 5,
          top: height - ((data[data.length - 1] - min) / range) * height - 5,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: "#1c1d23",
        }}
      />
    </View>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-surface-700/50">
      <Text className="text-surface-500 text-sm">{label}</Text>
      <Text className={`text-sm font-bold ${valueColor ?? "text-white"}`}>{value}</Text>
    </View>
  );
}

export default function AnalisesScreen() {
  const [period, setPeriod] = useState<Period>("30d");
  const from = periodToDate(period);

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ["daily_logs", period],
    queryFn: () => getDailyLogs(from, new Date()),
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ["run_sessions", period],
    queryFn: () => getRunSessions(from, new Date(), 500),
  });

  const userMetrics = useUserMetrics();
  const isLoading = loadingLogs || loadingRuns;

  const weightData = logs
    .filter((l) => l.weight_kg)
    .reverse()
    .map((l) => l.weight_kg!);

  const latestWeight = weightData[weightData.length - 1];
  const firstWeight = weightData[0];
  const weightDelta = latestWeight && firstWeight ? latestWeight - firstWeight : 0;

  const weightMa7 = weightData.map((_, i) => {
    const slice = weightData.slice(Math.max(0, i - 6), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const tdeeData = logs
    .filter((l) => l.weight_kg)
    .reverse()
    .map((l) => ({
      label: l.date,
      value: computeDailyCalculations(l, parseISO(l.date), userMetrics).tdee_kcal,
    }));

  const avgTdee = tdeeData.length
    ? tdeeData.reduce((s, d) => s + d.value, 0) / tdeeData.length
    : 0;

  const totalKm = runs.reduce((s, r) => s + (r.distance_km ?? 0), 0);
  const validPaces = runs.filter((r) => r.pace_min_km);
  const avgPace = validPaces.length
    ? validPaces.reduce((s, r) => s + r.pace_min_km!, 0) / validPaces.length
    : 0;

  const weeklyKm = eachWeekOfInterval({ start: from, end: new Date() }).map((week) => {
    const wEnd = endOfWeek(week);
    const weekRuns = runs.filter((r) => {
      const d = parseISO(r.date);
      return d >= week && d <= wEnd;
    });
    return {
      label: format(week, "dd/MM"),
      value: weekRuns.reduce((s, r) => s + (r.distance_km ?? 0), 0),
    };
  });

  const trainingDays = logs.filter((l) => {
    return (
      (l.min_academia ?? 0) + (l.min_boxe ?? 0) + (l.min_surf ?? 0) +
      (l.min_corrida ?? 0) + (l.min_crossfit ?? 0) + (l.min_musculacao ?? 0) > 0
    );
  }).length;

  return (
    <ScrollView
      className="flex-1 bg-surface-900"
      contentContainerClassName="px-4 pt-14 pb-10 gap-5"
    >
      <View>
        <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
          Tendências
        </Text>
        <Text className="text-white text-3xl font-bold tracking-tight">Análises</Text>
      </View>

      {/* Period selector */}
      <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-1.5 flex-row gap-1">
        {PERIODS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            className={`flex-1 py-2 rounded-xl items-center ${
              period === key ? "bg-brand-500" : ""
            }`}
            onPress={() => setPeriod(key)}
          >
            <Text
              className={`text-sm font-bold ${
                period === key ? "text-white" : "text-surface-500"
              }`}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#10b981" size="large" className="mt-12" />
      ) : (
        <>
          {/* ── Peso ─────────────────────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Peso" />
            {weightData.length > 1 ? (
              <>
                <SparkLine data={weightMa7} color="#10b981" />
                <StatRow
                  label="Atual"
                  value={`${latestWeight?.toFixed(1) ?? "—"} kg`}
                  valueColor="text-brand-400"
                />
                <StatRow
                  label="Variação no período"
                  value={`${weightDelta >= 0 ? "+" : ""}${weightDelta.toFixed(1)} kg`}
                  valueColor={weightDelta <= 0 ? "text-brand-400" : "text-amber-400"}
                />
                <StatRow
                  label="Menor"
                  value={`${Math.min(...weightData).toFixed(1)} kg`}
                />
                <StatRow
                  label="Maior"
                  value={`${Math.max(...weightData).toFixed(1)} kg`}
                />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Dados insuficientes para exibir gráfico.</Text>
            )}
          </Card>

          {/* ── Calorias ─────────────────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Gasto Calórico" />
            {tdeeData.length > 0 ? (
              <>
                <SimpleBarChart data={tdeeData} color="#f97316" />
                <StatRow
                  label="Média diária"
                  value={`${Math.round(avgTdee).toLocaleString()} kcal`}
                  valueColor="text-orange-400"
                />
                <StatRow
                  label="Dias com atividade"
                  value={`${trainingDays} / ${logs.length} dias`}
                />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Sem dados de calorias.</Text>
            )}
          </Card>

          {/* ── Corridas ─────────────────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Corridas" />
            {weeklyKm.length > 0 ? (
              <>
                <SimpleBarChart data={weeklyKm} color="#3b82f6" />
                <StatRow
                  label="Km total"
                  value={`${totalKm.toFixed(1)} km`}
                  valueColor="text-sky-400"
                />
                <StatRow label="Sessões" value={`${runs.length}`} />
                <StatRow
                  label="Pace médio"
                  value={
                    avgPace
                      ? `${Math.floor(avgPace)}:${Math.round((avgPace % 1) * 60)
                          .toString()
                          .padStart(2, "0")}/km`
                      : "—"
                  }
                />
                <StatRow
                  label="FC média"
                  value={
                    runs.filter((r) => r.avg_hr).length
                      ? `${Math.round(
                          runs.filter((r) => r.avg_hr).reduce((s, r) => s + r.avg_hr!, 0) /
                            runs.filter((r) => r.avg_hr).length
                        )} bpm`
                      : "—"
                  }
                />
              </>
            ) : (
              <Text className="text-surface-500 text-sm">Sem corridas neste período.</Text>
            )}
          </Card>

          {/* ── Volume de Treino ──────────────────────────── */}
          <Card className="gap-4">
            <SectionLabel label="Volume de Treino" />
            {(() => {
              const byActivity = [
                { label: "Academia", key: "min_academia", color: "#a855f7" },
                { label: "Boxe", key: "min_boxe", color: "#ef4444" },
                { label: "Surf", key: "min_surf", color: "#06b6d4" },
                { label: "CrossFit", key: "min_crossfit", color: "#f59e0b" },
                { label: "Musculação", key: "min_musculacao", color: "#8b5cf6" },
              ]
                .map((a) => ({
                  ...a,
                  total: logs.reduce((s, l) => s + ((l[a.key as keyof typeof l] as number | null) ?? 0), 0),
                }))
                .filter((a) => a.total > 0);

              if (byActivity.length === 0)
                return <Text className="text-surface-500 text-sm">Sem dados de volume.</Text>;

              const maxMin = Math.max(...byActivity.map((a) => a.total));
              return byActivity.map((a) => (
                <View key={a.key} className="gap-2">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-white text-sm font-semibold">{a.label}</Text>
                    <Text className="text-surface-500 text-xs font-medium">
                      {Math.round(a.total / 60)}h {Math.round(a.total % 60)}m
                    </Text>
                  </View>
                  <View className="h-2.5 bg-surface-700 rounded-full overflow-hidden">
                    <View
                      style={{
                        width: `${(a.total / maxMin) * 100}%`,
                        backgroundColor: a.color,
                        height: "100%",
                        borderRadius: 4,
                      }}
                    >
                      <View
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: "50%",
                          backgroundColor: "rgba(255,255,255,0.18)",
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  </View>
                </View>
              ));
            })()}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
