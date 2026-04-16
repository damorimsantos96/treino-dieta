import { View, ViewProps } from "react-native";

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <View
      className={`bg-surface-800 rounded-2xl p-4 ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}
