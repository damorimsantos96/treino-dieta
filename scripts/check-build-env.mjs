import { existsSync, readFileSync } from "node:fs";

const REQUIRED_ENV = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
];

function readLocalEnv() {
  if (!existsSync(".env.local")) return {};

  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index === -1) return [line, ""];
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      })
  );
}

function normalizeSupabaseUrl(value) {
  const raw = value?.trim().replace(/\/+$/, "");
  if (!raw || raw === "https://placeholder.supabase.co") return null;

  if (/^[a-z0-9]{20}$/.test(raw)) return `https://${raw}.supabase.co`;
  if (/^[a-z0-9.-]+\.supabase\.co$/.test(raw)) return `https://${raw}`;
  if (!/^https?:\/\//.test(raw)) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const isLocalhost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalhost) return null;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;

  return parsed.origin;
}

function validateAnonKey(value) {
  const raw = value?.trim();
  if (!raw || raw === "placeholder") return false;
  return raw.startsWith("sb_publishable_") || raw.split(".").length === 3;
}

const localEnv = readLocalEnv();
const env = Object.fromEntries(
  REQUIRED_ENV.map((name) => [name, process.env[name] ?? localEnv[name]])
);

const supabaseUrl = normalizeSupabaseUrl(env.EXPO_PUBLIC_SUPABASE_URL);
if (!supabaseUrl) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL ausente ou invalida para o build."
  );
}

if (!validateAnonKey(env.EXPO_PUBLIC_SUPABASE_ANON_KEY)) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY ausente ou invalida para o build."
  );
}

console.log("Build env OK: Supabase URL e anon key configuradas.");
