import { supabase } from "./supabase";
import { DailyLog, RunActivity, RunSession, PRMovement, PRAttempt, UserProfile } from "@/types";
import { format } from "date-fns";

async function getUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("Não autenticado");
  return session.user.id;
}

// ─── User Profile ────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertProfile(
  profile: Partial<UserProfile>
): Promise<UserProfile> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert({ ...profile, user_id: userId }, { onConflict: "user_id" })
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
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("daily_logs")
    .upsert({ ...log, user_id: userId }, { onConflict: "user_id,date" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Running Activities ──────────────────────────────────────────────────────

export async function getRunActivities(
  from?: Date,
  to?: Date,
  limit = 200
): Promise<RunActivity[]> {
  let query = supabase
    .from("run_activities")
    .select("*, intervals:run_sessions(*)")
    .order("date", { ascending: false })
    .limit(limit);

  if (from) query = query.gte("date", format(from, "yyyy-MM-dd"));
  if (to) query = query.lte("date", format(to, "yyyy-MM-dd"));

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as RunActivity[]).map((activity) => ({
    ...activity,
    intervals: [...(activity.intervals ?? [])].sort(
      (a, b) => (a.interval_index ?? 0) - (b.interval_index ?? 0)
    ),
  }));
}

export async function createRunActivityWithIntervals(
  activity: Partial<RunActivity> & { date: string },
  intervals: Array<Partial<RunSession> & { interval_type: string }>
): Promise<RunActivity> {
  const userId = await getUserId();
  const source = activity.source ?? "manual";
  const activityPayload = {
    ...activity,
    user_id: userId,
    source,
  };

  const activityQuery = activity.external_id
    ? supabase
        .from("run_activities")
        .upsert(activityPayload, { onConflict: "user_id,source,external_id" })
    : supabase.from("run_activities").insert(activityPayload);

  const { data: savedActivity, error: activityError } = await activityQuery
    .select()
    .single();
  if (activityError) throw activityError;

  if (intervals.length > 0) {
    const rows = intervals.map((interval, index) => ({
      ...interval,
      user_id: userId,
      run_activity_id: savedActivity.id,
      date: activity.date,
      source,
      interval_index: interval.interval_index ?? index + 1,
    }));

    const { error: intervalError } = await supabase
      .from("run_sessions")
      .insert(rows);
    if (intervalError) throw intervalError;
  }

  return { ...(savedActivity as RunActivity), intervals: intervals as RunSession[] };
}

export async function deleteRunActivity(id: string): Promise<void> {
  const { error } = await supabase.from("run_activities").delete().eq("id", id);
  if (error) throw error;
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
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("run_sessions")
    .upsert({ ...session, user_id: userId })
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
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("pr_movements")
    .insert({ ...movement, user_id: userId })
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
  const userId = await getUserId();

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
    await supabase
      .from("pr_attempts")
      .update({ is_pr: false })
      .eq("movement_id", attempt.movement_id)
      .eq("is_pr", true);
  }

  const { data, error } = await supabase
    .from("pr_attempts")
    .insert({ ...attempt, user_id: userId, is_pr: isPR })
    .select("*, movement:pr_movements(*)")
    .single();
  if (error) throw error;
  return data;
}

export async function recalculatePRs(): Promise<void> {
  const { data: allAttempts } = await supabase
    .from("pr_attempts")
    .select("id, movement_id, value, movement:pr_movements(lower_is_better)")
    .order("date", { ascending: true });

  if (!allAttempts || allAttempts.length === 0) return;

  const bestByMovement = new Map<string, { id: string; value: number }>();

  for (const attempt of allAttempts) {
    const lowerIsBetter = (attempt.movement as any)?.lower_is_better ?? false;
    const existing = bestByMovement.get(attempt.movement_id);

    if (!existing) {
      bestByMovement.set(attempt.movement_id, { id: attempt.id, value: attempt.value });
    } else {
      const isBetter = lowerIsBetter
        ? attempt.value < existing.value
        : attempt.value > existing.value;
      if (isBetter) {
        bestByMovement.set(attempt.movement_id, { id: attempt.id, value: attempt.value });
      }
    }
  }

  const prIds = Array.from(bestByMovement.values()).map((v) => v.id);

  const { error: clearErr } = await supabase
    .from("pr_attempts")
    .update({ is_pr: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (clearErr) throw clearErr;

  if (prIds.length > 0) {
    const { error: setErr } = await supabase
      .from("pr_attempts")
      .update({ is_pr: true })
      .in("id", prIds);
    if (setErr) throw setErr;
  }
}

export async function syncRunSessionsToDaily(date: string): Promise<void> {
  const userId = await getUserId();
  const { data: activities, error } = await supabase
    .from("run_activities")
    .select("duration_min, calories_kcal")
    .eq("date", date)
    .eq("user_id", userId);
  if (error) throw error;

  const min_corrida = activities && activities.length > 0
    ? activities.reduce((s, r) => s + (r.duration_min ?? 0), 0) || null
    : null;
  const kcal_corrida = activities && activities.length > 0
    ? activities.reduce((s, r) => s + (r.calories_kcal ?? 0), 0) || null
    : null;

  const payload: Partial<DailyLog> & { date: string; user_id: string } = {
    date,
    user_id: userId,
    min_corrida,
  };
  if (kcal_corrida != null) payload.kcal_corrida = kcal_corrida;

  const { error: upsertErr } = await supabase
    .from("daily_logs")
    .upsert(payload, { onConflict: "user_id,date" });
  if (upsertErr) throw upsertErr;
}
