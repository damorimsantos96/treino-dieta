/**
 * One-time historical import from "Dieta e Treino.xlsx" (na raiz do projeto).
 *
 * This parser is intentionally header/worksheet-aware. The original importer
 * drifted by two columns and read "Musculacao kcal" as body weight.
 *
 * Required env vars in scripts/.env:
 *   USER_EMAIL
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 */

import "dotenv/config";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = resolve(__dirname, "../Dieta e Treino.xlsx");
const USER_EMAIL = process.env.USER_EMAIL;
const USER_ID = process.env.USER_ID;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.SUPABASE_URL) throw new Error("Set SUPABASE_URL in scripts/.env.");
if (!SERVICE_KEY) throw new Error("Set SUPABASE_SERVICE_KEY in scripts/.env.");

const supabase = createClient(process.env.SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function cell(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r, c })];
}

function excelDateToISO(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d
      ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
      : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  const n = toNum(value);
  return n == null ? null : Math.round(n);
}

function sumNums(...values) {
  let found = false;
  let sum = 0;
  for (const value of values) {
    const n = toNum(value);
    if (n == null) continue;
    found = true;
    sum += n;
  }
  return found ? sum : null;
}

function nullIfZero(value) {
  return value === 0 ? null : value;
}

function parseClockToMinutes(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || !raw.includes(":")) return null;

  const parts = raw.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return null;
}

function durationMinutesFromCell(c) {
  if (!c) return null;
  const formatted = parseClockToMinutes(c.w);
  if (formatted != null) return formatted;
  const n = toNum(c.v);
  if (n == null) return null;
  return n < 1 ? n * 1440 : n;
}

function paceMinutesFromCell(c) {
  if (!c) return null;
  const formatted = parseClockToMinutes(c.w);
  if (formatted != null) return formatted;
  const n = toNum(c.v);
  if (n == null) return null;
  return n < 1 ? n * 24 : n;
}

function weightedAverage(items, valueKey, weightKey) {
  let numerator = 0;
  let denominator = 0;
  for (const item of items) {
    const value = item[valueKey];
    if (value == null) continue;
    const weight = item[weightKey] ?? 1;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

async function getUserId() {
  if (USER_ID) {
    console.log(`User: ${USER_ID}`);
    return USER_ID;
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;

  const user = USER_EMAIL
    ? data.users.find((u) => u.email === USER_EMAIL)
    : data.users.length === 1
      ? data.users[0]
      : null;

  if (!user) {
    throw new Error(
      USER_EMAIL
        ? `User not found: ${USER_EMAIL}`
        : "Set USER_EMAIL or USER_ID in scripts/.env when the project has multiple users."
    );
  }

  console.log(`User: ${user.email ?? USER_EMAIL ?? "single-user"} (${user.id})`);
  return user.id;
}

async function upsertBatch(table, rows, options) {
  const size = 100;
  let count = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { error } = await supabase.from(table).upsert(batch, options);
    if (error) throw error;
    count += batch.length;
    process.stdout.write(`\r  ${table}: ${count}/${rows.length}`);
  }
  process.stdout.write("\n");
}

async function importDailyLogs(ws, userId) {
  console.log("\nImporting Diego daily logs...");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const date = excelDateToISO(cell(ws, r, 0)?.v);
    if (!date) continue;

    const weight = toNum(cell(ws, r, 1)?.v);
    const kcalCrossfit = nullIfZero(sumNums(cell(ws, r, 2)?.v, cell(ws, r, 6)?.v));
    const kcalMusculacao = nullIfZero(sumNums(cell(ws, r, 3)?.v, cell(ws, r, 8)?.v));
    const kcalOutros = nullIfZero(sumNums(cell(ws, r, 4)?.v, cell(ws, r, 9)?.v, cell(ws, r, 10)?.v));
    const kcalCiclismo = nullIfZero(sumNums(cell(ws, r, 5)?.v, cell(ws, r, 12)?.v));
    const kcalCorrida = nullIfZero(sumNums(cell(ws, r, 11)?.v, cell(ws, r, 16)?.v));

    const record = {
      user_id: userId,
      date,
      weight_kg: weight,
      kcal_crossfit: kcalCrossfit,
      kcal_musculacao: kcalMusculacao,
      kcal_outros: kcalOutros,
      kcal_ciclismo: kcalCiclismo,
      kcal_academia: nullIfZero(toNum(cell(ws, r, 13)?.v)),
      kcal_boxe: nullIfZero(toNum(cell(ws, r, 14)?.v)),
      kcal_surf: nullIfZero(toNum(cell(ws, r, 15)?.v)),
      kcal_corrida: kcalCorrida,
      min_crossfit: nullIfZero(toNum(cell(ws, r, 18)?.v)),
      min_musculacao: nullIfZero(toNum(cell(ws, r, 19)?.v)),
      min_ciclismo: nullIfZero(toNum(cell(ws, r, 23)?.v)),
      min_academia: nullIfZero(toNum(cell(ws, r, 24)?.v)),
      min_boxe: nullIfZero(toNum(cell(ws, r, 25)?.v)),
      min_surf: nullIfZero(toNum(cell(ws, r, 26)?.v)),
      min_corrida: nullIfZero(sumNums(cell(ws, r, 22)?.v, cell(ws, r, 27)?.v)),
      min_sauna: nullIfZero(toNum(cell(ws, r, 28)?.v)),
      temp_academia: toNum(cell(ws, r, 30)?.v),
      temp_boxe: toNum(cell(ws, r, 31)?.v),
      temp_surf: toNum(cell(ws, r, 32)?.v),
      temp_corrida: toNum(cell(ws, r, 33)?.v),
      temp_sauna: toNum(cell(ws, r, 34)?.v),
      bpm_academia: toInt(cell(ws, r, 35)?.v),
      bpm_boxe: toInt(cell(ws, r, 36)?.v),
      bpm_surf: toInt(cell(ws, r, 37)?.v),
      bpm_corrida: toInt(cell(ws, r, 38)?.v),
      bpm_sauna: toInt(cell(ws, r, 39)?.v),
      surplus_deficit_kcal: toNum(cell(ws, r, 40)?.v),
      protein_g: toNum(cell(ws, r, 43)?.v),
      carbs_g: toNum(cell(ws, r, 44)?.v),
    };

    rows.push(record);
  }

  await upsertBatch("daily_logs", rows, {
    onConflict: "user_id,date",
    ignoreDuplicates: false,
  });
  console.log(`  Daily logs imported: ${rows.length}`);
}

async function importRuns(ws, userId) {
  console.log("\nImporting Corridas as activities + intervals...");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const groups = new Map();

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const date = excelDateToISO(cell(ws, r, 0)?.v);
    if (!date) continue;

    const distance = toNum(cell(ws, r, 3)?.v);
    const duration = durationMinutesFromCell(cell(ws, r, 2)) ?? paceMinutesFromCell(cell(ws, r, 9));
    if (!distance && !duration) continue;

    const externalId = `excel:${date}`;
    if (!groups.has(externalId)) {
      groups.set(externalId, {
        date,
        source: "excel",
        external_id: externalId,
        name: "Planilha",
        intervals: [],
      });
    }

    groups.get(externalId).intervals.push({
      user_id: userId,
      date,
      interval_type: "Outro",
      interval_index: toInt(cell(ws, r, 1)?.v) ?? groups.get(externalId).intervals.length + 1,
      distance_km: distance,
      duration_min: duration,
      pace_min_km: paceMinutesFromCell(cell(ws, r, 4)) ?? paceMinutesFromCell(cell(ws, r, 10)),
      avg_hr: toInt(cell(ws, r, 5)?.v),
      max_hr: toInt(cell(ws, r, 6)?.v),
      thermal_sensation_c: toNum(cell(ws, r, 7)?.v),
      calories_kcal: null,
      source: "excel",
      external_id: `excel:${date}:row:${r + 1}`,
      notes: null,
    });

    const group = groups.get(externalId);
    group.thermal_sensation_c = group.thermal_sensation_c ?? toNum(cell(ws, r, 7)?.v);
    group.calories_kcal = Math.max(group.calories_kcal ?? 0, toNum(cell(ws, r, 8)?.v) ?? 0) || null;
  }

  let activityCount = 0;
  let intervalCount = 0;

  for (const group of groups.values()) {
    const totalKm = group.intervals.reduce((s, i) => s + (i.distance_km ?? 0), 0);
    const totalMin = group.intervals.reduce((s, i) => s + (i.duration_min ?? 0), 0);
    const avgHr = weightedAverage(group.intervals, "avg_hr", "duration_min");
    const maxHr = Math.max(...group.intervals.map((i) => i.max_hr ?? 0), 0) || null;

    const { data: activity, error: activityError } = await supabase
      .from("run_activities")
      .upsert(
        {
          user_id: userId,
          date: group.date,
          source: group.source,
          external_id: group.external_id,
          name: group.name,
          distance_km: totalKm || null,
          duration_min: totalMin || null,
          avg_pace_min_km: totalKm > 0 && totalMin > 0 ? totalMin / totalKm : null,
          avg_hr: avgHr == null ? null : Math.round(avgHr),
          max_hr: maxHr,
          thermal_sensation_c: group.thermal_sensation_c ?? null,
          calories_kcal: group.calories_kcal ?? null,
        },
        { onConflict: "user_id,source,external_id" }
      )
      .select("id")
      .single();
    if (activityError) throw activityError;

    const { error: deleteError } = await supabase
      .from("run_sessions")
      .delete()
      .eq("run_activity_id", activity.id)
      .eq("source", "excel");
    if (deleteError) throw deleteError;

    const rows = group.intervals.map((interval) => ({
      ...interval,
      run_activity_id: activity.id,
    }));
    const { error: insertError } = await supabase.from("run_sessions").insert(rows);
    if (insertError) throw insertError;

    activityCount++;
    intervalCount += rows.length;
    process.stdout.write(`\r  runs: ${activityCount}/${groups.size}`);
  }

  process.stdout.write("\n");
  console.log(`  Run activities imported: ${activityCount}`);
  console.log(`  Run intervals imported: ${intervalCount}`);
}

function prValueFromCell(scoreCell, tipo) {
  const isTime = String(tipo ?? "").toLowerCase().includes("tempo");
  if (!isTime) return toNum(scoreCell?.v);

  const formatted = parseClockToMinutes(scoreCell?.w);
  if (formatted != null) return Math.round(formatted * 60);

  const n = toNum(scoreCell?.v);
  if (n == null) return null;
  return n < 1 ? Math.round(n * 24 * 3600) : n;
}

async function importPRs(ws, userId) {
  console.log("\nImporting Tentativas PR...");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  let imported = 0;

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const date = excelDateToISO(cell(ws, r, 0)?.v);
    const name = String(cell(ws, r, 1)?.v ?? "").trim();
    const tipo = String(cell(ws, r, 3)?.v ?? "Tempo").trim();
    const value = prValueFromCell(cell(ws, r, 2), tipo);
    if (!date || !name || value == null || value <= 0) continue;

    const isTime = tipo.toLowerCase().includes("tempo");
    const movementPayload = {
      user_id: userId,
      name,
      unit: isTime ? "time_sec" : "reps",
      category: "CrossFit",
      lower_is_better: isTime,
    };

    const { data: movement, error: movementError } = await supabase
      .from("pr_movements")
      .upsert(movementPayload, { onConflict: "user_id,name" })
      .select("id")
      .single();
    if (movementError) throw movementError;

    const { error: attemptError } = await supabase
      .from("pr_attempts")
      .upsert(
        {
          user_id: userId,
          movement_id: movement.id,
          date,
          value,
          notes: null,
          is_pr: false,
        },
        { onConflict: "user_id,movement_id,date,value" }
      );
    if (attemptError) throw attemptError;

    imported++;
  }

  await recalculatePRs(userId);
  console.log(`  PR attempts imported: ${imported}`);
}

async function recalculatePRs(userId) {
  const { data: attempts, error } = await supabase
    .from("pr_attempts")
    .select("id, movement_id, value, movement:pr_movements(lower_is_better)")
    .eq("user_id", userId)
    .order("date", { ascending: true });
  if (error) throw error;
  if (!attempts?.length) return;

  const bestByMovement = new Map();
  for (const attempt of attempts) {
    const lowerIsBetter = attempt.movement?.lower_is_better ?? false;
    const current = bestByMovement.get(attempt.movement_id);
    if (
      !current ||
      (lowerIsBetter ? attempt.value < current.value : attempt.value > current.value)
    ) {
      bestByMovement.set(attempt.movement_id, {
        id: attempt.id,
        value: attempt.value,
      });
    }
  }

  const prIds = Array.from(bestByMovement.values()).map((item) => item.id);

  const { error: clearError } = await supabase
    .from("pr_attempts")
    .update({ is_pr: false })
    .eq("user_id", userId);
  if (clearError) throw clearError;

  const { error: setError } = await supabase
    .from("pr_attempts")
    .update({ is_pr: true })
    .in("id", prIds);
  if (setError) throw setError;
}

async function main() {
  console.log("Treino & Dieta historical import");
  console.log(`Reading: ${XLSX_PATH}`);

  const wb = XLSX.readFile(XLSX_PATH);
  console.log(`Sheets: ${wb.SheetNames.join(", ")}`);

  const userId = await getUserId();
  await importDailyLogs(wb.Sheets.Diego, userId);
  await importRuns(wb.Sheets.Corridas, userId);
  await importPRs(wb.Sheets["Tentativas PR"], userId);
  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
