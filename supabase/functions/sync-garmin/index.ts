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
const GARMIN_WEB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

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
    fallback: true,
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

    stage = "garmin_login";
    const garminSession = await garminLogin(
      requireEnv("GARMIN_EMAIL"),
      requireEnv("GARMIN_PASSWORD")
    );

    stage = "garmin_activities";
    const activities = await fetchGarminActivities(garminSession, 80);
    if (!Array.isArray(activities)) {
      throw new SyncError(424, "GARMIN_ACTIVITIES_INVALID_RESPONSE", "Garmin retornou uma lista inesperada de atividades.");
    }

    const runs = activities.filter((activity: any) => activity.activityType?.typeKey === "running");

    stage = "candidates";
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
      stage = "import_activity";
      const saved = await importActivity(supabaseAdmin, user.id, garminSession, activity);
      if (saved?.date) touchedDates.add(saved.date);
      imported++;
    }

    stage = "sync_daily_minutes";
    for (const date of touchedDates) {
      await syncRunMinutesToDaily(supabaseAdmin, user.id, date);
    }

    return json({
      imported,
      skipped: selected.length - imported,
      message: `Garmin: ${imported} corridas importadas.`,
    });
  } catch (err) {
    return fail(err, { provider: "garmin", requestId, stage });
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
  if (error) throw dbError("garmin_run_activities_select", error);

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
  if (activityError) throw dbError("garmin_run_activity_upsert", activityError);

  const { error: deleteError } = await supabaseAdmin
    .from("run_sessions")
    .delete()
    .eq("run_activity_id", savedActivity.id)
    .eq("source", "garmin");
  if (deleteError) throw dbError("garmin_intervals_delete", deleteError);

  const rows = intervals.map((interval) => ({
    ...interval,
    user_id: userId,
    run_activity_id: savedActivity.id,
    source: "garmin",
  }));
  const { error: intervalError } = await supabaseAdmin.from("run_sessions").insert(rows);
  if (intervalError) throw dbError("garmin_intervals_insert", intervalError);

  const { error: markerError } = await supabaseAdmin
    .from("activity_imports")
    .upsert({
      user_id: userId,
      provider: "garmin",
      external_id: id,
      metadata: { date, name: activity.activityName ?? null },
    }, { onConflict: "user_id,provider,external_id" });
  if (markerError) throw dbError("garmin_import_marker_upsert", markerError);

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
  if (error) throw dbError("garmin_daily_minutes_select", error);

  const minCorrida = (activities ?? []).reduce(
    (sum: number, activity: any) => sum + (activity.duration_min ?? 0),
    0
  ) || null;

  const { error: upsertError } = await supabaseAdmin
    .from("daily_logs")
    .upsert({ user_id: userId, date, min_corrida: minCorrida }, { onConflict: "user_id,date" });
  if (upsertError) throw dbError("garmin_daily_minutes_upsert", upsertError);
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
  if (!email || !password) {
    throw new SyncError(409, "GARMIN_CREDENTIALS_MISSING", "Credenciais Garmin nao configuradas.");
  }

  const loginPageRes = await fetch(
    `${GARMIN_SSO_URL}/signin?service=https://connect.garmin.com/modern/`,
    {
      headers: {
        ...GARMIN_WEB_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    }
  );
  if (!loginPageRes.ok) {
    throw new SyncError(424, "GARMIN_LOGIN_PAGE_FAILED", "Garmin nao abriu a tela de login.", {
      status: loginPageRes.status,
      body: await responseSnippet(loginPageRes),
    });
  }

  const loginPageText = await loginPageRes.text();
  const csrfMatch =
    loginPageText.match(/name="_csrf"\s+value="([^"]+)"/) ??
    loginPageText.match(/name="csrfToken"\s+value="([^"]+)"/) ??
    loginPageText.match(/"csrfToken"\s*:\s*"([^"]+)"/);
  const csrf = csrfMatch?.[1] ?? "";
  if (!csrf) {
    throw new SyncError(424, "GARMIN_CSRF_NOT_FOUND", "Garmin mudou a tela de login ou bloqueou a requisicao.", {
      status: loginPageRes.status,
      body: loginPageText.slice(0, 500),
    });
  }

  const cookies = cookieHeaderFromResponses(loginPageRes);

  const loginRes = await fetch(
    `${GARMIN_SSO_URL}/signin?service=https://connect.garmin.com/modern/`,
    {
      method: "POST",
      headers: {
        ...GARMIN_WEB_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

  let allCookies = mergeCookieHeaders(cookies, cookieHeaderFromResponses(loginRes));
  const loginLocation = loginRes.headers.get("location") ?? "";
  const loginBodySnippet = loginRes.status === 200 ? await responseSnippet(loginRes) : null;
  if (loginRes.status >= 400 || (loginRes.status === 200 && !loginLocation)) {
    throw new SyncError(409, "GARMIN_AUTH_FAILED", "Garmin recusou o login. Verifique credenciais, MFA ou bloqueio de seguranca.", {
      status: loginRes.status,
      hasLocation: Boolean(loginLocation),
      hints: garminLoginHints(loginBodySnippet),
    });
  }

  if (loginLocation) {
    const redirectRes = await fetch(new URL(loginLocation, GARMIN_SSO_URL).toString(), {
      headers: {
        ...GARMIN_WEB_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: allCookies,
      },
      redirect: "manual",
    });
    allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(redirectRes));
  }

  const connectRes = await fetch("https://connect.garmin.com/modern/", {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: allCookies,
    },
    redirect: "manual",
  });
  allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(connectRes));
  if (!allCookies) {
    throw new SyncError(424, "GARMIN_SESSION_EMPTY", "Garmin nao retornou cookies de sessao.");
  }

  return allCookies;
}

async function fetchGarminActivities(cookies: string, limit: number) {
  const url = `${GARMIN_CONNECT_API}?limit=${limit}&start=0`;
  const res = await fetch(url, {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "application/json, text/plain, */*",
      Cookie: cookies,
      "NK": "NT",
      "X-app-ver": "4.40.0.0",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new SyncError(424, "GARMIN_ACTIVITIES_FAILED", "Garmin recusou a busca de atividades.", {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError(424, "GARMIN_ACTIVITIES_INVALID_RESPONSE", "Garmin retornou atividades em formato inesperado.", {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
}

async function fetchGarminLaps(cookies: string, activityIdValue: string) {
  const urls = [
    `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/laps`,
    `https://connect.garmin.com/activity-service/activity/${activityIdValue}/laps`,
    `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/splits`,
  ];
  let authFailureStatus: number | null = null;

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        ...GARMIN_WEB_HEADERS,
        Accept: "application/json, text/plain, */*",
        Cookie: cookies,
        "NK": "NT",
        "X-app-ver": "4.40.0.0",
      },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) authFailureStatus = res.status;
      continue;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      continue;
    }

    if (Array.isArray(data)) return data;
    if (Array.isArray(data.lapDTOs)) return data.lapDTOs;
    if (Array.isArray(data.laps)) return data.laps;
    if (Array.isArray(data.splits)) return data.splits;
  }

  if (authFailureStatus) {
    throw new SyncError(424, "GARMIN_LAPS_FAILED", "Garmin recusou a busca dos intervalos da corrida.", {
      status: authFailureStatus,
    });
  }

  return [];
}

function cookieHeaderFromResponses(...responses: Response[]): string {
  const values: string[] = [];
  for (const response of responses) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === "function") {
      const cookies = headers.getSetCookie();
      if (cookies.length > 0) {
        values.push(...cookies);
        continue;
      }
    }

    const value = response.headers.get("set-cookie");
    if (value) values.push(value);
  }
  return mergeCookieHeaders(...values);
}

function mergeCookieHeaders(...headers: string[]): string {
  const cookieMap = new Map<string, string>();
  for (const header of headers) {
    for (const cookie of splitSetCookieHeader(header)) {
      const pair = cookie.split(";")[0]?.trim();
      if (!pair || !pair.includes("=")) continue;
      const key = pair.slice(0, pair.indexOf("="));
      cookieMap.set(key, pair);
    }
  }
  return Array.from(cookieMap.values()).join("; ");
}

function splitSetCookieHeader(header: string): string[] {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=)/).map((part) => part.trim()).filter(Boolean);
}

function garminLoginHints(text: string | null): Record<string, boolean> {
  const lower = String(text ?? "").toLowerCase();
  return {
    mentionsMfa: lower.includes("mfa") || lower.includes("two-factor") || lower.includes("two factor"),
    mentionsCaptcha: lower.includes("captcha"),
    mentionsInvalidCredentials: lower.includes("invalid") || lower.includes("incorrect"),
  };
}
