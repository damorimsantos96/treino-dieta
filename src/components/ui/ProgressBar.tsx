import { View, Text } from "react-native";

interface ProgressBarProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  barColor?: string;
  trackColor?: string;
  icon?: string;
}

export function ProgressBar({
  label,
  current,
  target,
  unit,
  barColor = "#10b981",
  trackColor = "#2c2d36",
  icon,
}: ProgressBarProps) {
  const pct = Math.min(1, target > 0 ? current / target : 0);
  const over = current > target;
  const pctDisplay = Math.round(pct * 100);

  return (
    <View className="gap-2">
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center gap-1.5">
          {icon && <Text className="text-sm">{icon}</Text>}
          <Text className="text-white text-sm font-semibold">{label}</Text>
        </View>
        <View className="flex-row items-baseline gap-1">
          <Text className={`text-sm font-bold ${over ? "text-amber-400" : "text-white"}`}>
            {Math.round(current)}
          </Text>
          <Text className="text-surface-500 text-xs">/ {Math.round(target)}{unit}</Text>
          <Text className={`text-xs font-semibold ml-1 ${over ? "text-amber-400" : "text-brand-400"}`}>
            {pctDisplay}%
          </Text>
        </View>
      </View>
      <View
        className="h-2.5 rounded-full overflow-hidden"
        style={{ backgroundColor: trackColor }}
      >
        <View
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            backgroundColor: over ? "#f59e0b" : barColor,
          }}
        >
          {/* Inner highlight for depth */}
          <View
            className="absolute left-0 right-0 top-0 rounded-full"
            style={{ height: "50%", backgroundColor: "rgba(255,255,255,0.15)" }}
          />
        </View>
      </View>
    </View>
  );
}
