import { supabase } from "./supabase";
import {
  AllOutTest,
  DailyLog,
  PRAttempt,
  PRMovement,
  RunActivity,
  RunPredictionModelState,
  RunSession,
  UserProfile,
  UserAppSettings,
  ValidationLogEntry,
  WaterPreset,
  WaterIntake,
} from "@/types";
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

export async function getUserAppSettings(): Promise<UserAppSettings | null> {
  const { data, error } = await supabase
    .from("user_app_settings")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertUserAppSettings(
  settings: Partial<UserAppSettings>
): Promise<UserAppSettings> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("user_app_settings")
    .upsert({ ...settings, user_id: userId }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

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

export async function getLatestWeightLog(): Promise<DailyLog | null> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .not("weight_kg", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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

export async function getWaterPresets(): Promise<WaterPreset[]> {
  const { data, error } = await supabase
    .from("water_presets")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveWaterPreset(
  preset: Partial<WaterPreset> & { label: string; amount_ml: number }
): Promise<WaterPreset> {
  const userId = await getUserId();

  if (preset.id) {
    const { data, error } = await supabase
      .from("water_presets")
      .update({
        label: preset.label,
        amount_ml: preset.amount_ml,
        sort_order: preset.sort_order ?? 0,
      })
      .eq("id", preset.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("water_presets")
    .insert({
      user_id: userId,
      label: preset.label,
      amount_ml: preset.amount_ml,
      sort_order: preset.sort_order ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWaterPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from("water_presets")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function getWaterIntakes(loggedDate: string): Promise<WaterIntake[]> {
  const { data, error } = await supabase
    .from("water_intakes")
    .select("*, preset:water_presets(*)")
    .eq("logged_date", loggedDate)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createWaterIntake(
  intake: Pick<WaterIntake, "logged_date" | "occurred_at" | "amount_ml"> &
    Partial<Pick<WaterIntake, "preset_id" | "source" | "notes">>
): Promise<WaterIntake> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("water_intakes")
    .insert({
      user_id: userId,
      logged_date: intake.logged_date,
      occurred_at: intake.occurred_at,
      amount_ml: intake.amount_ml,
      preset_id: intake.preset_id ?? null,
      source: intake.source ?? "manual",
      notes: intake.notes ?? null,
    })
    .select("*, preset:water_presets(*)")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWaterIntake(id: string): Promise<void> {
  const { error } = await supabase
    .from("water_intakes")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

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

export async function getAllOutTests(): Promise<AllOutTest[]> {
  const { data, error } = await supabase
    .from("all_out_tests")
    .select("*")
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createAllOutTest(
  test: Pick<AllOutTest, "date" | "kind" | "distance_km" | "duration_min"> &
    Partial<Pick<AllOutTest, "temp_c" | "notes">>
): Promise<AllOutTest> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("all_out_tests")
    .insert({
      user_id: userId,
      date: test.date,
      kind: test.kind,
      distance_km: test.distance_km,
      duration_min: test.duration_min,
      temp_c: test.temp_c ?? null,
      source_run_activity_id: null,
      is_auto_generated: false,
      auto_confidence: null,
      notes: test.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function syncAutoDetectedAllOutTests(
  tests: Array<
    Pick<
      AllOutTest,
      | "date"
      | "kind"
      | "distance_km"
      | "duration_min"
      | "temp_c"
      | "notes"
      | "source_run_activity_id"
      | "is_auto_generated"
      | "auto_confidence"
    >
  >
): Promise<void> {
  const userId = await getUserId();
  const sourceIds = tests
    .map((test) => test.source_run_activity_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  let deleteQuery = supabase
    .from("all_out_tests")
    .delete()
    .eq("user_id", userId)
    .eq("is_auto_generated", true);

  if (sourceIds.length > 0) {
    deleteQuery = deleteQuery.not("source_run_activity_id", "in", `(${sourceIds.map((id) => `"${id}"`).join(",")})`);
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  if (tests.length === 0) return;

  const { error: upsertError } = await supabase
    .from("all_out_tests")
    .upsert(
      tests.map((test) => ({
        user_id: userId,
        date: test.date,
        kind: test.kind,
        distance_km: test.distance_km,
        duration_min: test.duration_min,
        temp_c: test.temp_c ?? null,
        source_run_activity_id: test.source_run_activity_id ?? null,
        is_auto_generated: test.is_auto_generated,
        auto_confidence: test.auto_confidence ?? null,
        notes: test.notes ?? null,
      })),
      { onConflict: "user_id,source_run_activity_id" }
    );
  if (upsertError) throw upsertError;
}

export async function getRunPredictionModelState(): Promise<RunPredictionModelState | null> {
  const { data, error } = await supabase
    .from("run_prediction_model_state")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertRunPredictionModelState(
  state: Partial<RunPredictionModelState>
): Promise<RunPredictionModelState> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("run_prediction_model_state")
    .upsert({ ...state, user_id: userId }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function replaceValidationLog(
  entries: Array<
    Omit<ValidationLogEntry, "id" | "user_id" | "created_at"> & {
      test_id?: string | null;
      kind?: string | null;
      duration_pred_min?: number | null;
      temp_c?: number | null;
      indicator_source?: string | null;
      indicator_value?: number | null;
      ratio_used?: number | null;
      riegel_exp_used?: number | null;
      error_pct?: number | null;
    }
  >
): Promise<void> {
  const userId = await getUserId();
  const { error: deleteError } = await supabase
    .from("validation_log")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (entries.length === 0) return;

  const { error: insertError } = await supabase.from("validation_log").insert(
    entries.map((entry) => ({
      user_id: userId,
      test_id: entry.test_id ?? null,
      date: entry.date,
      kind: entry.kind ?? null,
      distance_km: entry.distance_km,
      duration_obs_min: entry.duration_obs_min,
      duration_pred_min: entry.duration_pred_min ?? null,
      temp_c: entry.temp_c ?? null,
      indicator_source: entry.indicator_source ?? null,
      indicator_value: entry.indicator_value ?? null,
      ratio_used: entry.ratio_used ?? null,
      riegel_exp_used: entry.riegel_exp_used ?? null,
      error_pct: entry.error_pct ?? null,
    }))
  );
  if (insertError) throw insertError;
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
