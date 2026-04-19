import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "placeholder";

function normalizeSupabaseUrl(value: string | undefined): string | null {
  const raw = value?.trim().replace(/\/+$/, "");
  if (!raw) return null;

  const normalized = (() => {
    if (/^https?:\/\//.test(raw)) return raw;
    if (/^[a-z0-9]{20}$/.test(raw)) return `https://${raw}.supabase.co`;
    if (/^[a-z0-9.-]+\.supabase\.co$/.test(raw)) return `https://${raw}`;
    return null;
  })();

  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const isLocalhost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalhost) return null;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;

  return parsed.origin;
}

const configuredSupabaseUrl = normalizeSupabaseUrl(
  process.env.EXPO_PUBLIC_SUPABASE_URL
);
const configuredSupabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;

export const isSupabaseConfigured = Boolean(
  configuredSupabaseUrl && configuredSupabaseAnonKey
);
export const supabaseConfigError = isSupabaseConfigured
  ? null
  : "Configuracao do Supabase ausente neste build.";

export const supabaseUrl = configuredSupabaseUrl ?? FALLBACK_SUPABASE_URL;
export const supabaseHost = new URL(supabaseUrl).host;
const supabaseAnonKey = configuredSupabaseAnonKey ?? FALLBACK_SUPABASE_ANON_KEY;

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
