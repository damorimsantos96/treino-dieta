import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuthStore } from "@/stores/auth";
import { useBiometrics } from "@/hooks/useBiometrics";
import {
  getLoginErrorDetails,
  getLoginErrorMessage,
} from "@/utils/authErrors";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const { signIn } = useAuthStore();
  const { isAvailable, isEnabled, authenticate } = useBiometrics();

  useFocusEffect(
    useCallback(() => {
      if (isAvailable && isEnabled) tryBiometricLogin();
    }, [isAvailable, isEnabled])
  );

  async function tryBiometricLogin() {
    const success = await authenticate();
    if (success) router.replace("/(tabs)/hoje");
  }

  async function handleLogin() {
    if (!email || !password) {
      const message = "Preencha email e senha.";
      setErrorMessage(message);
      setErrorDetails("");
      Alert.alert("Atenção", message);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    setErrorDetails("");
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace("/(tabs)/hoje");
    } catch (err: unknown) {
      const msg = getLoginErrorMessage(err);
      setErrorMessage(msg);
      setErrorDetails(getLoginErrorDetails(err));
      Alert.alert("Erro ao entrar", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0f1014" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Full-screen centering — especially nice on web desktop */}
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: Platform.OS === "web" ? "#1c1d23" : "transparent",
            borderRadius: Platform.OS === "web" ? 24 : 0,
            padding: Platform.OS === "web" ? 40 : 0,
            borderWidth: Platform.OS === "web" ? 1 : 0,
            borderColor: Platform.OS === "web" ? "#2c2d36" : "transparent",
          }}
        >
          {/* Logo */}
          <View className="items-center mb-8">
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                backgroundColor: "#10b98120",
                borderWidth: 1,
                borderColor: "#10b98140",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Text style={{ fontSize: 32 }}>💪</Text>
            </View>
            <Text style={{ color: "#f8fafc", fontSize: 24, fontWeight: "700", letterSpacing: -0.5 }}>
              Treino & Dieta
            </Text>
            <Text style={{ color: "#4a4b58", fontSize: 13, marginTop: 4 }}>
              Seus dados, do jeito que você quer.
            </Text>
          </View>

          {/* Inputs */}
          <View style={{ gap: 12, marginBottom: 16 }}>
            <View>
              <Text style={{ color: "#72737f", fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>
                Email
              </Text>
              <TextInput
                style={{
                  backgroundColor: "#0f1014",
                  color: "#f8fafc",
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 15,
                  borderWidth: 1,
                  borderColor: "#2c2d36",
                  outlineStyle: "none",
                } as any}
                placeholder="seu@email.com"
                placeholderTextColor="#2c2d36"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setErrorMessage("");
                  setErrorDetails("");
                }}
                onSubmitEditing={handleLogin}
              />
            </View>
            <View>
              <Text style={{ color: "#72737f", fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>
                Senha
              </Text>
              <View style={{ position: "relative" }}>
                <TextInput
                  style={{
                    backgroundColor: "#0f1014",
                    color: "#f8fafc",
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    paddingRight: 48,
                    fontSize: 15,
                    borderWidth: 1,
                    borderColor: "#2c2d36",
                    outlineStyle: "none",
                  } as any}
                  placeholder="••••••••"
                  placeholderTextColor="#2c2d36"
                  secureTextEntry={!showPass}
                  autoComplete="current-password"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setErrorMessage("");
                    setErrorDetails("");
                  }}
                  onSubmitEditing={handleLogin}
                />
                <Pressable
                  onPress={() => setShowPass((v) => !v)}
                  style={{ position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 16 }}>{showPass ? "🙈" : "👁"}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Login button */}
          <TouchableOpacity
            style={{
              backgroundColor: "#10b981",
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              shadowColor: "#10b981",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              elevation: 6,
            }}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, letterSpacing: 0.3 }}>
                Entrar
              </Text>
            )}
          </TouchableOpacity>

          {errorMessage ? (
            <View
              style={{
                marginTop: 16,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "#ef444455",
                backgroundColor: "#ef44441a",
                padding: 12,
              }}
            >
              <Text style={{ color: "#fecaca", fontSize: 13, lineHeight: 18 }}>
                {errorMessage}
              </Text>
              {errorDetails ? (
                <Text
                  style={{
                    color: "#fca5a5",
                    fontSize: 11,
                    lineHeight: 16,
                    marginTop: 6,
                  }}
                >
                  {errorDetails}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Biometric */}
          {isAvailable && isEnabled && (
            <TouchableOpacity
              style={{ marginTop: 16, alignItems: "center", paddingVertical: 10 }}
              onPress={tryBiometricLogin}
            >
              <Text style={{ color: "#10b981", fontSize: 13, fontWeight: "600" }}>
                🔒 Entrar com biometria
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
