/**
 * Supabase Edge Function: sync-whoop
 *
 * POST body:
 *   { "mode": "list" }
 *   { "mode": "import", "ids": ["workout-id"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type KcalField =
  | "kcal_crossfit"
  | "kcal_musculacao"
  | "kcal_boxe"
  | "kcal_surf"
  | "kcal_ciclismo"
  | "kcal_corrida"
  | "kcal_outros";

type MinField =
  | "min_crossfit"
  | "min_musculacao"
  | "min_boxe"
  | "min_surf"
  | "min_ciclismo"
  | "min_corrida"
  | "min_sauna"
  | "min_outros";

type BpmField =
  | "bpm_crossfit"
  | "bpm_musculacao"
  | "bpm_boxe"
  | "bpm_surf"
  | "bpm_ciclismo"
  | "bpm_corrida"
  | "bpm_sauna"
  | "bpm_outros";

type ActivityKey =
  | "crossfit"
  | "musculacao"
  | "boxe"
  | "surf"
  | "ciclismo"
  | "corrida"
  | "sauna"
  | "outros";

type SportMapping = {
  kcalField: KcalField | null;
  minField: MinField | null;
  bpmField: BpmField | null;
};

type NormalizedWorkout = {
  id: string;
  date: string;
  name: string;
  sportId: number | null;
  mapping: SportMapping;
  kcal: number | null;
  minutes: number | null;
  avgHr: number | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class SyncError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SyncError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(error: unknown, context: { provider: string; requestId: string; stage: string }) {
  const syncError = error instanceof SyncError
    ? error
    : new SyncError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Erro desconhecido");

  console.error(`${context.provider} sync failed`, JSON.stringify({
    requestId: context.requestId,
    stage: context.stage,
    code: syncError.code,
    status: syncError.status,
    message: syncError.message,
    details: syncError.details,
  }));

  return json({
    error: syncError.message,
    code: syncError.code,
    stage: context.stage,
    requestId: context.requestId,
  }, syncError.status);
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new SyncError(500, "MISSING_SECRET", `Secret ${name} ausente no Supabase.`, { name });
  }
  return value;
}

function dbError(stage: string, error: unknown): SyncError {
  return new SyncError(500, "DATABASE_ERROR", "Erro ao acessar dados da integracao.", {
    stage,
    message: error instanceof Error ? error.message : String(error),
  });
}

async function responseSnippet(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const requestId = crypto.randomUUID();
  let stage = "start";

  try {
    stage = "auth";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        stage,
        requestId,
      }, 401);
    }

    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        stage,
        requestId,
      }, 401);
    }

    stage = "parse_body";
    const body = await safeJson(req);
    const mode = body.mode === "import" ? "import"
      : body.mode === "reclassify" ? "reclassify"
      : body.mode === "reimport" ? "reimport"
      : "list";
    const selectedIds = new Set<string>(Array.isArray(body.ids) ? body.ids.map(String) : []);
    const overrides: Record<string, ActivityKey> = isRecord(body.overrides)
      ? Object.fromEntries(
          Object.entries(body.overrides as Record<string, unknown>)
            .filter(([, v]) => isValidActivityKey(v))
            .map(([k, v]) => [k, v as ActivityKey])
        )
      : {};

    stage = "whoop_token";
    const accessToken = await getWhoopAccessToken(supabaseAdmin, user.id);

    stage = "whoop_workouts";
    const workouts = await fetchWorkouts(accessToken);

    stage = "repair_legacy";
    const repairedOther = await repairLegacyOtherImports(supabaseAdmin, user.id, workouts);
    const repairedSauna = await repairLegacySaunaImports(supabaseAdmin, user.id, workouts);
    const repaired = repairedOther + repairedSauna;

    stage = "candidates";
    const candidates = await toCandidates(supabaseAdmin, user.id, workouts);

    if (mode === "list") {
      return json({ candidates, repaired });
    }

    const byId = new Map(workouts.map((workout: any) => [workoutId(workout), workout]));

    if (mode === "reimport") {
      stage = "reimport";
      const reimported = await reimportWorkouts(supabaseAdmin, user.id, workouts, selectedIds);
      return json({
        reimported,
        repaired,
        message: `Whoop: ${reimported} atividade(s) reimportada(s).`,
      });
    }

    if (mode === "reclassify") {
      stage = "reclassify";
      const reclassified = await reclassifyWorkouts(supabaseAdmin, user.id, workouts, selectedIds, overrides);
      return json({
        reclassified,
        repaired,
        message: `Whoop: ${reclassified} atividade(s) reclassificada(s).`,
      });
    }

    const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
    if (selected.length === 0) {
      return json({ imported: 0, repaired, message: "Nenhuma atividade selecionada." });
    }

    const workoutsToImport = selected
      .filter((candidate) => !candidate.already_imported)
      .map((candidate) => byId.get(candidate.id))
      .filter(Boolean);

    stage = "import";
    const imported = await importWorkouts(supabaseAdmin, user.id, workoutsToImport, overrides);
    return json({
      imported,
      repaired,
      skipped: selected.length - imported,
      message: `Whoop: ${imported} atividades importadas.`,
    });
  } catch (err) {
    return fail(err, { provider: "whoop", requestId, stage });
  }
});

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function getWhoopAccessToken(supabaseAdmin: any, userId: string): Promise<string> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("integration_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "whoop")
    .maybeSingle();
  if (error) throw dbError("whoop_token_select", error);
  if (!tokenRow?.access_token) {
    throw new SyncError(
      409,
      "WHOOP_NOT_CONNECTED",
      "Whoop precisa ser conectado antes de sincronizar."
    );
  }

  let accessToken = tokenRow.access_token;
  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : new Date(0);
  if (expiresAt < new Date()) {
    if (!tokenRow.refresh_token) {
      throw new SyncError(
        409,
        "WHOOP_RECONNECT_REQUIRED",
        "Token Whoop expirado. Reconecte o Whoop e tente novamente."
      );
    }

    const refreshed = await refreshWhoopToken(tokenRow.refresh_token);
    if (!refreshed) {
      throw new SyncError(
        409,
        "WHOOP_RECONNECT_REQUIRED",
        "Token Whoop expirado. Reconecte o Whoop e tente novamente."
      );
    }
    if (!refreshed.access_token || !refreshed.expires_in) {
      throw new SyncError(424, "WHOOP_REFRESH_INVALID_RESPONSE", "Whoop retornou uma renovacao de token inesperada.");
    }

    accessToken = refreshed.access_token;
    const { error: updateError } = await supabaseAdmin.from("integration_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq("user_id", userId).eq("provider", "whoop");
    if (updateError) throw dbError("whoop_token_update", updateError);
  }

  return accessToken;
}

async function fetchWorkouts(accessToken: string) {
  const start = new Date();
  start.setDate(start.getDate() - 45);
  const end = new Date();

  const workouts: any[] = [];
  let nextToken: string | null = null;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: "25",
    });
    if (nextToken) params.set("nextToken", nextToken);

    const data = await whoopGet(accessToken, `/activity/workout?${params.toString()}`);
    if (!Array.isArray(data?.records)) {
      throw new SyncError(424, "WHOOP_INVALID_RESPONSE", "Whoop retornou uma resposta inesperada.", {
        hasRecords: Boolean(data?.records),
      });
    }

    workouts.push(...data.records);
    nextToken = data.next_token ?? data.nextToken ?? null;
    if (!nextToken) break;
  }

  return workouts;
}

async function toCandidates(supabaseAdmin: any, userId: string, workouts: any[]) {
  const ids = workouts.map(workoutId).filter(Boolean);
  const { data: importedRows, error } = ids.length
    ? await supabaseAdmin
        .from("activity_imports")
        .select("external_id")
        .eq("user_id", userId)
        .eq("provider", "whoop")
        .in("external_id", ids)
    : { data: [], error: null };
  if (error) throw dbError("whoop_imports_select", error);

  const imported = new Set((importedRows ?? []).map((row: any) => String(row.external_id)));
  return workouts.map((workout: any) => {
    const normalized = normalizeWorkout(workout);
    return {
      id: normalized.id,
      date: normalized.date,
      name: normalized.name,
      provider: "whoop",
      duration_min: normalized.minutes,
      kcal: normalized.kcal,
      avg_hr: normalized.avgHr,
      mapping_key: mappingToKey(normalized.mapping),
      already_imported: imported.has(normalized.id),
    };
  });
}

async function importWorkouts(
  supabaseAdmin: any,
  userId: string,
  workouts: any[],
  overrides: Record<string, ActivityKey> = {}
) {
  let imported = 0;

  for (const workout of workouts) {
    const normalized = normalizeWorkout(workout);
    const overrideKey = overrides[normalized.id];
    const resolvedNormalized = overrideKey
      ? applyMappingMetricRules({ ...normalized, mapping: keyToMapping(overrideKey) })
      : normalized;
    const { id, date, mapping, kcal, minutes, avgHr } = resolvedNormalized;

    if (!id || !date || !mapping || (!kcal && !minutes && !avgHr)) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date };
    if (kcal != null && mapping.kcalField) {
      payload[mapping.kcalField] = Number(existing?.[mapping.kcalField] ?? 0) + kcal;
    }
    if (minutes != null && mapping.minField) {
      const currentMin = Number(existing?.[mapping.minField] ?? 0);
      payload[mapping.minField] =
        mapping.minField === "min_corrida" && currentMin > 0 ? currentMin : currentMin + minutes;
    }
    if (avgHr != null && mapping.bpmField && mapping.minField) {
      payload[mapping.bpmField] = mergeBpm(
        Number(existing?.[mapping.bpmField] ?? 0) || null,
        Number(existing?.[mapping.minField] ?? 0) || null,
        avgHr,
        minutes
      );
    }

    const { error: upsertError } = await supabaseAdmin
      .from("daily_logs")
      .upsert(payload, { onConflict: "user_id,date" });
    if (upsertError) throw dbError("whoop_daily_log_upsert", upsertError);

    const { error: markerError } = await supabaseAdmin
      .from("activity_imports")
      .upsert({
        user_id: userId,
        provider: "whoop",
        external_id: id,
        metadata: buildImportMetadata(resolvedNormalized),
      }, { onConflict: "user_id,provider,external_id" });
    if (markerError) throw dbError("whoop_import_marker_upsert", markerError);

    imported++;
  }

  return imported;
}

function mergeBpm(currentBpm: number | null, currentMin: number | null, newBpm: number, newMin: number | null) {
  if (!currentBpm || !currentMin || !newMin) return Math.round(newBpm);
  return Math.round(((currentBpm * currentMin) + (newBpm * newMin)) / (currentMin + newMin));
}

function subtractBpmContribution(
  totalBpm: number | null,
  totalMin: number | null,
  activityBpm: number | null,
  activityMin: number | null
) {
  const remainingMinutes = Math.max(0, Number(totalMin ?? 0) - Number(activityMin ?? 0));
  if (remainingMinutes === 0) {
    return { remainingBpm: null, remainingMinutes: 0 };
  }
  if (!totalBpm || !totalMin || !activityBpm || !activityMin) {
    return { remainingBpm: totalBpm ? Math.round(totalBpm) : null, remainingMinutes };
  }

  const remainingLoad = (totalBpm * totalMin) - (activityBpm * activityMin);
  const remainingBpm = remainingLoad / remainingMinutes;
  if (!Number.isFinite(remainingBpm) || remainingBpm <= 0) {
    return { remainingBpm: Math.round(totalBpm), remainingMinutes };
  }

  return { remainingBpm: Math.round(remainingBpm), remainingMinutes };
}

function workoutId(workout: any): string {
  return String(workout.id ?? workout.workout_id ?? workout.activity_id ?? "");
}

function workoutDate(workout: any): string {
  return String(workout.start ?? workout.start_time ?? workout.created_at ?? "").slice(0, 10);
}

function workoutName(workout: any): string {
  const sport = workout.sport_name ?? workout.sportName ?? workout.sport_id ?? workout.sportId ?? "Atividade";
  return `Whoop ${sport}`;
}

function normalizeWorkout(workout: any): NormalizedWorkout {
  return applyMappingMetricRules({
    id: workoutId(workout),
    date: workoutDate(workout),
    name: workoutName(workout),
    sportId: workoutSportId(workout),
    mapping: mapSport(workout),
    kcal: workoutKcal(workout),
    minutes: workoutDurationMin(workout),
    avgHr: workoutAvgHr(workout),
  });
}

function finiteNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const AVG_HR_KEYS = new Set([
  "average_heart_rate",
  "avg_heart_rate",
  "averageHeartRate",
  "avgHeartRate",
  "average_hr",
  "avg_hr",
  "heart_rate_average",
  "average_bpm",
  "avg_bpm",
]);

function findNestedFiniteNumber(
  value: unknown,
  candidateKeys: ReadonlySet<string>,
  seen = new Set<unknown>()
): number | null {
  if (!isRecord(value) || seen.has(value)) return null;
  seen.add(value);

  for (const [key, nested] of Object.entries(value)) {
    if (!candidateKeys.has(key)) continue;
    const parsed = finiteNumberOrNull(nested);
    if (parsed != null) return parsed;
  }

  for (const nested of Object.values(value)) {
    const parsed = findNestedFiniteNumber(nested, candidateKeys, seen);
    if (parsed != null) return parsed;
  }

  return null;
}

function workoutDurationMin(workout: any): number | null {
  const start = new Date(workout.start ?? workout.start_time ?? 0).getTime();
  const end = new Date(workout.end ?? workout.end_time ?? 0).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 60000;
  const millis = finiteNumberOrNull(
    workout.score?.duration_milli,
    workout.score?.duration_millis,
    workout.score?.duration_ms,
    workout.duration_milli,
    workout.duration_millis,
    workout.duration_ms,
    workout.durationMilli,
    workout.durationMillis,
  );
  if (millis != null) return millis / 60000;

  const seconds = finiteNumberOrNull(
    workout.score?.duration_seconds,
    workout.score?.duration_secs,
    workout.duration_seconds,
    workout.duration_secs,
    workout.duration_s,
  );
  return seconds != null ? seconds / 60 : null;
}

function workoutKcal(workout: any): number | null {
  const kj = workout.score?.kilojoule ?? workout.kilojoule;
  if (kj != null) return kj / 4.184;
  return workout.score?.calories ?? workout.calories ?? null;
}

function workoutAvgHr(workout: any): number | null {
  return finiteNumberOrNull(
    workout.score?.average_heart_rate,
    workout.score?.avg_heart_rate,
    workout.score?.averageHeartRate,
    workout.score?.avgHeartRate,
    workout.score?.average_hr,
    workout.score?.avg_hr,
    workout.score?.heart_rate_average,
    workout.score?.average_bpm,
    workout.score?.avg_bpm,
    workout.score?.heart_rate?.average,
    workout.score?.heart_rate?.avg,
    workout.score?.heart_rate?.average_heart_rate,
    workout.score?.heart_rate?.avg_heart_rate,
    workout.score?.heartRate?.average,
    workout.score?.heartRate?.avg,
    workout.score?.heartRate?.averageHeartRate,
    workout.score?.heartRate?.avgHeartRate,
    workout.heart_rate?.average,
    workout.heart_rate?.avg,
    workout.heart_rate?.average_heart_rate,
    workout.heart_rate?.avg_heart_rate,
    workout.heartRate?.average,
    workout.heartRate?.avg,
    workout.heartRate?.averageHeartRate,
    workout.heartRate?.avgHeartRate,
    workout.average_heart_rate,
    workout.avg_heart_rate,
    workout.averageHeartRate,
    workout.avgHeartRate,
    workout.average_hr,
    workout.avg_hr,
    workout.average_bpm,
    workout.avg_bpm,
  ) ?? findNestedFiniteNumber(workout, AVG_HR_KEYS);
}

function workoutSportId(workout: any): number | null {
  const raw = workout.sport_id ?? workout.sportId;
  if (raw == null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSportName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function applyMappingMetricRules(normalized: NormalizedWorkout): NormalizedWorkout {
  if (!normalized.mapping.kcalField) {
    return { ...normalized, kcal: null };
  }
  return normalized;
}

function mapSport(workout: any): SportMapping {
  const sportId = workoutSportId(workout) ?? 0;
  const name = normalizeSportName(workout.sport_name ?? workout.sportName ?? "");

  if (sportId === 48 || sportId === 96 || name.includes("cross") || name.includes("functional")) {
    return { kcalField: "kcal_crossfit", minField: "min_crossfit", bpmField: "bpm_crossfit" };
  }
  if (
    sportId === 45 ||
    sportId === 59 ||
    sportId === 123 ||
    name.includes("weight") ||
    name.includes("strength") ||
    name.includes("muscul")
  ) {
    return { kcalField: "kcal_musculacao", minField: "min_musculacao", bpmField: "bpm_musculacao" };
  }
  if (sportId === 39 || sportId === 103 || sportId === 127 || name.includes("box") || name.includes("kickboxing")) {
    return { kcalField: "kcal_boxe", minField: "min_boxe", bpmField: "bpm_boxe" };
  }
  if (sportId === 64 || name.includes("surf")) {
    return { kcalField: "kcal_surf", minField: "min_surf", bpmField: "bpm_surf" };
  }
  if (sportId === 1 || sportId === 57 || sportId === 97 || name.includes("cycl") || name.includes("bike") || name.includes("cicl")) {
    return { kcalField: "kcal_ciclismo", minField: "min_ciclismo", bpmField: "bpm_ciclismo" };
  }
  if (sportId === 0 || name.includes("run") || name.includes("corr")) {
    return { kcalField: "kcal_corrida", minField: "min_corrida", bpmField: "bpm_corrida" };
  }
  if (name.includes("steam room") || name.includes("steamroom") || name.includes("dry sauna") || name.includes("sauna")) {
    return { kcalField: null, minField: "min_sauna", bpmField: "bpm_sauna" };
  }
  return { kcalField: "kcal_outros", minField: "min_outros", bpmField: "bpm_outros" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ACTIVITY_KEY_TO_MAPPING: Record<ActivityKey, SportMapping> = {
  crossfit:   { kcalField: "kcal_crossfit",   minField: "min_crossfit",   bpmField: "bpm_crossfit" },
  musculacao: { kcalField: "kcal_musculacao",  minField: "min_musculacao", bpmField: "bpm_musculacao" },
  boxe:       { kcalField: "kcal_boxe",        minField: "min_boxe",       bpmField: "bpm_boxe" },
  surf:       { kcalField: "kcal_surf",        minField: "min_surf",       bpmField: "bpm_surf" },
  ciclismo:   { kcalField: "kcal_ciclismo",    minField: "min_ciclismo",   bpmField: "bpm_ciclismo" },
  corrida:    { kcalField: "kcal_corrida",     minField: "min_corrida",    bpmField: "bpm_corrida" },
  sauna:      { kcalField: null,               minField: "min_sauna",      bpmField: "bpm_sauna" },
  outros:     { kcalField: "kcal_outros",      minField: "min_outros",     bpmField: "bpm_outros" },
};

function keyToMapping(key: ActivityKey): SportMapping {
  return ACTIVITY_KEY_TO_MAPPING[key] ?? ACTIVITY_KEY_TO_MAPPING.outros;
}

function mappingToKey(mapping: SportMapping): ActivityKey {
  for (const [key, m] of Object.entries(ACTIVITY_KEY_TO_MAPPING) as [ActivityKey, SportMapping][]) {
    if (
      m.kcalField === mapping.kcalField &&
      m.minField === mapping.minField &&
      m.bpmField === mapping.bpmField
    ) return key;
  }
  return "outros";
}

function isValidActivityKey(value: unknown): value is ActivityKey {
  return typeof value === "string" && value in ACTIVITY_KEY_TO_MAPPING;
}

async function reimportWorkouts(
  supabaseAdmin: any,
  userId: string,
  workouts: any[],
  selectedIds: Set<string>
) {
  const byId = new Map(workouts.map((w: any) => [workoutId(w), w]));
  let reimported = 0;

  for (const id of selectedIds) {
    const workout = byId.get(id);
    if (!workout) continue;

    const normalized = normalizeWorkout(workout);

    const { data: marker, error: markerReadError } = await supabaseAdmin
      .from("activity_imports")
      .select("metadata")
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", id)
      .maybeSingle();
    if (markerReadError) throw dbError("whoop_reimport_marker_select", markerReadError);
    if (!marker) continue;

    const meta = isRecord(marker.metadata) ? marker.metadata : {};
    const storedNorm = isRecord(meta.normalized) ? meta.normalized : null;
    if (!storedNorm) continue;

    const storedMappingMeta = isRecord(meta.mapping) ? meta.mapping : null;
    const storedMapping: SportMapping = storedMappingMeta
      ? {
          kcalField: storedMappingMeta.kcal_field ? String(storedMappingMeta.kcal_field) as KcalField : null,
          minField: storedMappingMeta.min_field ? String(storedMappingMeta.min_field) as MinField : null,
          bpmField: storedMappingMeta.bpm_field ? String(storedMappingMeta.bpm_field) as BpmField : null,
        }
      : normalized.mapping;

    const oldKcal = storedNorm.kcal != null ? Number(storedNorm.kcal) : null;
    const oldMinutes = storedNorm.minutes != null ? Number(storedNorm.minutes) : null;
    const oldAvgHr = storedNorm.avg_hr != null ? Number(storedNorm.avg_hr) : null;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", normalized.date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_reimport_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date: normalized.date };

    if (oldKcal != null && storedMapping.kcalField) {
      payload[storedMapping.kcalField] = Math.max(0, Number(existing?.[storedMapping.kcalField] ?? 0) - oldKcal);
    }

    const currentBpm = storedMapping.bpmField
      ? Number(existing?.[storedMapping.bpmField] ?? 0) || null
      : null;
    const currentMinutes = storedMapping.minField
      ? Number(existing?.[storedMapping.minField] ?? 0) || null
      : null;
    let remainingBpm = currentBpm;
    let remainingMinutes = currentMinutes;

    if (oldMinutes != null && storedMapping.minField) {
      const remaining = subtractBpmContribution(currentBpm, currentMinutes, oldAvgHr, oldMinutes);
      remainingBpm = remaining.remainingBpm;
      remainingMinutes = remaining.remainingMinutes || null;
      payload[storedMapping.minField] = remaining.remainingMinutes;
      if (remaining.remainingMinutes === 0 && storedMapping.bpmField) {
        payload[storedMapping.bpmField] = null;
      }
    }

    const newKcal = normalized.kcal ?? oldKcal;
    const newMinutes = normalized.minutes ?? oldMinutes;
    const newAvgHr = normalized.avgHr ?? oldAvgHr;

    if (newKcal != null && storedMapping.kcalField) {
      payload[storedMapping.kcalField] = Number(payload[storedMapping.kcalField] ?? 0) + newKcal;
    }
    if (newMinutes != null && storedMapping.minField) {
      payload[storedMapping.minField] = Number(payload[storedMapping.minField] ?? 0) + newMinutes;
    }
    if (newAvgHr != null && storedMapping.bpmField && storedMapping.minField) {
      payload[storedMapping.bpmField] = mergeBpm(
        remainingBpm,
        remainingMinutes,
        newAvgHr,
        newMinutes
      );
    } else if (storedMapping.bpmField && remainingBpm != null) {
      payload[storedMapping.bpmField] = remainingBpm;
    }

    const { error: upsertError } = await supabaseAdmin
      .from("daily_logs")
      .upsert(payload, { onConflict: "user_id,date" });
    if (upsertError) throw dbError("whoop_reimport_daily_log_upsert", upsertError);

    const reimportedNormalized = applyMappingMetricRules({
      ...normalized,
      mapping: storedMapping,
      kcal: newKcal,
      minutes: newMinutes,
      avgHr: newAvgHr,
    });
    const { error: markerUpdateError } = await supabaseAdmin
      .from("activity_imports")
      .update({ metadata: buildImportMetadata(reimportedNormalized, meta) })
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", id);
    if (markerUpdateError) throw dbError("whoop_reimport_marker_update", markerUpdateError);

    reimported++;
  }

  return reimported;
}

async function reclassifyWorkouts(
  supabaseAdmin: any,
  userId: string,
  workouts: any[],
  selectedIds: Set<string>,
  overrides: Record<string, ActivityKey>
) {
  const byId = new Map(workouts.map((w: any) => [workoutId(w), w]));
  let reclassified = 0;

  for (const id of selectedIds) {
    const overrideKey = overrides[id];
    if (!overrideKey) continue;

    const workout = byId.get(id);
    if (!workout) continue;

    const normalized = normalizeWorkout(workout);
    const newMapping = keyToMapping(overrideKey);

    const { data: marker, error: markerReadError } = await supabaseAdmin
      .from("activity_imports")
      .select("metadata")
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", id)
      .maybeSingle();
    if (markerReadError) throw dbError("whoop_reclassify_marker_select", markerReadError);
    if (!marker) continue;

    const meta = isRecord(marker.metadata) ? marker.metadata : {};
    const oldMappingMeta = isRecord(meta.mapping) ? meta.mapping : null;
    const storedNorm = isRecord(meta.normalized) ? meta.normalized : null;

    const oldMapping: SportMapping = oldMappingMeta
      ? {
          kcalField: oldMappingMeta.kcal_field ? String(oldMappingMeta.kcal_field) as KcalField : null,
          minField: oldMappingMeta.min_field ? String(oldMappingMeta.min_field) as MinField : null,
          bpmField: oldMappingMeta.bpm_field ? String(oldMappingMeta.bpm_field) as BpmField : null,
        }
      : normalized.mapping;

    const kcal = storedNorm?.kcal != null ? Number(storedNorm.kcal) : normalized.kcal;
    const minutes = storedNorm?.minutes != null ? Number(storedNorm.minutes) : normalized.minutes;
    const avgHr = storedNorm?.avg_hr != null ? Number(storedNorm.avg_hr) : normalized.avgHr;

    if (oldMapping.kcalField === newMapping.kcalField) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", normalized.date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_reclassify_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date: normalized.date };

    if (kcal != null && oldMapping.kcalField) {
      payload[oldMapping.kcalField] = Math.max(0, Number(existing?.[oldMapping.kcalField] ?? 0) - kcal);
    }
    if (minutes != null && oldMapping.minField) {
      const newOldMin = Math.max(0, Number(existing?.[oldMapping.minField] ?? 0) - minutes);
      payload[oldMapping.minField] = newOldMin;
      if (newOldMin === 0 && oldMapping.bpmField) {
        payload[oldMapping.bpmField] = null;
      }
    }

    if (kcal != null && newMapping.kcalField) {
      payload[newMapping.kcalField] = Number(existing?.[newMapping.kcalField] ?? 0) + kcal;
    }
    if (minutes != null && newMapping.minField) {
      payload[newMapping.minField] = Number(existing?.[newMapping.minField] ?? 0) + minutes;
    }
    if (avgHr != null && newMapping.bpmField && newMapping.minField) {
      payload[newMapping.bpmField] = mergeBpm(
        Number(existing?.[newMapping.bpmField] ?? 0) || null,
        Number(existing?.[newMapping.minField] ?? 0) || null,
        avgHr,
        minutes
      );
    }

    const { error: upsertError } = await supabaseAdmin
      .from("daily_logs")
      .upsert(payload, { onConflict: "user_id,date" });
    if (upsertError) throw dbError("whoop_reclassify_daily_log_upsert", upsertError);

    const reclassifiedNormalized = applyMappingMetricRules({ ...normalized, mapping: newMapping });
    const { error: markerUpdateError } = await supabaseAdmin
      .from("activity_imports")
      .update({ metadata: buildImportMetadata(reclassifiedNormalized, meta) })
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", id);
    if (markerUpdateError) throw dbError("whoop_reclassify_marker_update", markerUpdateError);

    reclassified++;
  }

  return reclassified;
}

function buildImportMetadata(normalized: NormalizedWorkout, current: unknown = {}) {
  const metadata = isRecord(current) ? current : {};
  return {
    ...metadata,
    date: normalized.date,
    name: normalized.name,
    sport_id: normalized.sportId,
    schema_version: 4,
    mapping: {
      kcal_field: normalized.mapping.kcalField,
      min_field: normalized.mapping.minField,
      bpm_field: normalized.mapping.bpmField,
    },
    normalized: {
      kcal: normalized.kcal,
      minutes: normalized.minutes,
      avg_hr: normalized.avgHr,
    },
  };
}

async function repairLegacyOtherImports(supabaseAdmin: any, userId: string, workouts: any[]) {
  const ids = workouts.map(workoutId).filter(Boolean);
  if (ids.length === 0) return 0;

  const { data: importedRows, error } = await supabaseAdmin
    .from("activity_imports")
    .select("external_id, metadata")
    .eq("user_id", userId)
    .eq("provider", "whoop")
    .in("external_id", ids);
  if (error) throw dbError("whoop_imports_select", error);

  const rowsById = new Map<string, { external_id: string; metadata?: unknown }>(
    (importedRows ?? []).map((row: any) => [String(row.external_id), row])
  );
  let repaired = 0;

  for (const workout of workouts) {
    const normalized = normalizeWorkout(workout);
    const marker = rowsById.get(normalized.id);
    if (!marker) continue;

    const schemaVersion = isRecord(marker.metadata) ? marker.metadata.schema_version : undefined;
    const needsOtherRepair =
      normalized.mapping.minField === "min_outros" || normalized.mapping.bpmField === "bpm_outros";
    if (!needsOtherRepair || (typeof schemaVersion === "number" && schemaVersion >= 2)) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("min_outros, bpm_outros")
      .eq("user_id", userId)
      .eq("date", normalized.date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_legacy_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date: normalized.date };
    let shouldUpsert = false;

    if (normalized.minutes != null) {
      payload.min_outros = Number(existing?.min_outros ?? 0) + normalized.minutes;
      if (normalized.avgHr != null) {
        payload.bpm_outros = mergeBpm(
          Number(existing?.bpm_outros ?? 0) || null,
          Number(existing?.min_outros ?? 0) || null,
          normalized.avgHr,
          normalized.minutes
        );
      }
      shouldUpsert = true;
    }

    if (!shouldUpsert) continue;

    const { error: upsertError } = await supabaseAdmin
      .from("daily_logs")
      .upsert(payload, { onConflict: "user_id,date" });
    if (upsertError) throw dbError("whoop_legacy_daily_log_upsert", upsertError);

    const { error: markerError } = await supabaseAdmin
      .from("activity_imports")
      .update({ metadata: buildImportMetadata(normalized, marker.metadata) })
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", normalized.id);
    if (markerError) throw dbError("whoop_import_marker_update", markerError);

    repaired++;
  }

  return repaired;
}

async function repairLegacySaunaImports(supabaseAdmin: any, userId: string, workouts: any[]) {
  const ids = workouts.map(workoutId).filter(Boolean);
  if (ids.length === 0) return 0;

  const { data: importedRows, error } = await supabaseAdmin
    .from("activity_imports")
    .select("external_id, metadata")
    .eq("user_id", userId)
    .eq("provider", "whoop")
    .in("external_id", ids);
  if (error) throw dbError("whoop_imports_select", error);

  const rowsById = new Map<string, { external_id: string; metadata?: unknown }>(
    (importedRows ?? []).map((row: any) => [String(row.external_id), row])
  );
  let repaired = 0;

  for (const workout of workouts) {
    const normalized = normalizeWorkout(workout);
    if (mappingToKey(normalized.mapping) !== "sauna") continue;

    const marker = rowsById.get(normalized.id);
    if (!marker) continue;

    const meta = isRecord(marker.metadata) ? marker.metadata : {};
    const schemaVersion = typeof meta.schema_version === "number" ? meta.schema_version : 0;
    const storedMappingMeta = isRecord(meta.mapping) ? meta.mapping : null;
    const storedMapping: SportMapping = storedMappingMeta
      ? {
          kcalField: storedMappingMeta.kcal_field ? String(storedMappingMeta.kcal_field) as KcalField : null,
          minField: storedMappingMeta.min_field ? String(storedMappingMeta.min_field) as MinField : null,
          bpmField: storedMappingMeta.bpm_field ? String(storedMappingMeta.bpm_field) as BpmField : null,
        }
      : normalized.mapping;
    const sameMapping =
      storedMapping.kcalField === normalized.mapping.kcalField &&
      storedMapping.minField === normalized.mapping.minField &&
      storedMapping.bpmField === normalized.mapping.bpmField;
    const storedNorm = isRecord(meta.normalized) ? meta.normalized : null;
    const oldKcal = storedNorm?.kcal != null ? Number(storedNorm.kcal) : null;
    const oldMinutes = storedNorm?.minutes != null ? Number(storedNorm.minutes) : normalized.minutes;
    const storedAvgHr = storedNorm?.avg_hr != null ? Number(storedNorm.avg_hr) : null;
    const avgHr = storedAvgHr ?? normalized.avgHr;
    const needsAvgHrRepair =
      oldMinutes != null &&
      oldMinutes > 0 &&
      sameMapping &&
      storedAvgHr == null &&
      avgHr != null &&
      normalized.mapping.bpmField != null &&
      normalized.mapping.minField != null;

    if (schemaVersion >= 4 && sameMapping && !needsAvgHrRepair) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", normalized.date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_legacy_sauna_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date: normalized.date };
    let shouldUpsert = false;

    if (!sameMapping) {
      if (oldKcal != null && storedMapping.kcalField) {
        payload[storedMapping.kcalField] = Math.max(0, Number(existing?.[storedMapping.kcalField] ?? 0) - oldKcal);
        shouldUpsert = true;
      }
      if (oldMinutes != null && storedMapping.minField) {
        const nextOldMinutes = Math.max(0, Number(existing?.[storedMapping.minField] ?? 0) - oldMinutes);
        payload[storedMapping.minField] = nextOldMinutes;
        if (nextOldMinutes === 0 && storedMapping.bpmField) {
          payload[storedMapping.bpmField] = null;
        }
        shouldUpsert = true;
      }
      if (normalized.minutes != null && normalized.mapping.minField) {
        payload[normalized.mapping.minField] = Number(existing?.[normalized.mapping.minField] ?? 0) + normalized.minutes;
        shouldUpsert = true;
      }
      if (avgHr != null && normalized.mapping.bpmField && normalized.mapping.minField) {
        payload[normalized.mapping.bpmField] = mergeBpm(
          Number(existing?.[normalized.mapping.bpmField] ?? 0) || null,
          Number(existing?.[normalized.mapping.minField] ?? 0) || null,
          avgHr,
          normalized.minutes
        );
        shouldUpsert = true;
      }
    }

    if (needsAvgHrRepair && normalized.mapping.bpmField && normalized.mapping.minField) {
      const currentMinutes = Number(existing?.[normalized.mapping.minField] ?? 0);
      const baseMinutes = Math.max(0, currentMinutes - oldMinutes);
      payload[normalized.mapping.bpmField] = mergeBpm(
        Number(existing?.[normalized.mapping.bpmField] ?? 0) || null,
        baseMinutes || null,
        avgHr,
        oldMinutes
      );
      shouldUpsert = true;
    }

    if (shouldUpsert) {
      const { error: upsertError } = await supabaseAdmin
        .from("daily_logs")
        .upsert(payload, { onConflict: "user_id,date" });
      if (upsertError) throw dbError("whoop_legacy_sauna_daily_log_upsert", upsertError);
    }

    const { error: markerError } = await supabaseAdmin
      .from("activity_imports")
      .update({ metadata: buildImportMetadata(normalized, marker.metadata) })
      .eq("user_id", userId)
      .eq("provider", "whoop")
      .eq("external_id", normalized.id);
    if (markerError) throw dbError("whoop_legacy_sauna_marker_update", markerError);

    repaired++;
  }

  return repaired;
}

async function whoopGet(token: string, path: string) {
  const res = await fetch(`${WHOOP_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const reconnect = res.status === 401 || res.status === 403;
    throw new SyncError(
      reconnect ? 409 : 424,
      reconnect ? "WHOOP_RECONNECT_REQUIRED" : "WHOOP_API_ERROR",
      reconnect
        ? "Whoop recusou o token atual. Reconecte o Whoop e tente novamente."
        : "Whoop recusou a busca de atividades. Tente novamente em alguns minutos.",
      {
        status: res.status,
        path,
        body: await responseSnippet(res),
      }
    );
  }
  return res.json();
}

async function refreshWhoopToken(refreshToken: string) {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requireEnv("WHOOP_CLIENT_ID"),
      client_secret: requireEnv("WHOOP_CLIENT_SECRET"),
    }),
  });
  if (!res.ok) {
    console.error("whoop token refresh failed", JSON.stringify({
      status: res.status,
      body: await responseSnippet(res),
    }));
    return null;
  }
  return res.json();
}
