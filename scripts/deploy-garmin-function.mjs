import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = "rniyyjetkddufnecoofp";

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

const localEnv = readLocalEnv();
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) =>
    Boolean(key) &&
    value !== undefined &&
    !key.includes("=") &&
    !key.includes("\0") &&
    !String(value).includes("\0")
  )
);
for (const [key, value] of Object.entries(localEnv)) {
  if (!key || key.includes("=") || key.includes("\0") || value.includes("\0")) continue;
  if (!env[key]) env[key] = value;
}

if (!env.SUPABASE_ACCESS_TOKEN) {
  console.error(
    "SUPABASE_ACCESS_TOKEN ausente. Defina no ambiente ou em .env.local antes do deploy."
  );
  process.exit(1);
}

const command = process.platform === "win32"
  ? join("node_modules", "supabase", "bin", "supabase.exe")
  : join("node_modules", ".bin", "supabase");
const args = [
  "functions",
  "deploy",
  "sync-garmin",
  "--project-ref",
  PROJECT_REF,
  "--use-api",
];

const child = spawn(command, args, {
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
