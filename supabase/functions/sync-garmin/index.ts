/**
 * Supabase Edge Function: sync-garmin
 *
 * POST body:
 *   { "mode": "list" }
 *   { "mode": "import", "ids": ["activity-id"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GARMIN_SSO_URL = "https://sso.garmin.com/sso";
const GARMIN_CONNECT_API_URL = "https://connectapi.garmin.com";
const GARMIN_MOBILE_USER_AGENT = "GCM-iOS-5.7.2.1";
const GARMIN_SESSION_PROVIDER = "garmin";
const GARMIN_BEARER_DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const GARMIN_COOKIE_TTL_MS = 6 * 60 * 60 * 1000;
const GARMIN_TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000;
const GARMIN_PUBLIC_OAUTH_CONSUMER: GarminOAuthConsumer = {
  key: "fc3e99d2-118c-44b8-8ae3-03370dde24c0",
  secret: "E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF",
};
const GARMIN_ACTIVITY_URLS: Array<{ url: string; auth: GarminEndpointAuth }> = [
  {
    url: `${GARMIN_CONNECT_API_URL}/activitylist-service/activities/search/activities`,
    auth: "bearer",
  },
  {
    url: "https://connect.garmin.com/modern/proxy/activitylist-service/activities/search/activities",
    auth: "cookies",
  },
  {
    url: "https://connect.garmin.com/activitylist-service/activities/search/activities",
    auth: "cookies",
  },
];
const GARMIN_WEB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

type GarminEndpointAuth = "bearer" | "cookies";
type GarminOAuthConsumer = { key: string; secret: string };
type GarminBearerToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};
type GarminSession = {
  cookies: string;
  bearerToken: string | null;
  bearerExpiresAt?: string | null;
  refreshToken?: string | null;
  authMode: "oauth" | "cookies";
  oauthFailure?: Record<string, unknown>;
  fromCache?: boolean;
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
    details: detailsForClient(syncError),
  }, syncError.status);
}

function detailsForClient(error: SyncError): unknown | undefined {
  if (!error.code.startsWith("GARMIN_")) return undefined;
  return redactSensitiveDetails(error.details);
}

function redactSensitiveDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveDetails);
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|cookie|authorization|password/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactSensitiveDetails(item);
    }
  }
  return redacted;
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

function isGarminRateLimitError(error: unknown): boolean {
  return error instanceof SyncError && (error.status === 429 || error.code === "GARMIN_RATE_LIMITED");
}

function isGarminSessionRejected(error: unknown): boolean {
  if (!(error instanceof SyncError)) return false;
  const attempts = Array.isArray(error.details?.attempts) ? error.details.attempts : [];
  return attempts.some((attempt: any) =>
    attempt?.status === 401 ||
    attempt?.status === 403 ||
    attempt?.reason === "missing_bearer_token" ||
    attempt?.reason === "missing_cookies"
  );
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

    stage = "garmin_session";
    let garminSession = await getCachedGarminSession(supabaseAdmin, user.id);
    let usedCachedSession = Boolean(garminSession);
    if (!garminSession) {
      stage = "garmin_login";
      garminSession = await garminLogin(
        requireEnv("GARMIN_EMAIL"),
        requireEnv("GARMIN_PASSWORD")
      );
      await saveCachedGarminSession(supabaseAdmin, user.id, garminSession);
    }

    stage = "garmin_activities";
    let activities: any[];
    try {
      activities = await fetchGarminActivities(garminSession, 80);
    } catch (error) {
      if (!usedCachedSession || !isGarminSessionRejected(error)) throw error;

      await clearCachedGarminSession(supabaseAdmin, user.id);
      stage = "garmin_login";
      garminSession = await garminLogin(
        requireEnv("GARMIN_EMAIL"),
        requireEnv("GARMIN_PASSWORD")
      );
      usedCachedSession = false;
      await saveCachedGarminSession(supabaseAdmin, user.id, garminSession);

      stage = "garmin_activities";
      activities = await fetchGarminActivities(garminSession, 80);
    }
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

async function getCachedGarminSession(supabaseAdmin: any, userId: string): Promise<GarminSession | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("integration_tokens")
    .select("access_token, refresh_token, expires_at, metadata")
    .eq("user_id", userId)
    .eq("provider", GARMIN_SESSION_PROVIDER)
    .maybeSingle();
  if (error) throw dbError("garmin_session_select", error);

  const metadata = tokenRow?.metadata ?? {};
  const bearerToken = typeof tokenRow?.access_token === "string" ? tokenRow.access_token.trim() : "";
  const refreshToken = typeof tokenRow?.refresh_token === "string" ? tokenRow.refresh_token.trim() : "";
  const bearerExpiresAt = tokenRow?.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const bearerValid = Boolean(
    bearerToken &&
    (!bearerExpiresAt || bearerExpiresAt - GARMIN_TOKEN_REFRESH_SKEW_MS > Date.now())
  );

  const cookies = typeof metadata.cookies === "string" ? metadata.cookies.trim() : "";
  const cookiesExpiresAt = metadata.cookies_expires_at
    ? new Date(metadata.cookies_expires_at).getTime()
    : 0;
  const cookiesValid = Boolean(cookies && (!cookiesExpiresAt || cookiesExpiresAt > Date.now()));

  if (!bearerValid && !cookiesValid) return null;

  return {
    cookies: cookiesValid ? cookies : "",
    bearerToken: bearerValid ? bearerToken : null,
    bearerExpiresAt: bearerValid ? tokenRow.expires_at : null,
    refreshToken: refreshToken || null,
    authMode: bearerValid ? "oauth" : "cookies",
    fromCache: true,
  };
}

async function saveCachedGarminSession(
  supabaseAdmin: any,
  userId: string,
  session: GarminSession
) {
  const now = Date.now();
  const expiresAt = session.bearerToken
    ? session.bearerExpiresAt ?? new Date(now + GARMIN_BEARER_DEFAULT_TTL_MS).toISOString()
    : null;
  const cookiesExpiresAt = session.cookies
    ? new Date(now + GARMIN_COOKIE_TTL_MS).toISOString()
    : null;

  const { error } = await supabaseAdmin
    .from("integration_tokens")
    .upsert({
      user_id: userId,
      provider: GARMIN_SESSION_PROVIDER,
      access_token: session.bearerToken,
      refresh_token: session.refreshToken ?? null,
      expires_at: expiresAt,
      metadata: {
        auth_mode: session.authMode,
        cookies: session.cookies || null,
        cookies_expires_at: cookiesExpiresAt,
        oauth_failure: session.oauthFailure ?? null,
        cached_by: "sync-garmin",
        saved_at: new Date(now).toISOString(),
      },
    }, { onConflict: "user_id,provider" });
  if (error) throw dbError("garmin_session_upsert", error);
}

async function clearCachedGarminSession(supabaseAdmin: any, userId: string) {
  const { error } = await supabaseAdmin
    .from("integration_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", GARMIN_SESSION_PROVIDER);
  if (error) throw dbError("garmin_session_delete", error);
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

async function importActivity(supabaseAdmin: any, userId: string, session: GarminSession, activity: any) {
  const id = activityId(activity);
  const date = activityDate(activity);
  if (!id || !date) return null;

  const laps = await fetchGarminLaps(session, id);
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

async function garminLogin(email: string, password: string): Promise<GarminSession> {
  if (!email || !password) {
    throw new SyncError(409, "GARMIN_CREDENTIALS_MISSING", "Credenciais Garmin nao configuradas.");
  }

  const failures: Record<string, unknown>[] = [];
  let cookieFallback: GarminSession | null = null;
  for (const strategy of [garminConnectLogin, garminSigninLogin, garminTicketLogin]) {
    try {
      const session = await strategy(email, password);
      if (session.bearerToken) return session;
      cookieFallback ??= session;
    } catch (error) {
      if (isGarminRateLimitError(error)) throw error;
      failures.push(errorDetailsForLog(error));
    }
  }

  if (cookieFallback) return cookieFallback;

  throw new SyncError(
    409,
    "GARMIN_AUTH_FAILED",
    "Garmin recusou o login. Verifique credenciais, MFA ou bloqueio de seguranca.",
    { strategies: failures }
  );
}

async function garminConnectLogin(email: string, password: string): Promise<GarminSession> {
  const signinUrl = new URL(`${GARMIN_SSO_URL}/signin`);
  signinUrl.searchParams.set("service", "https://connect.garmin.com/modern");
  signinUrl.searchParams.set("clientId", "GarminConnect");
  signinUrl.searchParams.set("consumeServiceTicket", "false");

  const loginPageRes = await fetch(signinUrl.toString(), {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!loginPageRes.ok) {
    throw new SyncError(424, "GARMIN_CONNECT_LOGIN_PAGE_FAILED", "Garmin nao abriu a tela de login Connect.", {
      status: loginPageRes.status,
      body: await responseSnippet(loginPageRes),
    });
  }

  const loginPageText = await loginPageRes.text();
  const csrf =
    loginPageText.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] ??
    loginPageText.match(/name="csrfToken"\s+value="([^"]+)"/)?.[1] ??
    "";
  if (!csrf) {
    throw new SyncError(424, "GARMIN_CONNECT_CSRF_NOT_FOUND", "Garmin mudou a tela de login Connect.", {
      body: loginPageText.slice(0, 500),
    });
  }

  const cookies = cookieHeaderFromResponses(loginPageRes);
  const loginRes = await fetch(signinUrl.toString(), {
    method: "POST",
    headers: {
      ...GARMIN_WEB_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: cookies,
      Origin: "https://sso.garmin.com",
      Referer: signinUrl.toString(),
    },
    body: new URLSearchParams({
      username: email,
      password,
      embed: "true",
      _csrf: csrf,
      _eventId: "submit",
      displayNameRequired: "false",
    }),
    redirect: "manual",
  });

  const allCookies = mergeCookieHeaders(cookies, cookieHeaderFromResponses(loginRes));
  const location = loginRes.headers.get("location") ?? "";
  const body = loginRes.status === 200 ? await loginRes.text() : "";
  const ticket = extractGarminTicket(location) ?? extractGarminTicket(body);
  if (!ticket) {
    throw new SyncError(409, "GARMIN_CONNECT_AUTH_FAILED", "Garmin recusou o login Connect.", {
      status: loginRes.status,
      hasLocation: Boolean(location),
      hints: garminLoginHints(body),
    });
  }

  return redeemGarminTicket(ticket, allCookies);
}

async function garminSigninLogin(email: string, password: string): Promise<GarminSession> {
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
  const loginBody = loginRes.status === 200 ? await loginRes.text() : "";
  const ticket = extractGarminTicket(loginLocation) ?? extractGarminTicket(loginBody);
  if (ticket) {
    return redeemGarminTicket(ticket, allCookies);
  }

  if (loginRes.status >= 400 || (loginRes.status === 200 && !loginLocation)) {
    throw new SyncError(409, "GARMIN_SIGNIN_FAILED", "Garmin recusou o login via signin.", {
      status: loginRes.status,
      hasLocation: Boolean(loginLocation),
      hints: garminLoginHints(loginBody),
    });
  }

  if (loginLocation) {
    const redirectRes = await fetch(new URL(loginLocation, GARMIN_SSO_URL).toString(), {
      headers: {
        ...GARMIN_WEB_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: allCookies,
      },
      redirect: "follow",
    });
    allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(redirectRes));
  }

  const connectRes = await fetch("https://connect.garmin.com/modern/", {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: allCookies,
    },
    redirect: "follow",
  });
  allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(connectRes));
  if (!allCookies) {
    throw new SyncError(424, "GARMIN_SESSION_EMPTY", "Garmin nao retornou cookies de sessao.");
  }

  return { cookies: allCookies, bearerToken: null, authMode: "cookies" };
}

async function garminTicketLogin(email: string, password: string): Promise<GarminSession> {
  const service = "https://connect.garmin.com/post-auth/login";
  const loginUrl = new URL(`${GARMIN_SSO_URL}/login`);
  loginUrl.searchParams.set("service", service);
  loginUrl.searchParams.set("clientId", "GarminConnect");
  loginUrl.searchParams.set("consumeServiceTicket", "false");

  const loginPageRes = await fetch(loginUrl.toString(), {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!loginPageRes.ok) {
    throw new SyncError(424, "GARMIN_TICKET_LOGIN_PAGE_FAILED", "Garmin nao abriu a tela alternativa de login.", {
      status: loginPageRes.status,
    });
  }

  const loginPageText = await loginPageRes.text();
  const lt =
    loginPageText.match(/name="lt"\s+value="([^"]+)"/)?.[1] ??
    loginPageText.match(/flowExecutionKey:\s*\[?([A-Za-z0-9_-]+)/)?.[1] ??
    "";
  if (!lt) {
    throw new SyncError(424, "GARMIN_TICKET_FLOW_NOT_FOUND", "Garmin nao retornou chave do fluxo de login.", {
      hints: garminLoginHints(loginPageText),
    });
  }

  const cookies = cookieHeaderFromResponses(loginPageRes);
  const loginRes = await fetch(loginUrl.toString(), {
    method: "POST",
    headers: {
      ...GARMIN_WEB_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: cookies,
      Origin: "https://sso.garmin.com",
      Referer: loginUrl.toString(),
    },
    body: new URLSearchParams({
      username: email,
      password,
      embed: "true",
      lt,
      _eventId: "submit",
    }),
    redirect: "manual",
  });

  const allCookies = mergeCookieHeaders(cookies, cookieHeaderFromResponses(loginRes));
  const location = loginRes.headers.get("location") ?? "";
  const body = await loginRes.text();
  const ticket = extractGarminTicket(location) ?? extractGarminTicket(body);
  if (!ticket) {
    throw new SyncError(409, "GARMIN_TICKET_AUTH_FAILED", "Garmin recusou o login alternativo.", {
      status: loginRes.status,
      hasLocation: Boolean(location),
      hints: garminLoginHints(body),
    });
  }

  return redeemGarminTicket(ticket, allCookies);
}

async function redeemGarminTicket(ticket: string, cookies: string): Promise<GarminSession> {
  let bearer: GarminBearerToken | null = null;
  let oauthFailure: Record<string, unknown> | undefined;
  try {
    bearer = await fetchGarminBearerToken(ticket);
  } catch (error) {
    if (isGarminRateLimitError(error)) throw error;
    oauthFailure = errorDetailsForLog(error);
    console.warn("Garmin OAuth token exchange failed", JSON.stringify(oauthFailure));
  }

  let allCookies = cookies;
  const redeemRes = await fetch(`https://connect.garmin.com/post-auth/login?ticket=${encodeURIComponent(ticket)}`, {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: allCookies,
    },
    redirect: "follow",
  });
  allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(redeemRes));

  const connectRes = await fetch("https://connect.garmin.com/modern/", {
    headers: {
      ...GARMIN_WEB_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: allCookies,
    },
    redirect: "follow",
  });
  allCookies = mergeCookieHeaders(allCookies, cookieHeaderFromResponses(connectRes));
  if (!allCookies && !bearer?.accessToken) {
    throw new SyncError(424, "GARMIN_SESSION_EMPTY", "Garmin nao retornou cookies de sessao.");
  }

  return {
    cookies: allCookies,
    bearerToken: bearer?.accessToken ?? null,
    bearerExpiresAt: bearer?.expiresAt ?? null,
    refreshToken: bearer?.refreshToken ?? null,
    authMode: bearer?.accessToken ? "oauth" : "cookies",
    oauthFailure,
  };
}

async function fetchGarminBearerToken(ticket: string): Promise<GarminBearerToken> {
  const consumer = await getGarminOAuthConsumer();
  const preauthorizedUrl = `${GARMIN_CONNECT_API_URL}/oauth-service/oauth/preauthorized`;
  const preauthorizedParams = {
    ticket,
    "login-url": "https://sso.garmin.com/sso",
  };
  const preauthorizedSearch = new URLSearchParams(preauthorizedParams);
  const preauthorizedRes = await fetch(`${preauthorizedUrl}?${preauthorizedSearch.toString()}`, {
    headers: {
      Accept: "application/x-www-form-urlencoded, application/json, */*",
      Authorization: await buildOAuthHeader("GET", preauthorizedUrl, preauthorizedParams, consumer),
      "User-Agent": GARMIN_MOBILE_USER_AGENT,
    },
  });
  const preauthorizedText = await preauthorizedRes.text();
  if (!preauthorizedRes.ok) {
    if (preauthorizedRes.status === 429) {
      throw new SyncError(
        429,
        "GARMIN_RATE_LIMITED",
        "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
        {
          endpoint: "oauth_preauthorized",
          status: preauthorizedRes.status,
          retryAfter: preauthorizedRes.headers.get("retry-after"),
          body: preauthorizedText.slice(0, 300),
        }
      );
    }
    throw new SyncError(424, "GARMIN_OAUTH_PREAUTHORIZED_FAILED", "Garmin recusou a troca do ticket por token OAuth.", {
      status: preauthorizedRes.status,
      body: preauthorizedText.slice(0, 300),
    });
  }

  const oauth1Params = new URLSearchParams(preauthorizedText);
  const oauthToken = oauth1Params.get("oauth_token");
  const oauthTokenSecret = oauth1Params.get("oauth_token_secret");
  if (!oauthToken || !oauthTokenSecret) {
    throw new SyncError(424, "GARMIN_OAUTH_TOKEN_MISSING", "Garmin nao retornou token OAuth intermediario.", {
      body: preauthorizedText.slice(0, 300),
    });
  }

  const exchangeUrl = `${GARMIN_CONNECT_API_URL}/oauth-service/oauth/exchange/user/2.0`;
  const exchangeRes = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: await buildOAuthHeader("POST", exchangeUrl, {}, consumer, {
        token: oauthToken,
        tokenSecret: oauthTokenSecret,
      }),
      "User-Agent": GARMIN_MOBILE_USER_AGENT,
    },
  });
  const exchangeText = await exchangeRes.text();
  if (!exchangeRes.ok) {
    if (exchangeRes.status === 429) {
      throw new SyncError(
        429,
        "GARMIN_RATE_LIMITED",
        "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
        {
          endpoint: "oauth_exchange",
          status: exchangeRes.status,
          retryAfter: exchangeRes.headers.get("retry-after"),
          body: exchangeText.slice(0, 300),
        }
      );
    }
    throw new SyncError(424, "GARMIN_OAUTH_EXCHANGE_FAILED", "Garmin recusou a troca para bearer token.", {
      status: exchangeRes.status,
      body: exchangeText.slice(0, 300),
    });
  }

  let exchangeData: any;
  try {
    exchangeData = JSON.parse(exchangeText);
  } catch {
    throw new SyncError(424, "GARMIN_OAUTH_EXCHANGE_INVALID_JSON", "Garmin retornou token em formato inesperado.", {
      body: exchangeText.slice(0, 300),
    });
  }

  const accessToken = exchangeData.access_token ?? exchangeData.token ?? exchangeData.oauth_token;
  if (!accessToken) {
    throw new SyncError(424, "GARMIN_OAUTH_ACCESS_TOKEN_MISSING", "Garmin nao retornou bearer token.", {
      keys: Object.keys(exchangeData ?? {}),
    });
  }

  const expiresIn = Number(exchangeData.expires_in ?? exchangeData.expiresIn ?? 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : new Date(Date.now() + GARMIN_BEARER_DEFAULT_TTL_MS).toISOString();

  return {
    accessToken: String(accessToken),
    refreshToken: exchangeData.refresh_token ? String(exchangeData.refresh_token) : null,
    expiresAt,
  };
}

async function getGarminOAuthConsumer(): Promise<GarminOAuthConsumer> {
  const key = Deno.env.get("GARMIN_OAUTH_CONSUMER_KEY")?.trim();
  const secret = Deno.env.get("GARMIN_OAUTH_CONSUMER_SECRET")?.trim();
  if (key && secret) return { key, secret };

  const res = await fetch("https://thegarth.s3.amazonaws.com/oauth_consumer.json", {
    headers: { Accept: "application/json" },
  }).catch(() => null);
  if (!res) return GARMIN_PUBLIC_OAUTH_CONSUMER;

  if (!res.ok) {
    return GARMIN_PUBLIC_OAUTH_CONSUMER;
  }

  const data = await res.json();
  const remoteKey = data.consumer_key ?? data.consumerKey ?? data.key;
  const remoteSecret = data.consumer_secret ?? data.consumerSecret ?? data.secret;
  if (!remoteKey || !remoteSecret) {
    return GARMIN_PUBLIC_OAUTH_CONSUMER;
  }

  return { key: String(remoteKey), secret: String(remoteSecret) };
}

function garminApiHeaders(
  session: GarminSession,
  auth: GarminEndpointAuth,
  referer?: string
): Record<string, string> | null {
  const baseHeaders = {
    ...GARMIN_WEB_HEADERS,
    Accept: "application/json, text/plain, */*",
    "NK": "NT",
    "X-app-ver": "4.40.0.0",
    "X-Requested-With": "XMLHttpRequest",
  };

  if (auth === "bearer") {
    if (!session.bearerToken) return null;
    return {
      ...baseHeaders,
      "User-Agent": GARMIN_MOBILE_USER_AGENT,
      Authorization: `Bearer ${session.bearerToken}`,
    };
  }

  if (!session.cookies) return null;
  return {
    ...baseHeaders,
    Cookie: session.cookies,
    Origin: "https://connect.garmin.com",
    Referer: referer ?? "https://connect.garmin.com/modern/",
    "DI-Backend": "connectapi.garmin.com",
  };
}

async function buildOAuthHeader(
  method: string,
  url: string,
  requestParams: Record<string, string>,
  consumer: GarminOAuthConsumer,
  token?: { token: string; tokenSecret: string }
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: crypto.randomUUID().replaceAll("-", ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
  if (token?.token) oauthParams.oauth_token = token.token;

  const signatureParams = { ...requestParams, ...oauthParams };
  const signatureBase = [
    method.toUpperCase(),
    oauthPercent(normalizedUrl(url)),
    oauthPercent(normalizeOAuthParams(signatureParams)),
  ].join("&");
  const signingKey = `${oauthPercent(consumer.secret)}&${oauthPercent(token?.tokenSecret ?? "")}`;
  oauthParams.oauth_signature = await hmacSha1Base64(signingKey, signatureBase);

  return `OAuth ${Object.entries(oauthParams)
    .sort(([a], [b]) => compareAscii(a, b))
    .map(([key, value]) => `${oauthPercent(key)}="${oauthPercent(value)}"`)
    .join(", ")}`;
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeOAuthParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => [oauthPercent(key), oauthPercent(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) => compareAscii(keyA, keyB) || compareAscii(valueA, valueB))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function compareAscii(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function oauthPercent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function fetchGarminActivities(session: GarminSession, limit: number) {
  const failures: Record<string, unknown>[] = [];

  for (const endpoint of GARMIN_ACTIVITY_URLS) {
    const headers = garminApiHeaders(session, endpoint.auth, "https://connect.garmin.com/modern/activities");
    if (!headers) {
      failures.push({
        url: endpoint.url,
        auth: endpoint.auth,
        reason: endpoint.auth === "bearer" ? "missing_bearer_token" : "missing_cookies",
        oauthFailure: session.oauthFailure,
      });
      continue;
    }

    const url = `${endpoint.url}?start=0&limit=${limit}`;
    const res = await fetch(url, {
      headers,
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        throw new SyncError(
          429,
          "GARMIN_RATE_LIMITED",
          "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
          {
            endpoint: endpoint.url,
            auth: endpoint.auth,
            retryAfter: res.headers.get("retry-after"),
            body: text.slice(0, 300),
          }
        );
      }
      failures.push({
        url: endpoint.url,
        auth: endpoint.auth,
        status: res.status,
        body: text.slice(0, 300),
      });
      continue;
    }

    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;
      failures.push({
        url: endpoint.url,
        auth: endpoint.auth,
        status: res.status,
        body: text.slice(0, 300),
        reason: "not_array",
      });
    } catch {
      failures.push({
        url: endpoint.url,
        auth: endpoint.auth,
        status: res.status,
        body: text.slice(0, 300),
        reason: "invalid_json",
      });
    }
  }

  throw new SyncError(424, "GARMIN_ACTIVITIES_FAILED", "Garmin recusou a busca de atividades.", {
    attempts: failures,
  });
}

async function fetchGarminLaps(session: GarminSession, activityIdValue: string) {
  const urls = [
    {
      url: `${GARMIN_CONNECT_API_URL}/activity-service/activity/${activityIdValue}/laps`,
      auth: "bearer" as GarminEndpointAuth,
    },
    {
      url: `${GARMIN_CONNECT_API_URL}/activity-service/activity/${activityIdValue}/splits`,
      auth: "bearer" as GarminEndpointAuth,
    },
    {
      url: `https://connect.garmin.com/activity-service/activity/${activityIdValue}/laps`,
      auth: "cookies" as GarminEndpointAuth,
    },
    {
      url: `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/laps`,
      auth: "cookies" as GarminEndpointAuth,
    },
    {
      url: `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/splits`,
      auth: "cookies" as GarminEndpointAuth,
    },
  ];
  let authFailureStatus: number | null = null;

  for (const endpoint of urls) {
    const headers = garminApiHeaders(session, endpoint.auth, "https://connect.garmin.com/modern/activities");
    if (!headers) continue;

    const res = await fetch(endpoint.url, { headers });
    if (!res.ok) {
      if (res.status === 429) {
        throw new SyncError(
          429,
          "GARMIN_RATE_LIMITED",
          "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
          {
            endpoint: endpoint.url,
            auth: endpoint.auth,
            retryAfter: res.headers.get("retry-after"),
          }
        );
      }
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

function extractGarminTicket(value: string): string | null {
  if (!value) return null;
  const normalized = value.replaceAll("&amp;", "&");
  const match =
    normalized.match(/[?&]ticket=([^'"&\s]+)/) ??
    normalized.match(/ticket%3D([^'"&\s]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function garminLoginHints(text: string | null): Record<string, boolean> {
  const lower = String(text ?? "").toLowerCase();
  return {
    mentionsMfa: lower.includes("mfa") || lower.includes("two-factor") || lower.includes("two factor"),
    mentionsCaptcha: lower.includes("captcha"),
    mentionsInvalidCredentials: lower.includes("invalid") || lower.includes("incorrect"),
  };
}

function errorDetailsForLog(error: unknown): Record<string, unknown> {
  if (error instanceof SyncError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: error instanceof Error ? error.message : String(error),
  };
}
