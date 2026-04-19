import { View, Text, TouchableOpacity, Linking, Modal } from "react-native";

interface Props {
  visible: boolean;
  downloadUrl: string;
  minVersion: string;
  releaseNotes: string | null;
}

export function NativeUpdateModal({ visible, downloadUrl, minVersion, releaseNotes }: Props) {
  const hasUrl = !!downloadUrl;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.72)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: "#1c1d23",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "rgba(74,75,88,0.6)",
            padding: 24,
            gap: 16,
            width: "100%",
          }}
        >
          <Text style={{ color: "white", fontSize: 20, fontWeight: "700", textAlign: "center" }}>
            Atualização necessária
          </Text>
          <Text style={{ color: "#9ca3af", fontSize: 14, textAlign: "center" }}>
            Esta versão do app não é mais suportada.
            {minVersion ? ` Versão mínima exigida: ${minVersion}.` : ""}
          </Text>
          {releaseNotes && (
            <View
              style={{
                backgroundColor: "rgba(44,45,54,0.6)",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ color: "#d1d5db", fontSize: 12 }}>{releaseNotes}</Text>
            </View>
          )}
          <TouchableOpacity
            disabled={!hasUrl}
            onPress={() => hasUrl && Linking.openURL(downloadUrl)}
            style={{
              backgroundColor: hasUrl ? "#10b981" : "#2c2d36",
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              opacity: hasUrl ? 1 : 0.5,
            }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>
              {hasUrl ? "Baixar nova versão" : "Link indisponível"}
            </Text>
          </TouchableOpacity>
          {!hasUrl && (
            <Text style={{ color: "#6b7280", fontSize: 11, textAlign: "center" }}>
              Entre em contato com o administrador.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
