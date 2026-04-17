import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function normalizeSupabaseUrl(value: string | undefined): string {
  const raw = value?.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("EXPO_PUBLIC_SUPABASE_URL não configurada.");

  if (/^https?:\/\//.test(raw)) return raw;
  if (/^[a-z0-9]{20}$/.test(raw)) return `https://${raw}.supabase.co`;
  if (/^[a-z0-9.-]+\.supabase\.co$/.test(raw)) return `https://${raw}`;

  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL inválida. Use https://<project-ref>.supabase.co"
  );
}

function getRequiredEnv(value: string | undefined, name: string): string {
  const raw = value?.trim();
  if (!raw) throw new Error(`${name} não configurada.`);
  return raw;
}

export const supabaseUrl = normalizeSupabaseUrl(
  process.env.EXPO_PUBLIC_SUPABASE_URL
);
const supabaseAnonKey = getRequiredEnv(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  "EXPO_PUBLIC_SUPABASE_ANON_KEY"
);

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    if (Platform.OS === "web") return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
