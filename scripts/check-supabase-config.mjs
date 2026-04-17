import { promises as dns } from "node:dns";
import { existsSync, readFileSync } from "node:fs";

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
        const key = line.slice(0, index);
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
        return [key, value];
      })
  );
}

function normalizeSupabaseUrl(value) {
  const raw = value?.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("EXPO_PUBLIC_SUPABASE_URL nao configurada.");

  if (/^[a-z0-9]{20}$/.test(raw)) return `https://${raw}.supabase.co`;
  if (/^[a-z0-9.-]+\.supabase\.co$/.test(raw)) return `https://${raw}`;
  if (/^https?:\/\//.test(raw)) {
    const parsed = new URL(raw);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalhost) {
      throw new Error("EXPO_PUBLIC_SUPABASE_URL deve usar https em producao.");
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("EXPO_PUBLIC_SUPABASE_URL deve conter apenas a origem.");
    }
    return parsed.origin;
  }

  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL invalida. Use https://<project-ref>.supabase.co"
  );
}

const localEnv = readLocalEnv();
const supabaseUrl = normalizeSupabaseUrl(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? localEnv.EXPO_PUBLIC_SUPABASE_URL
);
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  localEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const { host } = new URL(supabaseUrl);

if (!supabaseAnonKey) {
  throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY nao configurada.");
}

console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Supabase host: ${host}`);

try {
  const records = await dns.lookup(host, { all: true });
  console.log(`DNS OK: ${records.map((record) => record.address).join(", ")}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`DNS falhou para ${host}: ${message}`);
}

const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
  headers: {
    apikey: supabaseAnonKey,
  },
});

console.log(`Auth health HTTP: ${response.status}`);

if (!response.ok) {
  throw new Error(
    `Supabase Auth respondeu ${response.status}. Confira URL e anon key.`
  );
}
