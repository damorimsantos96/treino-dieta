import { Platform, View, ViewProps } from "react-native";

interface WebContainerProps extends ViewProps {
  children: React.ReactNode;
  maxWidth?: number;
}

export function WebContainer({ children, maxWidth = 520, style, ...props }: WebContainerProps) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center" }} {...props}>
      <View style={{ flex: 1, width: "100%", maxWidth }}>{children}</View>
    </View>
  );
}
