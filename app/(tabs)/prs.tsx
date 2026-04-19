import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getPRMovements, getPRAttempts, createPRMovement, createPRAttempt, recalculatePRs } from "@/lib/api";
import { PRMovement, PRAttempt, PRUnit } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";

const UNIT_LABELS: Record<PRUnit, string> = {
  time_sec: "Tempo (seg)",
  reps: "Repetições",
  weight_kg: "Peso (kg)",
  rounds_reps: "Rounds+Reps",
  meters: "Metros",
};

function formatValue(value: number, unit: PRUnit): string {
  if (unit === "time_sec") {
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = Math.round(value % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  if (unit === "weight_kg") return `${value} kg`;
  if (unit === "meters") return `${value} m`;
  if (unit === "rounds_reps") {
    const rounds = Math.floor(value);
    const reps = Math.round((value - rounds) * 100);
    return `${rounds}rd + ${reps}rep`;
  }
  return `${value}`;
}

const DEFAULT_MOVEMENTS = [
  { name: "Karen", unit: "time_sec" as PRUnit, category: "CrossFit", lower_is_better: true },
  { name: "Fran", unit: "time_sec" as PRUnit, category: "CrossFit", lower_is_better: true },
  { name: "DT", unit: "time_sec" as PRUnit, category: "CrossFit", lower_is_better: true },
  { name: "Helen", unit: "time_sec" as PRUnit, category: "CrossFit", lower_is_better: true },
  { name: "Grace", unit: "time_sec" as PRUnit, category: "CrossFit", lower_is_better: true },
  { name: "Cindy", unit: "rounds_reps" as PRUnit, category: "CrossFit", lower_is_better: false },
];

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(parseISO(value).getTime());
}

function parsePositiveNumber(value: string, errors: string[]): number | null {
  const raw = value.trim();
  if (!raw) {
    errors.push("Valor: informe um número.");
    return null;
  }
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) {
    errors.push("Valor: informe um número válido.");
    return null;
  }
  if (n <= 0) errors.push("Valor: informe um número maior que zero.");
  if (n > 100000) errors.push("Valor: máximo 100000.");
  return n;
}

function parseTimeInput(value: string, errors: string[]): number | null {
  const raw = value.trim();
  if (!raw) { errors.push("Tempo: informe no formato mm:ss ou hh:mm:ss."); return null; }
  const parts = raw.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) {
    errors.push("Tempo: use o formato mm:ss ou hh:mm:ss.");
    return null;
  }
  let seconds = 0;
  if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else { errors.push("Tempo: use o formato mm:ss ou hh:mm:ss."); return null; }
  if (seconds <= 0) errors.push("Tempo: deve ser maior que zero.");
  return seconds;
}

function parseRoundsReps(rounds: string, reps: string, errors: string[]): number | null {
  const r = parseInt(rounds.trim(), 10);
  const p = parseInt(reps.trim(), 10);
  if (!Number.isFinite(r) || r < 0) { errors.push("Rounds: informe um número inteiro."); return null; }
  if (!Number.isFinite(p) || p < 0) { errors.push("Reps: informe um número inteiro."); return null; }
  if (r === 0 && p === 0) { errors.push("Informe pelo menos um round ou rep."); return null; }
  return r + p / 100;
}

function MovementCard({
  movement,
  pr,
  onAddAttempt,
}: {
  movement: PRMovement;
  pr: PRAttempt | undefined;
  onAddAttempt: (m: PRMovement) => void;
}) {
  return (
    <TouchableOpacity
      className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 mb-3"
      onPress={() => onAddAttempt(movement)}
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-white font-bold text-base">{movement.name}</Text>
          <Text className="text-surface-500 text-xs mt-1 font-medium">
            {movement.category} · {UNIT_LABELS[movement.unit]}
          </Text>
        </View>
        <View className="items-end gap-1">
          {pr ? (
            <>
              <View className="bg-brand-500/10 border border-brand-500/20 rounded-xl px-3 py-1.5">
                <Text className="text-brand-400 text-lg font-bold">
                  {formatValue(pr.value, movement.unit)}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Ionicons name="trophy" size={10} color="#f59e0b" />
                <Text className="text-surface-500 text-xs">
                  {format(parseISO(pr.date), "dd/MM/yy")}
                </Text>
              </View>
            </>
          ) : (
            <View className="bg-surface-700/50 border border-surface-700 rounded-xl px-3 py-1.5">
              <Text className="text-surface-500 text-sm">Sem PR</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function PRAttemptChart({
  movement,
  attempts,
}: {
  movement: PRMovement | null;
  attempts: PRAttempt[];
}) {
  const [chartWidth, setChartWidth] = useState(300);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  if (!movement) return null;
  const chartMovement = movement;

  const ordered = [...attempts].sort((a, b) => a.date.localeCompare(b.date));

  if (ordered.length === 0) {
    return (
      <Text className="text-surface-500 text-sm">
        Nenhuma tentativa registrada para este PR.
      </Text>
    );
  }

  if (ordered.length === 1) {
    const only = ordered[0];
    return (
      <View className="bg-surface-700/40 border border-surface-600/30 rounded-xl px-4 py-3.5 gap-0.5">
        <Text className="text-surface-400 text-xs">
          {format(parseISO(only.date), "dd/MM/yyyy", { locale: ptBR })}
          {only.is_pr ? "  ·  PR" : ""}
        </Text>
        <Text className="text-white text-lg font-bold">
          {formatValue(only.value, movement.unit)}
        </Text>
      </View>
    );
  }

  const CHART_H = 144;
  const CHART_T = 8;
  const CHART_L = 36;
  const CHART_R = 16;
  const CHART_B = 24;

  const values = ordered.map((a) => a.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const plotWidth = Math.max(80, chartWidth - CHART_L - CHART_R);
  const plotHeight = CHART_H - CHART_T;
  const n = ordered.length;
  const pointW = n > 1 ? plotWidth / (n - 1) : plotWidth;

  const activeIndex = hovered ?? selected;
  const activeAttempt = activeIndex != null ? ordered[activeIndex] : null;

  const bestLabel = formatValue(chartMovement.lower_is_better ? minV : maxV, chartMovement.unit);
  const worstLabel = formatValue(chartMovement.lower_is_better ? maxV : minV, chartMovement.unit);

  function computeCy(value: number): number {
    const frac = chartMovement.lower_is_better
      ? (maxV - value) / range
      : (value - minV) / range;
    return plotHeight - frac * (plotHeight - 8) - 4;
  }

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) setChartWidth(w);
      }}
      className="gap-3"
    >
      <View style={{ height: CHART_H + CHART_B, position: "relative", width: chartWidth }}>
        <Text className="absolute left-0 top-0 text-surface-600 text-[10px]">{bestLabel}</Text>
        <Text className="absolute left-0 bottom-6 text-surface-600 text-[10px]">{worstLabel}</Text>

        {/* Line segments + dots (pointerEvents none so overlay handles interaction) */}
        <View
          pointerEvents="none"
          className="absolute overflow-hidden"
          style={{ left: CHART_L, right: CHART_R, top: CHART_T, height: plotHeight }}
        >
          {ordered.map((attempt, index) => {
            if (index === 0) return null;
            const prev = ordered[index - 1];
            const x1 = (index - 1) * pointW;
            const x2 = index * pointW;
            const y1 = computeCy(prev.value);
            const y2 = computeCy(attempt.value);
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            return (
              <View
                key={`seg-${index}`}
                style={{
                  position: "absolute",
                  left: x1,
                  top: y1,
                  width: len,
                  height: 2,
                  backgroundColor: "#3b82f6",
                  borderRadius: 2,
                  transformOrigin: "left center",
                  transform: [{ rotate: `${angle}deg` }],
                  opacity: activeIndex != null && activeIndex !== index && activeIndex !== index - 1 ? 0.35 : 0.9,
                }}
              />
            );
          })}
          {ordered.map((attempt, index) => {
            const x = index * pointW;
            const y = computeCy(attempt.value);
            const isActive = activeIndex === index;
            const r = isActive ? 5 : 3;
            return (
              <View
                key={`dot-${index}`}
                style={{
                  position: "absolute",
                  left: x - r,
                  top: y - r,
                  width: r * 2,
                  height: r * 2,
                  borderRadius: r,
                  backgroundColor: attempt.is_pr ? "#f59e0b" : "#3b82f6",
                  opacity: activeIndex != null && !isActive ? 0.45 : 1,
                }}
              />
            );
          })}
        </View>

        {/* Interaction overlay */}
        <TouchableOpacity
          activeOpacity={1}
          className="absolute"
          style={{ left: CHART_L, right: CHART_R, top: CHART_T, height: plotHeight }}
          onPress={(e) => {
            const index = Math.max(0, Math.min(n - 1, Math.round(e.nativeEvent.locationX / pointW)));
            setSelected((prev) => prev === index ? null : index);
          }}
          {...({
            onPointerMove: (e: any) => {
              const x = e.nativeEvent.offsetX ?? e.nativeEvent.locationX;
              setHovered(Math.max(0, Math.min(n - 1, Math.round(x / pointW))));
            },
            onPointerLeave: () => setHovered(null),
          } as any)}
        />

        {/* X axis: first, middle (if >2), last */}
        <View
          className="absolute bottom-0 flex-row justify-between"
          style={{ left: CHART_L, right: CHART_R }}
        >
          <Text className="text-surface-600 text-[10px]">
            {format(parseISO(ordered[0].date), "dd/MM/yy")}
          </Text>
          {n > 2 && (
            <Text className="text-surface-600 text-[10px]">
              {format(parseISO(ordered[Math.floor(n / 2)].date), "dd/MM/yy")}
            </Text>
          )}
          <Text className="text-surface-600 text-[10px]">
            {format(parseISO(ordered[n - 1].date), "dd/MM/yy")}
          </Text>
        </View>
      </View>

      {activeAttempt && (
        <View className="bg-surface-700/50 border border-surface-600/40 rounded-xl px-3 py-2">
          <Text className="text-white text-xs font-semibold">
            {format(parseISO(activeAttempt.date), "dd/MM/yy", { locale: ptBR })}:{" "}
            {formatValue(activeAttempt.value, movement.unit)}
            {activeAttempt.is_pr ? " · PR" : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function PRsScreen() {
  const qc = useQueryClient();
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ["pr_movements"],
    queryFn: getPRMovements,
  });
  const { data: attempts = [] } = useQuery({
    queryKey: ["pr_attempts"],
    queryFn: () => getPRAttempts(),
  });

  const { mutateAsync: addMovement } = useMutation({
    mutationFn: createPRMovement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr_movements"] }),
  });
  const { mutateAsync: addAttempt, isPending: savingAttempt } = useMutation({
    mutationFn: createPRAttempt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr_attempts"] });
      qc.invalidateQueries({ queryKey: ["pr_movements"] });
    },
  });

  const { mutate: recalc, isPending: recalcPending } = useMutation({
    mutationFn: recalculatePRs,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr_attempts"] });
      Alert.alert("Pronto", "PRs recalculados com sucesso.");
    },
    onError: (err: any) => Alert.alert("Erro", err.message),
  });

  const [selectedMovement, setSelectedMovement] = useState<PRMovement | null>(null);
  const [showAddMovement, setShowAddMovement] = useState(false);
  const [newMovementForm, setNewMovementForm] = useState({
    name: "",
    unit: "time_sec" as PRUnit,
    category: "",
    lower_is_better: true,
  });
  const [attemptForm, setAttemptForm] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    value: "",
    rounds: "",
    reps: "",
    notes: "",
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMovementId, setHistoryMovementId] = useState<string | null>(null);

  const prMap = new Map<string, PRAttempt>();
  attempts.filter((a) => a.is_pr).forEach((a) => prMap.set(a.movement_id, a));
  const selectedHistoryMovement = useMemo(() => {
    if (movements.length === 0) return null;
    return movements.find((movement) => movement.id === historyMovementId) ?? movements[0];
  }, [historyMovementId, movements]);
  const selectedHistoryAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.movement_id === selectedHistoryMovement?.id),
    [attempts, selectedHistoryMovement?.id]
  );

  async function handleSeedDefaults() {
    Alert.alert(
      "Adicionar movimentos padrão?",
      "Adiciona Karen, Fran, DT, Helen, Grace e Cindy.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Adicionar",
          onPress: async () => {
            for (const m of DEFAULT_MOVEMENTS) {
              try { await addMovement(m); } catch {}
            }
          },
        },
      ]
    );
  }

  async function handleSaveAttempt() {
    if (!selectedMovement) return;
    const errors: string[] = [];
    const date = attemptForm.date.trim();
    if (!isIsoDate(date)) errors.push("Data: use o formato YYYY-MM-DD.");

    let value: number | null = null;
    if (selectedMovement.unit === "time_sec") {
      value = parseTimeInput(attemptForm.value, errors);
    } else if (selectedMovement.unit === "rounds_reps") {
      value = parseRoundsReps(attemptForm.rounds, attemptForm.reps, errors);
    } else {
      value = parsePositiveNumber(attemptForm.value, errors);
    }

    if (errors.length > 0 || value == null) {
      Alert.alert("Revise os dados", errors.join("\n"));
      return;
    }

    try {
      await addAttempt({
        movement_id: selectedMovement.id,
        date,
        value,
        notes: attemptForm.notes || null,
      });
      setSelectedMovement(null);
      setAttemptForm({ date: format(new Date(), "yyyy-MM-dd"), value: "", rounds: "", reps: "", notes: "" });
    } catch (err: any) {
      Alert.alert("Erro", err.message);
    }
  }

  async function handleAddMovement() {
    const name = newMovementForm.name.trim();
    if (!name) return;
    try {
      await addMovement({
        ...newMovementForm,
        name,
        category: newMovementForm.category.trim() || null,
      });
      setShowAddMovement(false);
      setNewMovementForm({ name: "", unit: "time_sec", category: "", lower_is_better: true });
    } catch (err: any) {
      Alert.alert("Erro", err.message);
    }
  }

  const inputStyle = "bg-surface-700 border border-surface-600/40 text-white rounded-xl px-4 py-3";
  const placeholderColor = "#4a4b58";

  return (
    <View className="flex-1 bg-surface-900">
      <ScrollView stickyHeaderIndices={[0]} contentContainerClassName="px-4 pt-6 pb-8">
        <View className="flex-row justify-between items-center mb-5 bg-surface-900 pb-3">
          <View>
            <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
              Seus recordes
            </Text>
            <Text className="text-white text-3xl font-bold tracking-tight">PRs</Text>
          </View>
          <View className="flex-row gap-2">
            {movements.length === 0 && (
              <TouchableOpacity
                className="bg-surface-700 border border-surface-600/40 rounded-xl px-3 py-2.5"
                onPress={handleSeedDefaults}
              >
                <Text className="text-surface-400 text-xs font-semibold">Padrão</Text>
              </TouchableOpacity>
            )}
            {movements.length > 0 && (
              <TouchableOpacity
                className="bg-surface-700 border border-surface-600/40 rounded-xl px-3 py-2.5"
                onPress={() => recalc()}
                disabled={recalcPending}
              >
                {recalcPending ? (
                  <ActivityIndicator size="small" color="#72737f" />
                ) : (
                  <Ionicons name="refresh-outline" size={16} color="#72737f" />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              className="bg-brand-500 rounded-xl px-4 py-2.5"
              onPress={() => setShowAddMovement(true)}
              style={{ shadowColor: "#10b981", shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 }}
            >
              <Text className="text-white font-bold text-sm">+ Novo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {movements.length > 0 && (
          <View className="bg-surface-800 border border-surface-700/60 rounded-2xl p-4 mb-4 gap-3">
            <TouchableOpacity
              className="flex-row items-center justify-between"
              onPress={() => setHistoryOpen((current) => !current)}
            >
              <View>
                <Text className="text-surface-500 text-xs font-bold uppercase tracking-widest">
                  Historico de PR
                </Text>
                <Text className="text-white text-base font-bold mt-1">
                  {selectedHistoryMovement?.name ?? "Selecione um movimento"}
                </Text>
              </View>
              <Ionicons
                name={historyOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="#72737f"
              />
            </TouchableOpacity>

            {historyOpen && (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {movements.map((movement) => {
                      const active = selectedHistoryMovement?.id === movement.id;
                      return (
                        <TouchableOpacity
                          key={movement.id}
                          className={`px-3 py-2 rounded-lg border ${
                            active
                              ? "bg-brand-500/15 border-brand-500/30"
                              : "bg-surface-700/50 border-surface-600/40"
                          }`}
                          onPress={() => setHistoryMovementId(movement.id)}
                        >
                          <Text className={`text-xs font-semibold ${active ? "text-brand-400" : "text-surface-500"}`}>
                            {movement.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                <PRAttemptChart
                  movement={selectedHistoryMovement}
                  attempts={selectedHistoryAttempts}
                />
              </>
            )}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color="#10b981" size="large" className="mt-12" />
        ) : movements.length === 0 ? (
          <View className="items-center py-16 gap-4">
            <View className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-2xl items-center justify-center">
              <Text className="text-4xl">🏆</Text>
            </View>
            <View className="items-center gap-1">
              <Text className="text-white font-bold text-base">Nenhum PR cadastrado</Text>
              <Text className="text-surface-500 text-sm text-center">
                Adicione movimentos para registrar seus recordes
              </Text>
            </View>
            <TouchableOpacity
              className="bg-surface-700 border border-surface-600/40 rounded-xl px-6 py-3"
              onPress={handleSeedDefaults}
            >
              <Text className="text-white text-sm font-semibold">
                Adicionar movimentos CrossFit
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          movements.map((m) => (
            <MovementCard
              key={m.id}
              movement={m}
              pr={prMap.get(m.id)}
              onAddAttempt={setSelectedMovement}
            />
          ))
        )}
      </ScrollView>

      {/* Add attempt modal */}
      <BottomSheetModal
        visible={!!selectedMovement}
        onClose={() => setSelectedMovement(null)}
        scroll
        maxHeight="88%"
      >
              <View className="flex-row items-center gap-2">
                <Ionicons name="trophy" size={18} color="#f59e0b" />
                <Text className="text-white text-xl font-bold">
                  {selectedMovement?.name}
                </Text>
              </View>
              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Data (YYYY-MM-DD)</Text>
                <TextInput
                  className={inputStyle}
                  value={attemptForm.date}
                  onChangeText={(v) => setAttemptForm((f) => ({ ...f, date: v }))}
                />
              </View>
              {selectedMovement?.unit === "rounds_reps" ? (
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-1.5">
                    <Text className="text-surface-500 text-xs font-semibold">Rounds</Text>
                    <TextInput
                      className={inputStyle}
                      value={attemptForm.rounds}
                      onChangeText={(v) => setAttemptForm((f) => ({ ...f, rounds: v }))}
                      keyboardType="number-pad"
                      placeholder="5"
                      placeholderTextColor={placeholderColor}
                    />
                  </View>
                  <View className="flex-1 gap-1.5">
                    <Text className="text-surface-500 text-xs font-semibold">Reps</Text>
                    <TextInput
                      className={inputStyle}
                      value={attemptForm.reps}
                      onChangeText={(v) => setAttemptForm((f) => ({ ...f, reps: v }))}
                      keyboardType="number-pad"
                      placeholder="15"
                      placeholderTextColor={placeholderColor}
                    />
                  </View>
                </View>
              ) : (
                <View className="gap-1.5">
                  <Text className="text-surface-500 text-xs font-semibold">
                    {selectedMovement?.unit === "time_sec" ? "Tempo (mm:ss ou hh:mm:ss)" : `Valor (${selectedMovement ? UNIT_LABELS[selectedMovement.unit] : ""})`}
                  </Text>
                  <TextInput
                    className={inputStyle}
                    value={attemptForm.value}
                    onChangeText={(v) => setAttemptForm((f) => ({ ...f, value: v }))}
                    keyboardType={selectedMovement?.unit === "time_sec" ? "numbers-and-punctuation" : "decimal-pad"}
                    placeholder={selectedMovement?.unit === "time_sec" ? "5:12" : "120.5"}
                    placeholderTextColor={placeholderColor}
                  />
                </View>
              )}
              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Observações (opcional)</Text>
                <TextInput
                  className={inputStyle}
                  value={attemptForm.notes}
                  onChangeText={(v) => setAttemptForm((f) => ({ ...f, notes: v }))}
                  placeholder="Como foi?"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              {(() => {
                const history = attempts
                  .filter((a) => a.movement_id === selectedMovement?.id)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 8);
                if (history.length === 0) return null;
                return (
                  <View className="gap-2">
                    <Text className="text-surface-500 text-xs font-semibold uppercase tracking-wider">Histórico</Text>
                    {history.map((a) => (
                      <View key={a.id} className="flex-row justify-between items-center py-2 border-b border-surface-700/40">
                        <View className="flex-row items-center gap-2">
                          {a.is_pr && <Ionicons name="trophy" size={12} color="#f59e0b" />}
                          <Text className="text-surface-400 text-xs">{format(parseISO(a.date), "dd/MM/yy", { locale: ptBR })}</Text>
                        </View>
                        <Text className={`text-sm font-bold ${a.is_pr ? "text-brand-400" : "text-white"}`}>
                          {selectedMovement ? formatValue(a.value, selectedMovement.unit) : a.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              <View className="flex-row gap-3 mt-1">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
                  onPress={() => setSelectedMovement(null)}
                >
                  <Text className="text-white font-semibold">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
                  onPress={handleSaveAttempt}
                  disabled={savingAttempt}
                >
                  {savingAttempt ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-bold">Salvar PR</Text>
                  )}
                </TouchableOpacity>
              </View>
      </BottomSheetModal>

      {/* Add movement modal */}
      <BottomSheetModal
        visible={showAddMovement}
        onClose={() => setShowAddMovement(false)}
        scroll
      >
              <Text className="text-white text-xl font-bold">Novo movimento</Text>
              <TextInput
                className={inputStyle}
                value={newMovementForm.name}
                onChangeText={(v) => setNewMovementForm((f) => ({ ...f, name: v }))}
                placeholder="Nome (ex: Karen, Deadlift 1RM)"
                placeholderTextColor={placeholderColor}
              />
              <TextInput
                className={inputStyle}
                value={newMovementForm.category}
                onChangeText={(v) => setNewMovementForm((f) => ({ ...f, category: v }))}
                placeholder="Categoria (ex: CrossFit, Levantamento)"
                placeholderTextColor={placeholderColor}
              />
              <View className="gap-1.5">
                <Text className="text-surface-500 text-xs font-semibold">Unidade</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {(Object.keys(UNIT_LABELS) as PRUnit[]).map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => setNewMovementForm((f) => ({ ...f, unit: u }))}
                        className={`px-3 py-2 rounded-lg border ${
                          newMovementForm.unit === u
                            ? "bg-brand-500/15 border-brand-500/30"
                            : "bg-surface-700/50 border-surface-600/40"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            newMovementForm.unit === u ? "text-brand-400" : "text-surface-500"
                          }`}
                        >
                          {UNIT_LABELS[u]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <TouchableOpacity
                className="flex-row items-center gap-3"
                onPress={() =>
                  setNewMovementForm((f) => ({ ...f, lower_is_better: !f.lower_is_better }))
                }
              >
                <View
                  className={`w-5 h-5 rounded-md border-2 items-center justify-center ${
                    newMovementForm.lower_is_better
                      ? "bg-brand-500 border-brand-600"
                      : "border-surface-600"
                  }`}
                >
                  {newMovementForm.lower_is_better && (
                    <Text className="text-white text-xs font-bold">✓</Text>
                  )}
                </View>
                <View className="flex-1">
                  <Text className="text-white text-sm">
                    {newMovementForm.lower_is_better ? "Menor e melhor" : "Maior e melhor"}
                  </Text>
                  <Text className="text-surface-500 text-xs mt-0.5">
                    {newMovementForm.unit === "time_sec"
                      ? "Tempo normalmente usa menor melhor."
                      : "Use conforme a regra do movimento."}
                  </Text>
                </View>
              </TouchableOpacity>
              <View className="flex-row gap-3 mt-1">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 border border-surface-600/40 rounded-xl py-3.5 items-center"
                  onPress={() => setShowAddMovement(false)}
                >
                  <Text className="text-white font-semibold">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3.5 items-center"
                  onPress={handleAddMovement}
                >
                  <Text className="text-white font-bold">Criar</Text>
                </TouchableOpacity>
              </View>
      </BottomSheetModal>
    </View>
  );
}
