import { View, Text } from "react-native";

interface ProgressBarProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  color?: string;
  icon?: string;
}

export function ProgressBar({
  label,
  current,
  target,
  unit,
  color = "bg-brand-500",
  icon,
}: ProgressBarProps) {
  const pct = Math.min(1, target > 0 ? current / target : 0);
  const over = current > target;

  return (
    <View className="gap-1">
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center gap-1">
          {icon && <Text>{icon}</Text>}
          <Text className="text-white text-sm font-medium">{label}</Text>
        </View>
        <Text className={`text-sm font-bold ${over ? "text-yellow-400" : "text-white"}`}>
          {Math.round(current)}{unit}
          <Text className="text-surface-600 font-normal"> / {Math.round(target)}{unit}</Text>
        </Text>
      </View>
      <View className="h-2 bg-surface-700 rounded-full overflow-hidden">
        <View
          className={`h-full rounded-full ${over ? "bg-yellow-400" : color}`}
          style={{ width: `${Math.min(100, pct * 100)}%` }}
        />
      </View>
    </View>
  );
}
