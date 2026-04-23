import { ReactNode, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type BottomSheetModalProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  scroll?: boolean;
  panelStyle?: StyleProp<ViewStyle>;
  maxHeight?: ViewStyle["maxHeight"];
};

export function BottomSheetModal({
  visible,
  onClose,
  children,
  scroll = false,
  panelStyle,
  maxHeight = "86%",
}: BottomSheetModalProps) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [translateY, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 1.1) {
            onClose();
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 16,
          }).start();
        },
      }),
    [onClose, translateY]
  );

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: 16, paddingBottom: 6 }}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ gap: 16 }}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: "rgba(0,0,0,0.42)",
            }}
          />
          <Animated.View
            style={[
              {
                maxHeight,
                backgroundColor: "#1c1d23",
                borderColor: "rgba(44,45,54,0.85)",
                borderWidth: 1,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 20,
                paddingTop: 0,
                paddingBottom: 34,
                transform: [{ translateY }],
              },
              panelStyle,
            ]}
          >
            {Platform.OS !== "web" && (
              <View
                {...panResponder.panHandlers}
                style={{
                  alignSelf: "stretch",
                  alignItems: "center",
                  paddingTop: 14,
                  paddingBottom: 14,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: "#72737f",
                  }}
                />
              </View>
            )}
            {Platform.OS === "web" && (
              <View style={{ paddingTop: 18 }} />
            )}
            {content}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
