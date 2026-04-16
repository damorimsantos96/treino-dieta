import { useState, useEffect } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BIOMETRIC_ENABLED_KEY = "biometric_enabled";

export function useBiometrics() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    checkAvailability();
    checkEnabled();
  }, []);

  async function checkAvailability() {
    if (Platform.OS === "web") return;
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setIsAvailable(compatible && enrolled);
  }

  async function checkEnabled() {
    if (Platform.OS === "web") return;
    const val = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    setIsEnabled(val === "true");
  }

  async function enableBiometrics() {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
    setIsEnabled(true);
  }

  async function disableBiometrics() {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "false");
    setIsEnabled(false);
  }

  async function authenticate(): Promise<boolean> {
    if (Platform.OS === "web") return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloqueie o Treino & Dieta",
      fallbackLabel: "Usar senha",
      cancelLabel: "Cancelar",
    });
    return result.success;
  }

  return { isAvailable, isEnabled, enableBiometrics, disableBiometrics, authenticate };
}
