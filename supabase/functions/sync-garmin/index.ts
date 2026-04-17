/**
 * Supabase Edge Function: sync-garmin
 * Uses the unofficial Garmin Connect web API to fetch recent activities
 * (specifically running sessions) and upsert into run_sessions.
 *
 * Env vars needed (Supabase → Settings → Edge Functions → Secrets):
 *   GARMIN_EMAIL     — your Garmin Connect email
 *   GARMIN_PASSWORD  — your Garmin Connect password
 *
 * NOTE: This uses the unofficial Garmin Connect API (session-based).
 * It can break if Garmin changes their auth flow (~1-2x per year).
 * The fallback is manual entry via the app's Corridas screen.
 *
 * Invocation: POST /functions/v1/sync-garmin
 * Auth: Bearer <user JWT>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GARMIN_SSO_URL = "https://sso.garmin.com/sso";
const GARMIN_CONNECT_API = "https://connect.garmin.com/activitylist-service/activities/search/activities";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

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
  if (userError || !user) return new Response("Unauthorized", { status: 401 });

  try {
    const session = await garminLogin(
      Deno.env.get("GARMIN_EMAIL")!,
      Deno.env.get("GARMIN_PASSWORD")!
    );

    const activities = await fetchGarminActivities(session, 50);
    const runActivities = activities.filter(
      (a: any) => a.activityType?.typeKey === "running"
    );

    const rows = runActivities.map((a: any) => {
      const date = (a.startTimeLocal ?? a.startTimeGMT ?? "").slice(0, 10);
      const distM = a.distance ?? 0;
      const distKm = distM / 1000;
      const durationSec = a.duration ?? 0;
      const durationMin = durationSec / 60;
      const paceMinKm = distKm > 0 ? durationMin / distKm : null;
      return {
        user_id: user.id,
        date,
        interval_type: classifyGarminActivity(a),
        distance_km: distKm,
        duration_min: durationMin,
        pace_min_km: paceMinKm,
        avg_hr: a.averageHR ?? null,
        max_hr: a.maxHR ?? null,
        calories_kcal: a.calories ?? null,
        garmin_activity_id: String(a.activityId),
      };
    }).filter((r: any) => r.date && r.distance_km > 0);

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("run_sessions")
        .upsert(rows, { onConflict: "user_id,garmin_activity_id" });
      if (error) throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({ synced: rows.length, message: `Garmin sync: ${rows.length} corridas importadas.` }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message, fallback: true }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function classifyGarminActivity(a: any): string {
  const name = (a.activityName ?? "").toLowerCase();
  const avgHr = a.averageHR ?? 0;
  if (name.includes("long") || name.includes("longo")) return "Long Run";
  if (name.includes("interval") || name.includes("intervalo") || name.includes("vo2")) return "Intervals";
  if (name.includes("tempo") || name.includes("threshold") || name.includes("limiar")) return "Threshold";
  if (name.includes("race") || name.includes("corrida") || name.includes("prova")) return "Race";
  if (avgHr > 170) return "Intervals";
  if (avgHr > 155) return "Threshold";
  return "Easy";
}

async function garminLogin(email: string, password: string): Promise<string> {
  // Step 1: Get CSRF token from SSO
  const loginPageRes = await fetch(
    `${GARMIN_SSO_URL}/signin?service=https://connect.garmin.com/modern/`,
    { redirect: "follow" }
  );
  const loginPageText = await loginPageRes.text();
  const csrfMatch = loginPageText.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrf = csrfMatch?.[1] ?? "";
  const cookies = loginPageRes.headers.get("set-cookie") ?? "";

  // Step 2: POST credentials
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

  // Step 3: Follow redirect to get Garmin Connect session
  const connectRes = await fetch("https://connect.garmin.com/modern/", {
    headers: { Cookie: allCookies },
    redirect: "manual",
  });

  const sessionCookies = [allCookies, connectRes.headers.get("set-cookie") ?? ""].join("; ");
  return sessionCookies;
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
