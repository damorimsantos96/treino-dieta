/**
 * Supabase Edge Function: sync-garmin
 *
 * POST body:
 *   { "mode": "list" }
 *   { "mode": "import", "ids": ["activity-id"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GARMIN_SSO_URL = "https://sso.garmin.com/sso";
const GARMIN_CONNECT_API = "https://connect.garmin.com/activitylist-service/activities/search/activities";

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

    const garminSession = await garminLogin(
      Deno.env.get("GARMIN_EMAIL")!,
      Deno.env.get("GARMIN_PASSWORD")!
    );
    const activities = await fetchGarminActivities(garminSession, 80);
    const runs = activities.filter((activity: any) => activity.activityType?.typeKey === "running");
    const candidates = await toCandidates(supabaseAdmin, user.id, runs);

    if (mode === "list") return json({ candidates });

    const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
    if (selected.length === 0) {
      return json({ imported: 0, message: "Nenhuma corrida selecionada." });
    }

    const byId = new Map(runs.map((activity: any) => [activityId(activity), activity]));
    let imported = 0;
    const touchedDates = new Set<string>();

    for (const candidate of selected) {
      if (candidate.already_imported) continue;
      const activity = byId.get(candidate.id);
      if (!activity) continue;
      const saved = await importActivity(supabaseAdmin, user.id, garminSession, activity);
      if (saved?.date) touchedDates.add(saved.date);
      imported++;
    }

    for (const date of touchedDates) {
      await syncRunMinutesToDaily(supabaseAdmin, user.id, date);
    }

    return json({
      imported,
      skipped: selected.length - imported,
      message: `Garmin: ${imported} corridas importadas.`,
    });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : "Erro desconhecido",
      fallback: true,
    }, 500);
  }
});

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function toCandidates(supabaseAdmin: any, userId: string, activities: any[]) {
  const ids = activities.map(activityId).filter(Boolean);
  const { data: importedRows, error } = ids.length
    ? await supabaseAdmin
        .from("run_activities")
        .select("external_id")
        .eq("user_id", userId)
        .eq("source", "garmin")
        .in("external_id", ids)
    : { data: [], error: null };
  if (error) throw error;

  const imported = new Set((importedRows ?? []).map((row: any) => String(row.external_id)));
  return activities.map((activity: any) => ({
    id: activityId(activity),
    date: activityDate(activity),
    name: activity.activityName ?? "Corrida Garmin",
    provider: "garmin",
    duration_min: durationSeconds(activity.duration ?? activity.elapsedDuration) / 60,
    distance_km: metersToKm(activity.distance),
    avg_hr: activity.averageHR ?? null,
    already_imported: imported.has(activityId(activity)),
  }));
}

async function importActivity(supabaseAdmin: any, userId: string, cookies: string, activity: any) {
  const id = activityId(activity);
  const date = activityDate(activity);
  if (!id || !date) return null;

  const laps = await fetchGarminLaps(cookies, id);
  const intervals = normalizeLaps(laps.length ? laps : [activity], date, id);
  const totalKm = intervals.reduce((sum, interval) => sum + (interval.distance_km ?? 0), 0);
  const totalMin = intervals.reduce((sum, interval) => sum + (interval.duration_min ?? 0), 0);
  const avgHr = weightedHr(intervals);
  const maxHr = Math.max(...intervals.map((interval) => interval.max_hr ?? 0), activity.maxHR ?? 0) || null;

  const { data: savedActivity, error: activityError } = await supabaseAdmin
    .from("run_activities")
    .upsert({
      user_id: userId,
      date,
      source: "garmin",
      external_id: id,
      name: activity.activityName ?? "Corrida Garmin",
      distance_km: totalKm || metersToKm(activity.distance),
      duration_min: totalMin || durationSeconds(activity.duration ?? activity.elapsedDuration) / 60,
      avg_pace_min_km: totalKm > 0 && totalMin > 0 ? totalMin / totalKm : null,
      avg_hr: avgHr ?? activity.averageHR ?? null,
      max_hr: maxHr,
      thermal_sensation_c: null,
      calories_kcal: null,
    }, { onConflict: "user_id,source,external_id" })
    .select("id, date")
    .single();
  if (activityError) throw activityError;

  const { error: deleteError } = await supabaseAdmin
    .from("run_sessions")
    .delete()
    .eq("run_activity_id", savedActivity.id)
    .eq("source", "garmin");
  if (deleteError) throw deleteError;

  const rows = intervals.map((interval) => ({
    ...interval,
    user_id: userId,
    run_activity_id: savedActivity.id,
    source: "garmin",
  }));
  const { error: intervalError } = await supabaseAdmin.from("run_sessions").insert(rows);
  if (intervalError) throw intervalError;

  const { error: markerError } = await supabaseAdmin
    .from("activity_imports")
    .upsert({
      user_id: userId,
      provider: "garmin",
      external_id: id,
      metadata: { date, name: activity.activityName ?? null },
    }, { onConflict: "user_id,provider,external_id" });
  if (markerError) throw markerError;

  return savedActivity;
}

function normalizeLaps(laps: any[], date: string, activityIdValue: string) {
  return laps.map((lap, index) => {
    const distanceKm = metersToKm(lap.distance ?? lap.totalDistance ?? lap.distanceMeters);
    const durationMin = durationSeconds(
      lap.duration ?? lap.elapsedDuration ?? lap.movingDuration ?? lap.totalTimerTime
    ) / 60;
    const pace = distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : null;
    return {
      date,
      interval_type: classifyLap(lap),
      interval_index: lap.lapIndex ?? lap.lapNumber ?? index + 1,
      distance_km: distanceKm || null,
      duration_min: durationMin || null,
      pace_min_km: pace,
      avg_hr: lap.averageHR ?? lap.averageHr ?? lap.avgHr ?? null,
      max_hr: lap.maxHR ?? lap.maxHr ?? null,
      thermal_sensation_c: null,
      calories_kcal: null,
      garmin_activity_id: `${activityIdValue}_lap_${index + 1}`,
      external_id: `${activityIdValue}_lap_${index + 1}`,
      notes: null,
    };
  });
}

function classifyLap(lap: any): string {
  const avgHr = lap.averageHR ?? lap.averageHr ?? lap.avgHr ?? 0;
  if (avgHr > 170) return "Intervals";
  if (avgHr > 155) return "Threshold";
  return "Easy";
}

function weightedHr(intervals: any[]) {
  let numerator = 0;
  let denominator = 0;
  for (const interval of intervals) {
    if (!interval.avg_hr) continue;
    const duration = interval.duration_min ?? 1;
    numerator += interval.avg_hr * duration;
    denominator += duration;
  }
  return denominator > 0 ? Math.round(numerator / denominator) : null;
}

async function syncRunMinutesToDaily(supabaseAdmin: any, userId: string, date: string) {
  const { data: activities, error } = await supabaseAdmin
    .from("run_activities")
    .select("duration_min")
    .eq("user_id", userId)
    .eq("date", date);
  if (error) throw error;

  const minCorrida = (activities ?? []).reduce(
    (sum: number, activity: any) => sum + (activity.duration_min ?? 0),
    0
  ) || null;

  const { error: upsertError } = await supabaseAdmin
    .from("daily_logs")
    .upsert({ user_id: userId, date, min_corrida: minCorrida }, { onConflict: "user_id,date" });
  if (upsertError) throw upsertError;
}

function activityId(activity: any): string {
  return String(activity.activityId ?? activity.id ?? "");
}

function activityDate(activity: any): string {
  return String(activity.startTimeLocal ?? activity.startTimeGMT ?? activity.beginTimestamp ?? "").slice(0, 10);
}

function metersToKm(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 100 ? n / 1000 : n;
}

function durationSeconds(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

async function garminLogin(email: string, password: string): Promise<string> {
  if (!email || !password) throw new Error("Credenciais Garmin nao configuradas.");

  const loginPageRes = await fetch(
    `${GARMIN_SSO_URL}/signin?service=https://connect.garmin.com/modern/`,
    { redirect: "follow" }
  );
  const loginPageText = await loginPageRes.text();
  const csrfMatch = loginPageText.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrf = csrfMatch?.[1] ?? "";
  const cookies = loginPageRes.headers.get("set-cookie") ?? "";

  const loginRes = await fetch(
    `${GARMIN_SSO_URL}/signin?service=https://connect.garmin.com/modern/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
        Origin: "https://sso.garmin.com",
        Referer: `${GARMIN_SSO_URL}/signin`,
      },
      body: new URLSearchParams({
        username: email,
        password,
        embed: "false",
        _csrf: csrf,
      }),
      redirect: "manual",
    }
  );

  const allCookies = [cookies, loginRes.headers.get("set-cookie") ?? ""].join("; ");
  const connectRes = await fetch("https://connect.garmin.com/modern/", {
    headers: { Cookie: allCookies },
    redirect: "manual",
  });

  return [allCookies, connectRes.headers.get("set-cookie") ?? ""].join("; ");
}

async function fetchGarminActivities(cookies: string, limit: number) {
  const url = `${GARMIN_CONNECT_API}?limit=${limit}&start=0`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      "NK": "NT",
      "X-app-ver": "4.40.0.0",
    },
  });
  if (!res.ok) throw new Error(`Garmin activities fetch failed: ${res.status}`);
  return res.json();
}

async function fetchGarminLaps(cookies: string, activityIdValue: string) {
  const urls = [
    `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/laps`,
    `https://connect.garmin.com/activity-service/activity/${activityIdValue}/laps`,
    `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/splits`,
  ];

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        Cookie: cookies,
        "NK": "NT",
        "X-app-ver": "4.40.0.0",
      },
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.lapDTOs)) return data.lapDTOs;
    if (Array.isArray(data.laps)) return data.laps;
    if (Array.isArray(data.splits)) return data.splits;
  }

  return [];
}
