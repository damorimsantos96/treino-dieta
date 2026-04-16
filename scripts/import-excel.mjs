/**
 * import-excel.mjs
 * One-time script to import historical data from "Dieta e Treino.xlsx"
 * into Supabase.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in SUPABASE_URL + SUPABASE_SERVICE_KEY
 *   2. node import-excel.mjs
 *
 * Requires Node >= 18.
 */

import "dotenv/config";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { format, parse, isValid } from "date-fns";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = resolve(__dirname, "../../Dieta e Treino.xlsx");
const USER_EMAIL = "d.amorim.santos96@gmail.com"; // user to import data for

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function excelDateToISO(serial) {
  if (!serial && serial !== 0) return null;
  if (typeof serial === "string") {
    // Already a date string like "2022-01-15"
    const d = new Date(serial);
    return isValid(d) ? format(d, "yyyy-MM-dd") : null;
  }
  // Excel serial number
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function toInt(v) {
  const n = toNum(v);
  return n !== null ? Math.round(n) : null;
}

function paceToMinKm(pace) {
  // pace can be "5:30" string or number in minutes
  if (!pace) return null;
  if (typeof pace === "number") return pace;
  if (typeof pace === "string") {
    const [m, s] = pace.split(":").map(Number);
    if (isNaN(m)) return null;
    return m + (s ?? 0) / 60;
  }
  return null;
}

function timeToSeconds(t) {
  // HH:MM:SS or fractional day (Excel time serial)
  if (!t) return null;
  if (typeof t === "number") {
    // Excel time serial (fraction of a day)
    return Math.round(t * 24 * 3600);
  }
  if (typeof t === "string") {
    const parts = t.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  return null;
}

// ── Get user ID ───────────────────────────────────────────────────────────────

async function getUserId() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === USER_EMAIL);
  if (!user) throw new Error(`User ${USER_EMAIL} not found. Create the account first.`);
  console.log(`✓ Found user: ${user.id}`);
  return user.id;
}

// ── Import Diego tab ──────────────────────────────────────────────────────────

async function importDiegoSheet(ws, userId) {
  console.log("\n📋 Importing daily logs (Diego sheet)...");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const BATCH_SIZE = 100;
  let imported = 0;
  let batch = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawDate = row[0]; // Column A: date
    const dateStr = excelDateToISO(rawDate);
    if (!dateStr) continue;

    // Column mapping based on spreadsheet analysis:
    // A=date, B=weight, C=Diego identifier (skip)
    // Based on the 43-column structure discovered:
    // Adjusting indices to match actual columns
    const record = {
      user_id: userId,
      date: dateStr,
      weight_kg: toNum(row[3]),          // D: Peso (0-indexed: 3)
      // Activity calories (columns E-T roughly, indices 4-19)
      kcal_crossfit: toNum(row[4]),      // E
      kcal_musculacao: toNum(row[5]),    // F
      // G=Fortalecimento (map to outros)
      kcal_outros: toNum(row[6]),        // G: Fortalecimento → outros
      // H=Bike, skip
      // I-O: Whoop calories
      whoop_kcal: toNum(row[8]),         // I: W.Crossfit kcal
      // P-T: Academia, Boxe, Surf, Corrida, Atividade
      kcal_academia: toNum(row[15]),     // P
      kcal_boxe: toNum(row[16]),         // Q
      kcal_surf: toNum(row[17]),         // R
      kcal_corrida: toNum(row[18]),      // S
      // U-AE: durations
      min_crossfit: toNum(row[20]),      // U
      min_musculacao: toNum(row[21]),    // V
      // W=Fortalecimento, X=Along — skip
      min_academia: toNum(row[26]),      // AA
      min_boxe: toNum(row[27]),          // AB
      min_surf: toNum(row[28]),          // AC
      min_corrida: toNum(row[29]),       // AD
      min_sauna: toNum(row[30]),         // AE
      // AF-AJ: temperatures
      temp_academia: toNum(row[31]),     // AF
      temp_boxe: toNum(row[32]),         // AG
      temp_surf: toNum(row[33]),         // AH
      temp_corrida: toNum(row[34]),      // AI
      temp_sauna: toNum(row[35]),        // AJ
      // AK-AO: HR
      bpm_academia: toInt(row[36]),      // AK
      bpm_boxe: toInt(row[37]),          // AL
      bpm_surf: toInt(row[38]),          // AM
      bpm_corrida: toInt(row[39]),       // AN
      bpm_sauna: toInt(row[40]),         // AO
      // AQ: surplus/deficit (index 42)
      surplus_deficit_kcal: toNum(row[42]),
    };

    // Skip completely empty rows
    if (!record.weight_kg && !record.kcal_academia && !record.kcal_corrida) continue;

    batch.push(record);

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase.from("daily_logs").upsert(batch, {
        onConflict: "user_id,date",
        ignoreDuplicates: false,
      });
      if (error) {
        console.error(`  ✗ Batch error at row ${r}:`, error.message);
      } else {
        imported += batch.length;
        process.stdout.write(`\r  → ${imported} registros importados...`);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    const { error } = await supabase.from("daily_logs").upsert(batch, {
      onConflict: "user_id,date",
    });
    if (!error) imported += batch.length;
  }

  console.log(`\n  ✓ ${imported} daily logs importados.`);
}

// ── Import Corridas tab ───────────────────────────────────────────────────────

async function importCorridasSheet(ws, userId) {
  console.log("\n🏃 Importing run sessions (Corridas sheet)...");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const BATCH_SIZE = 200;
  let imported = 0;
  let batch = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawDate = row[0];
    const dateStr = excelDateToISO(rawDate);
    if (!dateStr || !row[1]) { skipped++; continue; }

    const durationMin = toNum(row[9]);   // Column J: Tempo (min) — numeric
    const paceMin = toNum(row[10]);      // Column K: Ritmo (min) — numeric

    const record = {
      user_id: userId,
      date: dateStr,
      interval_type: String(row[1] ?? "Easy"),   // B: Intervalo
      // C: Tempo (HH:MM:SS) — skip, use numeric version
      distance_km: toNum(row[3]),                // D: Distância
      pace_min_km: paceMin ?? paceToMinKm(row[4]), // K or E: Ritmo
      avg_hr: toInt(row[5]),                     // F: FC Média
      max_hr: toInt(row[6]),                     // G: FC Máx
      thermal_sensation_c: toNum(row[7]),        // H: Sensação Térmica
      calories_kcal: toNum(row[8]),              // I: Calorias
      duration_min: durationMin,                 // J: Tempo (min)
    };

    if (!record.distance_km && !record.duration_min) { skipped++; continue; }

    batch.push(record);

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase.from("run_sessions").upsert(batch);
      if (error) {
        console.error(`  ✗ Batch error at row ${r}:`, error.message);
      } else {
        imported += batch.length;
        process.stdout.write(`\r  → ${imported} sessões importadas...`);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    const { error } = await supabase.from("run_sessions").upsert(batch);
    if (!error) imported += batch.length;
  }

  console.log(`\n  ✓ ${imported} sessões de corrida importadas. (${skipped} linhas puladas)`);
}

// ── Import Tentativas PR tab ──────────────────────────────────────────────────

async function importPRSheet(ws, userId) {
  console.log("\n🏆 Importing PR attempts (Tentativas PR sheet)...");
  // Actual columns: A=Data, B=Movimento, C=Score, D=Tipo
  // Use header:1 with raw values, but access formatted strings (w) via cell refs

  const range = XLSX.utils.decode_range(ws["!ref"]);
  let imported = 0;

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const dateCell   = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const nameCell   = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const scoreCell  = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    const tipoCell   = ws[XLSX.utils.encode_cell({ r, c: 3 })];

    if (!dateCell || !nameCell || !scoreCell) continue;

    const dateStr = excelDateToISO(dateCell.v);
    if (!dateStr) continue;

    const movementName = String(nameCell.v).trim();
    if (!movementName) continue;

    const tipo = tipoCell?.v ? String(tipoCell.v).trim() : "Tempo";
    const isTempo = tipo.toLowerCase().includes("tempo");

    // For time cells, Excel stores as fraction of day but formats as mm:ss
    // Use the formatted string (w) to get the display value like "6:09"
    let value;
    if (isTempo && scoreCell.w) {
      // Parse formatted string "6:09" or "12:34" → seconds
      const parts = String(scoreCell.w).split(":").map(Number);
      if (parts.length === 2) value = parts[0] * 60 + parts[1];
      else if (parts.length === 3) value = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      value = toNum(scoreCell.v);
    }
    if (!value) continue;

    const unit = isTempo ? "time_sec" : "reps";
    const lowerIsBetter = isTempo;

    // Find or create movement
    let { data: movement } = await supabase
      .from("pr_movements")
      .select("id, unit, lower_is_better")
      .eq("user_id", userId)
      .eq("name", movementName)
      .maybeSingle();

    if (!movement) {
      const { data: newMov, error } = await supabase
        .from("pr_movements")
        .insert({ user_id: userId, name: movementName, unit, category: "CrossFit", lower_is_better: lowerIsBetter })
        .select()
        .single();
      if (error) { console.error("  ✗ create movement:", error.message); continue; }
      movement = newMov;
    }

    const { error } = await supabase.from("pr_attempts").insert({
      user_id: userId,
      movement_id: movement.id,
      date: dateStr,
      value,
      is_pr: false,
    });
    if (error) { console.error("  ✗ insert attempt:", error.message); continue; }

    imported++;
  }

  console.log(`  ✓ ${imported} PR attempts importados.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Treino & Dieta — Importação histórica\n");
  console.log(`📂 Lendo: ${XLSX_PATH}`);

  const wb = XLSX.readFile(XLSX_PATH);
  console.log(`   Abas encontradas: ${wb.SheetNames.join(", ")}`);

  const userId = await getUserId();

  // Diego sheet (first visible tab with daily data)
  const diegoSheet = wb.Sheets["Diego"] ?? wb.Sheets[wb.SheetNames[0]];
  if (diegoSheet) await importDiegoSheet(diegoSheet, userId);

  // Corridas sheet
  const corridasSheet = wb.Sheets["Corridas"];
  if (corridasSheet) await importCorridasSheet(corridasSheet, userId);

  // Tentativas PR sheet
  const prSheet = wb.Sheets["Tentativas PR"];
  if (prSheet) await importPRSheet(prSheet, userId);

  console.log("\n✅ Importação concluída!");
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err.message);
  process.exit(1);
});
