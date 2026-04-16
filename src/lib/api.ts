import { supabase } from "./supabase";
import { DailyLog, RunSession, PRMovement, PRAttempt, UserProfile } from "@/types";
import { format } from "date-fns";

// ─── User Profile ────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .single();
  if (error) return null;
  return data;
}

export async function upsertProfile(
  profile: Partial<UserProfile>
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(profile)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Daily Logs ──────────────────────────────────────────────────────────────

export async function getDailyLog(date: Date): Promise<DailyLog | null> {
  const dateStr = format(date, "yyyy-MM-dd");
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("date", dateStr)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDailyLogs(
  from: Date,
  to: Date
): Promise<DailyLog[]> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .gte("date", format(from, "yyyy-MM-dd"))
    .lte("date", format(to, "yyyy-MM-dd"))
    .order("date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertDailyLog(
  log: Partial<DailyLog> & { date: string }
): Promise<DailyLog> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("daily_logs")
    .upsert({ ...log, user_id: user!.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Running Sessions ────────────────────────────────────────────────────────

export async function getRunSessions(
  from?: Date,
  to?: Date,
  limit = 50
): Promise<RunSession[]> {
  let query = supabase
    .from("run_sessions")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

  if (from) query = query.gte("date", format(from, "yyyy-MM-dd"));
  if (to) query = query.lte("date", format(to, "yyyy-MM-dd"));

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function upsertRunSession(
  session: Partial<RunSession> & { date: string; interval_type: string }
): Promise<RunSession> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("run_sessions")
    .upsert({ ...session, user_id: user!.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRunSession(id: string): Promise<void> {
  const { error } = await supabase.from("run_sessions").delete().eq("id", id);
  if (error) throw error;
}

// ─── PR Movements ─────────────────────────────────────────────────────────────

export async function getPRMovements(): Promise<PRMovement[]> {
  const { data, error } = await supabase
    .from("pr_movements")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createPRMovement(
  movement: Omit<PRMovement, "id" | "user_id" | "created_at">
): Promise<PRMovement> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("pr_movements")
    .insert({ ...movement, user_id: user!.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── PR Attempts ──────────────────────────────────────────────────────────────

export async function getPRAttempts(movementId?: string): Promise<PRAttempt[]> {
  let query = supabase
    .from("pr_attempts")
    .select("*, movement:pr_movements(*)")
    .order("date", { ascending: false });

  if (movementId) query = query.eq("movement_id", movementId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createPRAttempt(
  attempt: Omit<PRAttempt, "id" | "user_id" | "created_at" | "is_pr" | "movement">
): Promise<PRAttempt> {
  const { data: { user } } = await supabase.auth.getUser();

  // Check if this is a new PR
  const { data: existing } = await supabase
    .from("pr_attempts")
    .select("value")
    .eq("movement_id", attempt.movement_id)
    .eq("is_pr", true)
    .maybeSingle();

  const movement = await supabase
    .from("pr_movements")
    .select("lower_is_better")
    .eq("id", attempt.movement_id)
    .single();

  const lowerIsBetter = movement.data?.lower_is_better ?? false;
  const isPR = !existing ||
    (lowerIsBetter ? attempt.value < existing.value : attempt.value > existing.value);

  if (isPR && existing) {
    // Demote previous PR
    await supabase
      .from("pr_attempts")
      .update({ is_pr: false })
      .eq("movement_id", attempt.movement_id)
      .eq("is_pr", true);
  }

  const { data, error } = await supabase
    .from("pr_attempts")
    .insert({ ...attempt, user_id: user!.id, is_pr: isPR })
    .select("*, movement:pr_movements(*)")
    .single();
  if (error) throw error;
  return data;
}
