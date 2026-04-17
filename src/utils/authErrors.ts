import { supabaseHost } from "@/lib/supabase";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

function isNetworkError(message: string): boolean {
  return [
    /failed to fetch/i,
    /network request failed/i,
    /load failed/i,
    /fetch failed/i,
    /err_name_not_resolved/i,
    /err_connection/i,
  ].some((pattern) => pattern.test(message));
}

export function getLoginErrorMessage(err: unknown): string {
  const message = getErrorMessage(err);

  if (/invalid login credentials/i.test(message)) {
    return "Email ou senha inválidos.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Confirme seu email antes de entrar.";
  }

  if (isNetworkError(message)) {
    return `Não consegui alcançar o Supabase (${supabaseHost}). Isso normalmente indica URL/ref do projeto incorreta no Vercel/Supabase ou bloqueio de DNS/rede. Confirme a variável EXPO_PUBLIC_SUPABASE_URL no deploy e tente novamente.`;
  }

  return message || "Não foi possível entrar. Tente novamente.";
}

export function getLoginErrorDetails(err: unknown): string {
  const message = getErrorMessage(err);
  return message ? `Detalhe técnico: ${message}` : "";
}
