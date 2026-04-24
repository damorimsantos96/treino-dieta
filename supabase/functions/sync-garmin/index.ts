/**
 * Supabase Edge Function: sync-garmin
 *
 * POST body:
 *   { "mode": "list" }
 *   { "mode": "import", "ids": ["activity-id"] }
 *   { "mode": "reimport", "ids": ["activity-id"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Garmin API endpoints ─────────────────────────────────────────────────────
const GARMIN_CONNECT_API_URL = "https://connectapi.garmin.com";
const GARMIN_SESSION_PROVIDER = "garmin";

// Mobile SSO (new working flow — replaces deprecated OAuth1)
const GARMIN_SSO_MOBILE_BASE = "https://sso.garmin.com/mobile/api";
const GARMIN_DI_AUTH_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const GARMIN_DI_GRANT_TYPE_TICKET = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";
const GARMIN_IOS_SSO_CLIENT_ID = "GCM_IOS_DARK";
const GARMIN_IOS_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/ios";
const GARMIN_IOS_LOGIN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const GARMIN_NATIVE_UA = "GCM-Android-5.23";

// DI client IDs tried in order (Garmin rotates these quarterly)
const GARMIN_DI_CLIENT_IDS = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];

// ── Token TTLs ───────────────────────────────────────────────────────────────
const GARMIN_BEARER_DEFAULT_TTL_MS = 1 * 60 * 60 * 1000;      // 1h (server returns expires_in: 3600)
const GARMIN_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;           // refresh 5min before expiry
const GARMIN_REFRESH_TOKEN_TTL_MS = 89 * 24 * 60 * 60 * 1000; // 89 days (server: 90 days)

// ── Activity endpoints (bearer is primary; cookie fallbacks for legacy cache) ─
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

const GARMIN_MOBILE_USER_AGENT = "GCM-iOS-5.7.2.1";

// ── Types ────────────────────────────────────────────────────────────────────
type GarminEndpointAuth = "bearer" | "cookies";
type GarminBearerToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  clientId: string;
};
type GarminSession = {
  cookies: string;
  bearerToken: string | null;
  bearerExpiresAt?: string | null;
  refreshToken?: string | null;
  authMode: "oauth" | "cookies";
  oauthFailure?: Record<string, unknown>;
  fromCache?: boolean;
  diClientId?: string;
};

// ── CORS ─────────────────────────────────────────────────────────────────────
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

// ── Error handling ───────────────────────────────────────────────────────────
class SyncError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  retryAfterMs?: number;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, retryAfterMs?: number) {
    super(message);
    this.name = "SyncError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
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

// ── Retry with exponential backoff + jitter ──────────────────────────────────
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 10_000;
const RETRY_MAX_ATTEMPTS = 3;

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; isRetryable?: (e: unknown) => boolean } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  const isRetryable = opts.isRetryable ?? isGarminRateLimitError;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      const retryAfterMs = err instanceof SyncError ? err.retryAfterMs : undefined;
      const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
      const delay = retryAfterMs ?? Math.random() * ceiling;
      console.warn(`[sync-garmin] Rate limited, aguardando ${Math.round(delay)}ms (tentativa ${attempt + 1}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function isGarminSessionRejected(error: unknown): boolean {
  if (!(error instanceof SyncError)) return false;
  if (error.status === 401 || error.status === 403) return true;
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

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const requestId = crypto.randomUUID();
  let stage = "start";

  try {
    stage = "auth";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized", code: "UNAUTHORIZED", stage, requestId }, 401);
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
      return json({ error: "Unauthorized", code: "UNAUTHORIZED", stage, requestId }, 401);
    }

    stage = "parse_body";
    const body = await safeJson(req);
    const mode = body.mode === "import"
      ? "import"
      : body.mode === "reimport"
      ? "reimport"
      : "list";
    const selectedIds = new Set<string>(Array.isArray(body.ids) ? body.ids.map(String) : []);

    stage = "garmin_session";
    let garminSession = await getValidGarminSession(supabaseAdmin, user.id);
    let usedCachedSession = Boolean(garminSession);
    if (!garminSession) {
      stage = "garmin_login";
      garminSession = await withRetry(
        () => garminLogin(requireEnv("GARMIN_EMAIL"), requireEnv("GARMIN_PASSWORD")),
        { isRetryable: isGarminRateLimitError }
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
      garminSession = await withRetry(
        () => garminLogin(requireEnv("GARMIN_EMAIL"), requireEnv("GARMIN_PASSWORD")),
        { isRetryable: isGarminRateLimitError }
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
      if (mode === "import" && candidate.already_imported) continue;
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
      message: mode === "reimport"
        ? `Garmin: ${imported} corridas reimportadas.`
        : `Garmin: ${imported} corridas importadas.`,
    });
  } catch (err) {
    return fail(err, { provider: "garmin", requestId, stage });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ── Session management ────────────────────────────────────────────────────────

/**
 * Returns a valid Garmin session from cache.
 * If the bearer token is expired but the refresh token is still valid,
 * automatically refreshes and persists the new token before returning.
 */
async function getValidGarminSession(supabaseAdmin: any, userId: string): Promise<GarminSession | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("integration_tokens")
    .select("access_token, refresh_token, expires_at, metadata")
    .eq("user_id", userId)
    .eq("provider", GARMIN_SESSION_PROVIDER)
    .maybeSingle();
  if (error) throw dbError("garmin_session_select", error);
  if (!tokenRow) return null;

  const metadata = tokenRow.metadata ?? {};
  const bearerToken = typeof tokenRow.access_token === "string" ? tokenRow.access_token.trim() : "";
  const refreshToken = typeof tokenRow.refresh_token === "string" ? tokenRow.refresh_token.trim() : "";
  const diClientId: string = typeof metadata.di_client_id === "string" ? metadata.di_client_id : GARMIN_DI_CLIENT_IDS[0];

  const bearerExpiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const bearerValid = Boolean(
    bearerToken &&
    (!bearerExpiresAt || bearerExpiresAt - GARMIN_TOKEN_REFRESH_SKEW_MS > Date.now())
  );

  // Bearer token still valid — return immediately
  if (bearerValid) {
    return {
      cookies: typeof metadata.cookies === "string" ? metadata.cookies : "",
      bearerToken,
      bearerExpiresAt: tokenRow.expires_at,
      refreshToken: refreshToken || null,
      authMode: "oauth",
      fromCache: true,
      diClientId,
    };
  }

  // Bearer expired — try refresh token before forcing full re-login
  const refreshExpiresAt = metadata.refresh_token_expires_at
    ? new Date(metadata.refresh_token_expires_at).getTime()
    : 0;
  const refreshValid = Boolean(refreshToken && (!refreshExpiresAt || refreshExpiresAt > Date.now()));

  if (refreshValid && refreshToken) {
    try {
      const refreshed = await garminRefreshBearerToken(refreshToken, diClientId);
      const session: GarminSession = {
        cookies: "",
        bearerToken: refreshed.accessToken,
        bearerExpiresAt: refreshed.expiresAt,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        authMode: "oauth",
        fromCache: true,
        diClientId: refreshed.clientId,
      };
      await saveCachedGarminSession(supabaseAdmin, userId, session);
      console.log("[sync-garmin] Bearer token renovado via refresh token.");
      return session;
    } catch (refreshError) {
      console.warn("[sync-garmin] Refresh token falhou, requer novo login.", errorDetailsForLog(refreshError));
      // Fall through to return null → triggers full re-login
    }
  }

  return null;
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
  const refreshTokenExpiresAt = session.refreshToken
    ? new Date(now + GARMIN_REFRESH_TOKEN_TTL_MS).toISOString()
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
        di_client_id: session.diClientId ?? null,
        refresh_token_expires_at: refreshTokenExpiresAt,
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

// ── Data helpers ──────────────────────────────────────────────────────────────
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
  const activityDistanceKm = metersToKm(activity.distance);
  const intervals = normalizeLaps(laps.length ? laps : [activity], date, id, activityDistanceKm);
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
      distance_km: totalKm || activityDistanceKm,
      duration_min: totalMin || durationSeconds(activity.duration ?? activity.elapsedDuration) / 60,
      avg_pace_min_km: totalKm > 0 && totalMin > 0 ? totalMin / totalKm : null,
      avg_hr: avgHr ?? activity.averageHR ?? null,
      max_hr: maxHr,
      thermal_sensation_c: activity.temperatureC ?? activity.avgTemperature ?? null,
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

function normalizeLaps(laps: any[], date: string, activityIdValue: string, activityDistanceKm: number) {
  const normalized = laps.map((lap, index) => {
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

  // Remove trailing artifact laps in a loop — Garmin occasionally appends more than one.
  while (normalized.length > 1 && shouldSkipTrailingSummaryLap(normalized, activityDistanceKm)) {
    normalized.pop();
  }

  return normalized;
}

function shouldSkipTrailingSummaryLap(intervals: any[], activityDistanceKm: number): boolean {
  if (intervals.length <= 1) return false;

  const last = intervals[intervals.length - 1];
  const durationMin: number = last?.duration_min ?? 0;
  const distanceKm: number = last?.distance_km ?? 0;
  const pace: number | null = last?.pace_min_km ?? null;

  // Near-zero distance is harmless regardless of duration — keep it.
  if (distanceKm <= 0.05) return false;

  // Zero duration with non-trivial distance is physically impossible.
  if (durationMin === 0) return true;

  // Pace below 1 min/km (> 60 km/h) is physically impossible for a running lap.
  // This catches summary laps where Garmin stores a small real duration (e.g. 2.4s cooldown)
  // but an inflated distance field — resulting in an absurd computed pace.
  if (pace !== null && Number.isFinite(pace) && pace < 1.0) return true;

  // Preceding laps already account for the full activity distance: this lap is an artifact.
  // Extra guard: artifact must be disproportionately large (> 30% of activity total) to
  // avoid dropping a legitimate short finishing segment.
  if (activityDistanceKm > 0) {
    const precedingKm = intervals.slice(0, -1).reduce((s: number, i: any) => s + (i.distance_km ?? 0), 0);
    const tolerance = Math.max(0.15, activityDistanceKm * 0.02);
    if (precedingKm >= activityDistanceKm - tolerance && distanceKm > activityDistanceKm * 0.3) return true;
  }

  return false;
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

// ── Garmin Authentication — Mobile SSO Flow ───────────────────────────────────
// Replaces the deprecated OAuth1 ticket flow (oauth_preauthorized) which Garmin
// intentionally rate-limits to block unofficial access.

async function garminLogin(email: string, password: string): Promise<GarminSession> {
  if (!email || !password) {
    throw new SyncError(409, "GARMIN_CREDENTIALS_MISSING", "Credenciais Garmin nao configuradas.");
  }

  const ticket = await garminMobileSsoLogin(email, password);
  const bearer = await garminExchangeServiceTicket(ticket);

  return {
    cookies: "",
    bearerToken: bearer.accessToken,
    bearerExpiresAt: bearer.expiresAt,
    refreshToken: bearer.refreshToken,
    authMode: "oauth",
    diClientId: bearer.clientId,
  };
}

async function garminMobileSsoLogin(email: string, password: string): Promise<string> {
  const url = new URL(`${GARMIN_SSO_MOBILE_BASE}/login`);
  url.searchParams.set("clientId", GARMIN_IOS_SSO_CLIENT_ID);
  url.searchParams.set("locale", "en-US");
  url.searchParams.set("service", GARMIN_IOS_SERVICE_URL);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "User-Agent": GARMIN_IOS_LOGIN_UA,
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://sso.garmin.com",
    },
    body: JSON.stringify({
      username: email,
      password,
      rememberMe: true,
      captchaToken: "",
    }),
  });

  const text = await res.text();

  if (res.status === 429) {
    const retryAfterRaw = res.headers.get("retry-after");
    const retryAfterMs = retryAfterRaw ? parseFloat(retryAfterRaw) * 1000 : undefined;
    throw new SyncError(
      429,
      "GARMIN_RATE_LIMITED",
      "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
      { endpoint: "mobile_sso_login", status: res.status, retryAfter: retryAfterRaw },
      retryAfterMs
    );
  }

  if (!res.ok) {
    throw new SyncError(409, "GARMIN_LOGIN_FAILED", "Garmin recusou o login. Verifique credenciais.", {
      status: res.status,
      body: text.slice(0, 300),
    });
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SyncError(424, "GARMIN_LOGIN_INVALID_RESPONSE", "Garmin retornou resposta inesperada no login.", {
      body: text.slice(0, 300),
    });
  }

  if (data.responseStatus?.type === "MFA_REQUIRED") {
    throw new SyncError(
      409,
      "GARMIN_MFA_REQUIRED",
      "Garmin requer autenticacao MFA (2FA). Desative o MFA na sua conta Garmin para usar a sincronizacao automatica.",
      { mfaMethod: data.customerMfaInfo?.mfaLastMethodUsed ?? "unknown" }
    );
  }

  if (data.responseStatus?.type !== "SUCCESSFUL" || !data.serviceTicketId) {
    throw new SyncError(409, "GARMIN_LOGIN_REJECTED", "Garmin rejeitou as credenciais.", {
      responseStatus: data.responseStatus,
      hasTicket: Boolean(data.serviceTicketId),
    });
  }

  return String(data.serviceTicketId);
}

async function garminExchangeServiceTicket(ticket: string): Promise<GarminBearerToken> {
  const errors: Record<string, unknown>[] = [];

  for (const clientId of GARMIN_DI_CLIENT_IDS) {
    const authHeader = `Basic ${btoa(clientId + ":")}`;

    const res = await fetch(GARMIN_DI_AUTH_URL, {
      method: "POST",
      headers: {
        "User-Agent": GARMIN_NATIVE_UA,
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "X-Garmin-Client-Platform": "Android",
      },
      body: new URLSearchParams({
        grant_type: GARMIN_DI_GRANT_TYPE_TICKET,
        client_id: clientId,
        service_ticket: ticket,
        service_url: GARMIN_IOS_SERVICE_URL,
      }),
    });

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterMs = retryAfterRaw ? parseFloat(retryAfterRaw) * 1000 : undefined;
      throw new SyncError(
        429,
        "GARMIN_RATE_LIMITED",
        "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
        { endpoint: "di_token_exchange", status: res.status, retryAfter: retryAfterRaw, clientId },
        retryAfterMs
      );
    }

    const text = await res.text();

    if (!res.ok) {
      errors.push({ clientId, status: res.status, body: text.slice(0, 200) });
      continue;
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      errors.push({ clientId, status: res.status, reason: "invalid_json", body: text.slice(0, 200) });
      continue;
    }

    if (!data.access_token) {
      errors.push({ clientId, status: res.status, reason: "no_access_token", keys: Object.keys(data ?? {}) });
      continue;
    }

    const expiresIn = Number(data.expires_in ?? 3600);
    return {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      clientId,
    };
  }

  throw new SyncError(
    424,
    "GARMIN_TOKEN_EXCHANGE_FAILED",
    "Garmin recusou a troca do ticket de servico por token de acesso.",
    { attempts: errors }
  );
}

async function garminRefreshBearerToken(refreshToken: string, clientId: string): Promise<GarminBearerToken> {
  const authHeader = `Basic ${btoa(clientId + ":")}`;

  const res = await fetch(GARMIN_DI_AUTH_URL, {
    method: "POST",
    headers: {
      "User-Agent": GARMIN_NATIVE_UA,
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "X-Garmin-Client-Platform": "Android",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new SyncError(424, "GARMIN_TOKEN_REFRESH_FAILED", "Garmin recusou o refresh do token de acesso.", {
      status: res.status,
      clientId,
      body: text.slice(0, 200),
    });
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SyncError(424, "GARMIN_TOKEN_REFRESH_INVALID", "Garmin retornou resposta invalida no refresh.", {
      body: text.slice(0, 200),
    });
  }

  if (!data.access_token) {
    throw new SyncError(424, "GARMIN_TOKEN_REFRESH_NO_TOKEN", "Garmin nao retornou token no refresh.", {
      keys: Object.keys(data ?? {}),
    });
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    clientId,
  };
}

// ── Garmin API requests ────────────────────────────────────────────────────────
function garminApiHeaders(
  session: GarminSession,
  auth: GarminEndpointAuth,
  referer?: string
): Record<string, string> | null {
  const baseHeaders = {
    "User-Agent": GARMIN_MOBILE_USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "NK": "NT",
    "X-app-ver": "4.40.0.0",
    "X-Requested-With": "XMLHttpRequest",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  if (auth === "bearer") {
    if (!session.bearerToken) return null;
    return {
      ...baseHeaders,
      Authorization: `Bearer ${session.bearerToken}`,
    };
  }

  if (!session.cookies) return null;
  return {
    ...baseHeaders,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    Cookie: session.cookies,
    Origin: "https://connect.garmin.com",
    Referer: referer ?? "https://connect.garmin.com/modern/",
    "DI-Backend": "connectapi.garmin.com",
  };
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
    const res = await fetch(url, { headers });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfterRaw = res.headers.get("retry-after");
        const retryAfterMs = retryAfterRaw ? parseFloat(retryAfterRaw) * 1000 : undefined;
        throw new SyncError(
          429,
          "GARMIN_RATE_LIMITED",
          "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
          { endpoint: endpoint.url, auth: endpoint.auth, retryAfter: retryAfterRaw, body: text.slice(0, 300) },
          retryAfterMs
        );
      }
      failures.push({ url: endpoint.url, auth: endpoint.auth, status: res.status, body: text.slice(0, 300) });
      continue;
    }

    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;
      failures.push({ url: endpoint.url, auth: endpoint.auth, status: res.status, body: text.slice(0, 300), reason: "not_array" });
    } catch {
      failures.push({ url: endpoint.url, auth: endpoint.auth, status: res.status, body: text.slice(0, 300), reason: "invalid_json" });
    }
  }

  throw new SyncError(424, "GARMIN_ACTIVITIES_FAILED", "Garmin recusou a busca de atividades.", {
    attempts: failures,
  });
}

async function fetchGarminLaps(session: GarminSession, activityIdValue: string) {
  const urls = [
    { url: `${GARMIN_CONNECT_API_URL}/activity-service/activity/${activityIdValue}/laps`, auth: "bearer" as GarminEndpointAuth },
    { url: `${GARMIN_CONNECT_API_URL}/activity-service/activity/${activityIdValue}/splits`, auth: "bearer" as GarminEndpointAuth },
    { url: `https://connect.garmin.com/activity-service/activity/${activityIdValue}/laps`, auth: "cookies" as GarminEndpointAuth },
    { url: `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/laps`, auth: "cookies" as GarminEndpointAuth },
    { url: `https://connect.garmin.com/modern/proxy/activity-service/activity/${activityIdValue}/splits`, auth: "cookies" as GarminEndpointAuth },
  ];
  let authFailureStatus: number | null = null;

  for (const endpoint of urls) {
    const headers = garminApiHeaders(session, endpoint.auth, "https://connect.garmin.com/modern/activities");
    if (!headers) continue;

    const res = await fetch(endpoint.url, { headers });
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfterRaw = res.headers.get("retry-after");
        const retryAfterMs = retryAfterRaw ? parseFloat(retryAfterRaw) * 1000 : undefined;
        throw new SyncError(
          429,
          "GARMIN_RATE_LIMITED",
          "Garmin limitou novas tentativas de sincronizacao. Aguarde alguns minutos antes de tentar novamente.",
          { endpoint: endpoint.url, auth: endpoint.auth, retryAfter: retryAfterRaw },
          retryAfterMs
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

// ── Cookie helpers (kept for legacy cached sessions that still have cookies) ──
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

function errorDetailsForLog(error: unknown): Record<string, unknown> {
  if (error instanceof SyncError) {
    return { code: error.code, status: error.status, message: error.message, details: error.details };
  }
  return { code: "INTERNAL_ERROR", status: 500, message: error instanceof Error ? error.message : String(error) };
}
