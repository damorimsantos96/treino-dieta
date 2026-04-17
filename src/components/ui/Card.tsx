import { View, Text, ViewProps } from "react-native";

interface CardProps extends ViewProps {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "ghost";
}

export function Card({ children, className = "", variant = "default", ...props }: CardProps) {
  const base =
    variant === "elevated"
      ? "bg-surface-700 rounded-2xl p-4 border border-surface-600/40"
      : variant === "ghost"
      ? "rounded-2xl p-4"
      : "bg-surface-800 rounded-2xl p-4 border border-surface-700/60";

  return (
    <View className={`${base} ${className}`} {...props}>
      {children}
    </View>
  );
}

export function SectionLabel({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2 mb-3">
      <View className="w-[3px] h-4 bg-brand-500 rounded-full" />
      <Text className="text-surface-400 text-xs font-bold uppercase tracking-widest">
        {label}
      </Text>
    </View>
  );
}
