/**
 * Supabase Edge Function: sync-whoop
 * Fetches workout and recovery data from the Whoop API v1
 * and upserts into daily_logs.
 *
 * Env vars needed (Supabase → Settings → Edge Functions → Secrets):
 *   WHOOP_CLIENT_ID      — from developer.whoop.com
 *   WHOOP_CLIENT_SECRET  — from developer.whoop.com
 *
 * The access/refresh tokens per user are stored in integration_tokens table.
 *
 * Invocation: POST /functions/v1/sync-whoop
 * Auth: Bearer <user JWT>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v1";

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

  // Get stored tokens
  const { data: tokenRow } = await supabaseAdmin
    .from("integration_tokens")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "whoop")
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return new Response(
      JSON.stringify({ error: "Whoop not connected. Authorize first." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Refresh token if expired
  let accessToken = tokenRow.access_token;
  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt < new Date()) {
    const refreshed = await refreshWhoopToken(tokenRow.refresh_token);
    if (!refreshed) {
      return new Response(
        JSON.stringify({ error: "Token expired. Re-authorize Whoop." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    accessToken = refreshed.access_token;
    await supabaseAdmin.from("integration_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq("user_id", user.id).eq("provider", "whoop");
  }

  // Fetch last 30 days of Whoop data
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const startStr = start.toISOString();
  const endStr = new Date().toISOString();

  const [workouts, recovery] = await Promise.all([
    whoopGet(accessToken, `/workout?start=${startStr}&end=${endStr}`),
    whoopGet(accessToken, `/recovery?start=${startStr}&end=${endStr}`),
  ]);

  const updates: Record<string, any> = {};

  // Process workouts → sum strain + calories per day
  for (const w of workouts.records ?? []) {
    const date = w.start.slice(0, 10);
    if (!updates[date]) updates[date] = { date, user_id: user.id };
    updates[date].whoop_strain = Math.max(
      updates[date].whoop_strain ?? 0,
      w.score?.strain ?? 0
    );
    updates[date].whoop_kcal =
      (updates[date].whoop_kcal ?? 0) + (w.score?.kilojoule ? w.score.kilojoule / 4.184 : 0);
  }

  // Process recovery
  for (const r of recovery.records ?? []) {
    const date = r.created_at.slice(0, 10);
    if (!updates[date]) updates[date] = { date, user_id: user.id };
    updates[date].whoop_recovery = r.score?.recovery_score ?? null;
  }

  const rows = Object.values(updates);
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("daily_logs")
      .upsert(rows, { onConflict: "user_id,date", ignoreDuplicates: false });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({ synced: rows.length, message: `Whoop sync: ${rows.length} dias atualizados.` }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});

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
