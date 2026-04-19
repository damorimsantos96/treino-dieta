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
    const mode = body.mode === "import" ? "import" : "list";
    const selectedIds = new Set<string>(Array.isArray(body.ids) ? body.ids.map(String) : []);

    stage = "whoop_token";
    const accessToken = await getWhoopAccessToken(supabaseAdmin, user.id);

    stage = "whoop_workouts";
    const workouts = await fetchWorkouts(accessToken);

    stage = "candidates";
    const candidates = await toCandidates(supabaseAdmin, user.id, workouts);

    if (mode === "list") {
      return json({ candidates });
    }

    const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
    if (selected.length === 0) {
      return json({ imported: 0, message: "Nenhuma atividade selecionada." });
    }

    const byId = new Map(workouts.map((workout: any) => [workoutId(workout), workout]));
    const workoutsToImport = selected
      .filter((candidate) => !candidate.already_imported)
      .map((candidate) => byId.get(candidate.id))
      .filter(Boolean);

    stage = "import";
    const imported = await importWorkouts(supabaseAdmin, user.id, workoutsToImport);
    return json({
      imported,
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
  return workouts.map((workout: any) => ({
    id: workoutId(workout),
    date: workoutDate(workout),
    name: workoutName(workout),
    provider: "whoop",
    duration_min: workoutDurationMin(workout),
    kcal: workoutKcal(workout),
    avg_hr: workoutAvgHr(workout),
    already_imported: imported.has(workoutId(workout)),
  }));
}

async function importWorkouts(supabaseAdmin: any, userId: string, workouts: any[]) {
  let imported = 0;

  for (const workout of workouts) {
    const id = workoutId(workout);
    const date = workoutDate(workout);
    const mapping = mapSport(workout);
    const kcal = workoutKcal(workout);
    const minutes = workoutDurationMin(workout);
    const avgHr = workoutAvgHr(workout);

    if (!id || !date || !mapping || (!kcal && !minutes && !avgHr)) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (existingError) throw dbError("whoop_daily_log_select", existingError);

    const payload: Record<string, unknown> = { user_id: userId, date };
    if (kcal != null) payload[mapping.kcalField] = Number(existing?.[mapping.kcalField] ?? 0) + kcal;
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
        metadata: {
          date,
          name: workoutName(workout),
          sport_id: workout.sport_id ?? workout.sportId ?? null,
        },
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

function workoutDurationMin(workout: any): number | null {
  const start = new Date(workout.start ?? workout.start_time ?? 0).getTime();
  const end = new Date(workout.end ?? workout.end_time ?? 0).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 60000;
  const millis = workout.score?.duration_milli ?? workout.duration_milli ?? workout.duration_ms;
  return millis ? millis / 60000 : null;
}

function workoutKcal(workout: any): number | null {
  const kj = workout.score?.kilojoule ?? workout.kilojoule;
  if (kj != null) return kj / 4.184;
  return workout.score?.calories ?? workout.calories ?? null;
}

function workoutAvgHr(workout: any): number | null {
  return workout.score?.average_heart_rate ??
    workout.score?.avg_heart_rate ??
    workout.average_heart_rate ??
    workout.avg_hr ??
    null;
}

function mapSport(workout: any) {
  const sportId = Number(workout.sport_id ?? workout.sportId ?? 0);
  const name = String(workout.sport_name ?? workout.sportName ?? "").toLowerCase();

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
  return { kcalField: "kcal_outros", minField: null, bpmField: null };
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
