import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/stores/auth";
import { useBiometrics } from "@/hooks/useBiometrics";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuthStore();
  const { isAvailable, isEnabled, authenticate } = useBiometrics();

  useEffect(() => {
    if (isAvailable && isEnabled) {
      tryBiometricLogin();
    }
  }, [isAvailable, isEnabled]);

  async function tryBiometricLogin() {
    const success = await authenticate();
    if (success) {
      router.replace("/(tabs)/hoje");
    }
  }

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert("Atenção", "Preencha email e senha.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace("/(tabs)/hoje");
    } catch (err: any) {
      Alert.alert("Erro ao entrar", err.message ?? "Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-900"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-6">
        {/* Logo / Title */}
        <View className="mb-10 items-center">
          <Text className="text-4xl font-bold text-brand-500">💪</Text>
          <Text className="mt-3 text-2xl font-bold text-white">
            Treino & Dieta
          </Text>
          <Text className="mt-1 text-surface-600 text-sm">
            Seus dados, do jeito que você quer.
          </Text>
        </View>

        {/* Form */}
        <View className="gap-4">
          <TextInput
            className="bg-surface-800 text-white rounded-xl px-4 py-4 text-base"
            placeholder="Email"
            placeholderTextColor="#475569"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            className="bg-surface-800 text-white rounded-xl px-4 py-4 text-base"
            placeholder="Senha"
            placeholderTextColor="#475569"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <TouchableOpacity
          className="mt-6 bg-brand-500 rounded-xl py-4 items-center"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-base">Entrar</Text>
          )}
        </TouchableOpacity>

        {isAvailable && isEnabled && (
          <TouchableOpacity
            className="mt-4 items-center py-3"
            onPress={tryBiometricLogin}
          >
            <Text className="text-brand-400 text-sm">
              🔒 Entrar com biometria
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
