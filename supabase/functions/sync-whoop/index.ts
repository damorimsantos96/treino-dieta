/**
 * Supabase Edge Function: sync-whoop
 *
 * POST body:
 *   { "mode": "list" }
 *   { "mode": "import", "ids": ["workout-id"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await safeJson(req);
    const mode = body.mode === "import" ? "import" : "list";
    const selectedIds = new Set<string>(Array.isArray(body.ids) ? body.ids.map(String) : []);

    const accessToken = await getWhoopAccessToken(supabaseAdmin, user.id);
    const workouts = await fetchWorkouts(accessToken);
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

    const imported = await importWorkouts(supabaseAdmin, user.id, workoutsToImport);
    return json({
      imported,
      skipped: selected.length - imported,
      message: `Whoop: ${imported} atividades importadas.`,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Erro desconhecido" }, 500);
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
  if (error) throw error;
  if (!tokenRow?.access_token) throw new Error("Whoop nao conectado. Autorize primeiro.");

  let accessToken = tokenRow.access_token;
  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : new Date(0);
  if (expiresAt < new Date()) {
    const refreshed = await refreshWhoopToken(tokenRow.refresh_token);
    if (!refreshed) throw new Error("Token expirado. Autorize o Whoop novamente.");
    accessToken = refreshed.access_token;
    await supabaseAdmin.from("integration_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq("user_id", userId).eq("provider", "whoop");
  }

  return accessToken;
}

async function fetchWorkouts(accessToken: string) {
  const start = new Date();
  start.setDate(start.getDate() - 45);
  const end = new Date();
  const data = await whoopGet(
    accessToken,
    `/workout?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
  );
  return data.records ?? [];
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
  if (error) throw error;

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

    const { data: existing } = await supabaseAdmin
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

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
    if (upsertError) throw upsertError;

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
    if (markerError) throw markerError;

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

  if (sportId === 63 || name.includes("cross")) {
    return { kcalField: "kcal_crossfit", minField: "min_crossfit", bpmField: "bpm_crossfit" };
  }
  if (sportId === 1 || name.includes("weight") || name.includes("strength") || name.includes("muscul")) {
    return { kcalField: "kcal_musculacao", minField: "min_musculacao", bpmField: "bpm_musculacao" };
  }
  if (sportId === 71 || name.includes("box")) {
    return { kcalField: "kcal_boxe", minField: "min_boxe", bpmField: "bpm_boxe" };
  }
  if (sportId === 78 || name.includes("surf")) {
    return { kcalField: "kcal_surf", minField: "min_surf", bpmField: "bpm_surf" };
  }
  if (sportId === 17 || name.includes("cycl") || name.includes("bike") || name.includes("cicl")) {
    return { kcalField: "kcal_ciclismo", minField: "min_ciclismo", bpmField: "bpm_ciclismo" };
  }
  if (name.includes("run") || name.includes("corr")) {
    return { kcalField: "kcal_corrida", minField: "min_corrida", bpmField: "bpm_corrida" };
  }
  return { kcalField: "kcal_outros", minField: null, bpmField: null };
}

async function whoopGet(token: string, path: string) {
  const res = await fetch(`${WHOOP_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Whoop API error: ${res.status} ${path}`);
  return res.json();
}

async function refreshWhoopToken(refreshToken: string) {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
      client_secret: Deno.env.get("WHOOP_CLIENT_SECRET")!,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}
