import { View, Text } from "react-native";

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  valueColor?: string;
  tint?: string;   // bg tint class, e.g. "bg-blue-500/10"
  border?: string; // border class, e.g. "border-blue-500/25"
  icon?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  sub,
  valueColor = "text-white",
  tint = "bg-surface-800",
  border = "border-surface-700/60",
  icon,
}: MetricCardProps) {
  return (
    <View className={`flex-1 min-w-[45%] rounded-2xl p-4 border ${tint} ${border}`}>
      <View className="flex-row items-center gap-1.5 mb-2">
        {icon && <Text className="text-sm">{icon}</Text>}
        <Text className="text-surface-500 text-xs font-semibold uppercase tracking-widest">
          {label}
        </Text>
      </View>
      <View className="flex-row items-baseline gap-1">
        <Text className={`text-2xl font-bold ${valueColor}`}>{value}</Text>
        {unit && <Text className="text-surface-500 text-sm font-medium">{unit}</Text>}
      </View>
      {sub && <Text className="text-surface-500 text-xs mt-1">{sub}</Text>}
    </View>
  );
}
