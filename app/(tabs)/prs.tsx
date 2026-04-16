import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getPRMovements, getPRAttempts, createPRMovement, createPRAttempt } from "@/lib/api";
import { PRMovement, PRAttempt, PRUnit } from "@/types";

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
      className="bg-surface-800 rounded-2xl p-4 mb-3"
      onPress={() => onAddAttempt(movement)}
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-white font-bold text-base">{movement.name}</Text>
          <Text className="text-surface-600 text-xs mt-0.5">
            {movement.category} · {UNIT_LABELS[movement.unit]}
          </Text>
        </View>
        <View className="items-end">
          {pr ? (
            <>
              <Text className="text-brand-400 text-xl font-bold">
                {formatValue(pr.value, movement.unit)}
              </Text>
              <Text className="text-surface-600 text-xs">
                🏆 {format(parseISO(pr.date), "dd/MM/yy")}
              </Text>
            </>
          ) : (
            <Text className="text-surface-600 text-sm">Sem PR</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
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

  const [selectedMovement, setSelectedMovement] = useState<PRMovement | null>(null);
  const [showAddMovement, setShowAddMovement] = useState(false);
  const [newMovementForm, setNewMovementForm] = useState({
    name: "",
    unit: "time_sec" as PRUnit,
    category: "",
    lower_is_better: true,
  });
  const [attemptForm, setAttemptForm] = useState({ date: format(new Date(), "yyyy-MM-dd"), value: "", notes: "" });

  // Build PR map: movement_id → best attempt
  const prMap = new Map<string, PRAttempt>();
  attempts.filter((a) => a.is_pr).forEach((a) => prMap.set(a.movement_id, a));

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
    if (!selectedMovement || !attemptForm.value) return;
    try {
      await addAttempt({
        movement_id: selectedMovement.id,
        date: attemptForm.date,
        value: parseFloat(attemptForm.value.replace(",", ".")),
        notes: attemptForm.notes || undefined,
      });
      setSelectedMovement(null);
      setAttemptForm({ date: format(new Date(), "yyyy-MM-dd"), value: "", notes: "" });
    } catch (err: any) {
      Alert.alert("Erro", err.message);
    }
  }

  async function handleAddMovement() {
    if (!newMovementForm.name) return;
    try {
      await addMovement(newMovementForm);
      setShowAddMovement(false);
      setNewMovementForm({ name: "", unit: "time_sec", category: "", lower_is_better: true });
    } catch (err: any) {
      Alert.alert("Erro", err.message);
    }
  }

  return (
    <View className="flex-1 bg-surface-900">
      <ScrollView contentContainerClassName="px-4 pt-14 pb-8">
        <View className="flex-row justify-between items-center mb-4">
          <View>
            <Text className="text-surface-600 text-sm">Seus recordes</Text>
            <Text className="text-white text-2xl font-bold">PRs</Text>
          </View>
          <View className="flex-row gap-2">
            {movements.length === 0 && (
              <TouchableOpacity
                className="bg-surface-700 rounded-xl px-3 py-2"
                onPress={handleSeedDefaults}
              >
                <Text className="text-white text-xs">Padrão</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              className="bg-brand-500 rounded-xl px-4 py-2"
              onPress={() => setShowAddMovement(true)}
            >
              <Text className="text-white font-bold">+ Novo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#22c55e" className="mt-12" />
        ) : movements.length === 0 ? (
          <View className="items-center py-12 gap-3">
            <Text className="text-4xl">🏆</Text>
            <Text className="text-white font-semibold">Nenhum movimento cadastrado</Text>
            <TouchableOpacity
              className="bg-surface-700 rounded-xl px-5 py-3 mt-2"
              onPress={handleSeedDefaults}
            >
              <Text className="text-white text-sm">Adicionar movimentos CrossFit padrão</Text>
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
      <Modal visible={!!selectedMovement} animationType="slide" transparent>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 rounded-t-3xl px-5 pt-5 pb-10 gap-4">
              <Text className="text-white text-lg font-bold">
                Nova tentativa — {selectedMovement?.name}
              </Text>
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">Data (YYYY-MM-DD)</Text>
                <TextInput
                  className="bg-surface-700 text-white rounded-xl px-4 py-3"
                  value={attemptForm.date}
                  onChangeText={(v) => setAttemptForm((f) => ({ ...f, date: v }))}
                />
              </View>
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">
                  Valor ({selectedMovement ? UNIT_LABELS[selectedMovement.unit] : ""})
                </Text>
                <TextInput
                  className="bg-surface-700 text-white rounded-xl px-4 py-3"
                  value={attemptForm.value}
                  onChangeText={(v) => setAttemptForm((f) => ({ ...f, value: v }))}
                  keyboardType="decimal-pad"
                  placeholder="ex: 312 (segundos) ou 120.5 (kg)"
                  placeholderTextColor="#475569"
                />
              </View>
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">Observações (opcional)</Text>
                <TextInput
                  className="bg-surface-700 text-white rounded-xl px-4 py-3"
                  value={attemptForm.notes}
                  onChangeText={(v) => setAttemptForm((f) => ({ ...f, notes: v }))}
                  placeholder="Como foi?"
                  placeholderTextColor="#475569"
                />
              </View>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 rounded-xl py-3 items-center"
                  onPress={() => setSelectedMovement(null)}
                >
                  <Text className="text-white font-medium">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3 items-center"
                  onPress={handleSaveAttempt}
                  disabled={savingAttempt}
                >
                  {savingAttempt ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-bold">Salvar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add movement modal */}
      <Modal visible={showAddMovement} animationType="slide" transparent>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1 justify-end">
            <View className="bg-surface-800 rounded-t-3xl px-5 pt-5 pb-10 gap-4">
              <Text className="text-white text-lg font-bold">Novo movimento</Text>
              <TextInput
                className="bg-surface-700 text-white rounded-xl px-4 py-3"
                value={newMovementForm.name}
                onChangeText={(v) => setNewMovementForm((f) => ({ ...f, name: v }))}
                placeholder="Nome (ex: Karen, Deadlift 1RM)"
                placeholderTextColor="#475569"
              />
              <TextInput
                className="bg-surface-700 text-white rounded-xl px-4 py-3"
                value={newMovementForm.category}
                onChangeText={(v) => setNewMovementForm((f) => ({ ...f, category: v }))}
                placeholder="Categoria (ex: CrossFit, Levantamento)"
                placeholderTextColor="#475569"
              />
              <View className="gap-1">
                <Text className="text-surface-600 text-xs">Unidade</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {(Object.keys(UNIT_LABELS) as PRUnit[]).map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => setNewMovementForm((f) => ({ ...f, unit: u }))}
                        className={`px-3 py-2 rounded-lg ${
                          newMovementForm.unit === u ? "bg-brand-500" : "bg-surface-700"
                        }`}
                      >
                        <Text className="text-white text-xs">{UNIT_LABELS[u]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <TouchableOpacity
                className="flex-row items-center gap-2"
                onPress={() =>
                  setNewMovementForm((f) => ({ ...f, lower_is_better: !f.lower_is_better }))
                }
              >
                <View
                  className={`w-5 h-5 rounded border-2 items-center justify-center ${
                    newMovementForm.lower_is_better ? "bg-brand-500 border-brand-500" : "border-surface-600"
                  }`}
                >
                  {newMovementForm.lower_is_better && (
                    <Text className="text-white text-xs">✓</Text>
                  )}
                </View>
                <Text className="text-white text-sm">Menor é melhor (tempo)</Text>
              </TouchableOpacity>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-surface-700 rounded-xl py-3 items-center"
                  onPress={() => setShowAddMovement(false)}
                >
                  <Text className="text-white font-medium">Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-brand-500 rounded-xl py-3 items-center"
                  onPress={handleAddMovement}
                >
                  <Text className="text-white font-bold">Criar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
