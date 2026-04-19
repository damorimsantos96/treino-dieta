/**
 * Supabase Edge Function: whoop-oauth
 *
 * POST body:
 *   { "mode": "start" }
 *
 * GET callback:
 *   /functions/v1/whoop-oauth?code=...&state=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_SCOPE = "read:workout offline";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function html(title: string, message: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { background: #08090f; color: #f4f4f5; font-family: system-ui, sans-serif; padding: 32px; }
      main { max-width: 520px; margin: 0 auto; }
      h1 { font-size: 28px; margin-bottom: 12px; }
      p { color: #a1a1aa; line-height: 1.55; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`, {
    status,
    headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
}

class OAuthError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new OAuthError(500, "MISSING_SECRET", `Secret ${name} ausente no Supabase.`, { name });
  return value;
}

function redirectUri(): string {
  return Deno.env.get("WHOOP_REDIRECT_URI")?.trim() ||
    `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/whoop-oauth`;
}

function supabaseAdmin() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return handleCallback(req);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const body = await safeJson(req);
    if (body.mode !== "start") {
      return json({ error: "Modo invalido.", code: "INVALID_MODE" }, 400);
    }

    const state = randomState();
    const admin = supabaseAdmin();
    const { data: existing, error: existingError } = await admin
      .from("integration_tokens")
      .select("access_token, refresh_token, expires_at, metadata")
      .eq("user_id", user.id)
      .eq("provider", "whoop")
      .maybeSingle();
    if (existingError) throw dbError("whoop_oauth_existing_select", existingError);

    const metadata = {
      ...(existing?.metadata ?? {}),
      oauth_state: state,
      oauth_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      oauth_redirect_uri: redirectUri(),
    };

    const { error: upsertError } = await admin
      .from("integration_tokens")
      .upsert({
        user_id: user.id,
        provider: "whoop",
        access_token: existing?.access_token ?? null,
        refresh_token: existing?.refresh_token ?? null,
        expires_at: existing?.expires_at ?? null,
        metadata,
      }, { onConflict: "user_id,provider" });
    if (upsertError) throw dbError("whoop_oauth_state_upsert", upsertError);

    const url = new URL(WHOOP_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", requireEnv("WHOOP_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", WHOOP_SCOPE);
    url.searchParams.set("state", state);

    return json({
      authUrl: url.toString(),
      redirectUri: redirectUri(),
      expiresAt: metadata.oauth_expires_at,
    });
  } catch (error) {
    return failJson(error);
  }
});

async function handleCallback(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const denied = url.searchParams.get("error");

    if (denied) {
      return html("Whoop nao conectado", "A autorizacao foi cancelada ou recusada no Whoop.", 400);
    }
    if (!code || !state) {
      return html("Whoop nao conectado", "A resposta do Whoop veio sem codigo ou state.", 400);
    }

    const admin = supabaseAdmin();
    const { data: rows, error: stateError } = await admin
      .from("integration_tokens")
      .select("user_id, metadata")
      .eq("provider", "whoop")
      .filter("metadata->>oauth_state", "eq", state)
      .limit(1);
    if (stateError) throw dbError("whoop_oauth_state_select", stateError);

    const row = rows?.[0];
    if (!row?.user_id) {
      throw new OAuthError(400, "WHOOP_STATE_NOT_FOUND", "State OAuth nao encontrado. Inicie a conexao novamente.");
    }
    const expiresAt = row.metadata?.oauth_expires_at ? new Date(row.metadata.oauth_expires_at).getTime() : 0;
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      throw new OAuthError(400, "WHOOP_STATE_EXPIRED", "State OAuth expirado. Inicie a conexao novamente.");
    }

    const token = await exchangeCode(code);
    const metadata = {
      ...(row.metadata ?? {}),
      oauth_state: null,
      oauth_expires_at: null,
      whoop_scope: token.scope ?? WHOOP_SCOPE,
      connected_at: new Date().toISOString(),
    };

    const { error: updateError } = await admin
      .from("integration_tokens")
      .upsert({
        user_id: row.user_id,
        provider: "whoop",
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        expires_at: new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000).toISOString(),
        metadata,
      }, { onConflict: "user_id,provider" });
    if (updateError) throw dbError("whoop_oauth_token_upsert", updateError);

    return html(
      "Whoop conectado",
      "Autorizacao concluida. Volte para o app e toque em Verificar no Whoop."
    );
  } catch (error) {
    console.error("whoop oauth callback failed", JSON.stringify(errorDetails(error)));
    const message = error instanceof Error ? error.message : "Erro desconhecido ao conectar Whoop.";
    return html("Whoop nao conectado", message, error instanceof OAuthError ? error.status : 500);
  }
}

async function exchangeCode(code: string): Promise<any> {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: requireEnv("WHOOP_CLIENT_ID"),
      client_secret: requireEnv("WHOOP_CLIENT_SECRET"),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new OAuthError(424, "WHOOP_TOKEN_EXCHANGE_FAILED", "Whoop recusou a troca do codigo OAuth.", {
      status: res.status,
      body: text.slice(0, 500),
    });
  }

  try {
    const token = JSON.parse(text);
    if (!token.access_token) {
      throw new OAuthError(424, "WHOOP_TOKEN_INVALID_RESPONSE", "Whoop retornou token em formato inesperado.");
    }
    return token;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError(424, "WHOOP_TOKEN_INVALID_RESPONSE", "Whoop retornou token em formato inesperado.", {
      body: text.slice(0, 500),
    });
  }
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function dbError(stage: string, error: unknown): OAuthError {
  return new OAuthError(500, "DATABASE_ERROR", "Erro ao acessar dados da integracao.", {
    stage,
    message: error instanceof Error ? error.message : String(error),
  });
}

function failJson(error: unknown) {
  const details = errorDetails(error);
  console.error("whoop oauth failed", JSON.stringify(details));
  return json({
    error: details.message,
    code: details.code,
  }, details.status);
}

function errorDetails(error: unknown) {
  if (error instanceof OAuthError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Erro desconhecido",
    details: {},
  };
}

function randomState() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
