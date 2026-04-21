import { ReactNode } from "react";
import { View } from "react-native";

type ChartTooltipProps = {
  visible: boolean;
  x: number;
  y: number;
  children: ReactNode;
};

export function ChartTooltip({ visible, x, y, children }: ChartTooltipProps) {
  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute bg-surface-800 border border-surface-600/80 rounded-xl px-3 py-2"
      style={{
        left: x,
        top: y,
        maxWidth: 220,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 6,
      }}
    >
      {children}
    </View>
  );
}
