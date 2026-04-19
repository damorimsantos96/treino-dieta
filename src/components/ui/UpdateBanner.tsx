import { View, Text, TouchableOpacity } from "react-native";
import * as Updates from "expo-updates";

const TAB_BAR_HEIGHT = 68;

export function UpdateBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View
      style={{
        position: "absolute",
        bottom: TAB_BAR_HEIGHT,
        left: 0,
        right: 0,
        backgroundColor: "#10b981",
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text style={{ color: "white", fontSize: 13, fontWeight: "600", flex: 1 }}>
        Nova versão disponível
      </Text>
      <TouchableOpacity
        onPress={() => Updates.reloadAsync()}
        style={{
          backgroundColor: "rgba(255,255,255,0.2)",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>Reiniciar</Text>
      </TouchableOpacity>
    </View>
  );
}
