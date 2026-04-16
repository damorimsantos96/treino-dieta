import { View, Text } from "react-native";
import { Card } from "./Card";

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  color?: string;
  icon?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  sub,
  color = "text-white",
  icon,
}: MetricCardProps) {
  return (
    <Card className="flex-1 min-w-[45%]">
      <View className="flex-row items-center gap-1 mb-1">
        {icon && <Text className="text-base">{icon}</Text>}
        <Text className="text-surface-600 text-xs font-medium uppercase tracking-wider">
          {label}
        </Text>
      </View>
      <View className="flex-row items-baseline gap-1">
        <Text className={`text-2xl font-bold ${color}`}>{value}</Text>
        {unit && (
          <Text className="text-surface-600 text-sm">{unit}</Text>
        )}
      </View>
      {sub && (
        <Text className="text-surface-600 text-xs mt-1">{sub}</Text>
      )}
    </Card>
  );
}
