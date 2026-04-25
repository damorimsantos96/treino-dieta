import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { format } from "date-fns";
import { UserAppSettings } from "@/types";
import { DEFAULT_USER_APP_SETTINGS, HEALTH_CONNECT_BACKGROUND_INTERVAL_MIN, WATER_REMINDER_MIN_INTERVAL } from "@/constants/appDefaults";
import { getDailyLog, getLatestWeightLog, getProfile, getUserAppSettings, upsertUserAppSettings } from "@/lib/api";
import { syncHealthConnectWeights } from "@/lib/healthConnect";
import { notificationsAreEnabled, sendWaterReminderNotification, scheduleSmartWaterNotifications } from "@/lib/notifications";
import { readJsonItem, writeJsonItem } from "@/lib/deviceStorage";
import { computeDailyCalculations, formatWater, hydrationProgressStatus, parseClockToMinutes } from "@/utils/calculations";
import { buildDailyLog } from "@/utils/dailyLog";

export const APP_BACKGROUND_TASK_NAME = "app-background-automation";

const BACKGROUND_AUTOMATION_STATE_KEY = "background_automation_state";

type BackgroundAutomationState = {
  lastWaterReminderAt: string | null;
};

type AutomationSettings = Pick<
  UserAppSettings,
  | "water_start_time"
  | "water_end_time"
  | "water_reminders_enabled"
  | "water_reminder_interval_min"
  | "health_connect_enabled"
  | "health_connect_background_enabled"
>;

async function readAutomationState() {
  return readJsonItem<BackgroundAutomationState>(BACKGROUND_AUTOMATION_STATE_KEY, {
    lastWaterReminderAt: null,
  });
}

async function writeAutomationState(state: BackgroundAutomationState) {
  await writeJsonItem(BACKGROUND_AUTOMATION_STATE_KEY, state);
}

function resolveMinimumInterval(settings: AutomationSettings) {
  const intervals: number[] = [];

  if (settings.water_reminders_enabled) {
    // Keep background checks frequent so Android has more chances to run the
    // task near the configured reminder cadence. The user-selected interval is
    // still enforced by lastWaterReminderAt before any notification is sent.
    intervals.push(WATER_REMINDER_MIN_INTERVAL);
  }

  if (settings.health_connect_enabled && settings.health_connect_background_enabled) {
    intervals.push(HEALTH_CONNECT_BACKGROUND_INTERVAL_MIN);
  }

  if (intervals.length === 0) return null;
  return Math.max(WATER_REMINDER_MIN_INTERVAL, Math.min(...intervals));
}

export async function fetchWaterStatus(): Promise<{ consumedMl: number; targetMl: number } | null> {
  const now = new Date();
  const [todayLog, latestWeightLog, profile] = await Promise.all([
    getDailyLog(now),
    getLatestWeightLog(),
    getProfile(),
  ]);

  const dateStr = format(now, "yyyy-MM-dd");
  const log = buildDailyLog(dateStr, {
    ...(todayLog ?? {}),
    weight_kg: todayLog?.weight_kg ?? latestWeightLog?.weight_kg ?? null,
  });

  if (!log.weight_kg) return null;

  const userMetrics = {
    heightCm: profile?.height_cm ?? 172,
    birthDate: profile?.birth_date ? new Date(profile.birth_date) : new Date("1996-07-01"),
  };

  const targetMl = computeDailyCalculations(log, now, userMetrics).water_ml;
  if (targetMl <= 0) return null;

  return { consumedMl: log.water_consumed_ml ?? 0, targetMl };
}

async function runHealthConnectAutomation(settings: AutomationSettings) {
  if (!settings.health_connect_enabled || !settings.health_connect_background_enabled) {
    return;
  }

  try {
    await syncHealthConnectWeights();
    await upsertUserAppSettings({
      health_connect_last_sync_at: new Date().toISOString(),
      health_connect_last_error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar Health Connect.";
    await upsertUserAppSettings({
      health_connect_last_error: message,
    });
  }
}

async function runWaterReminderAutomation(settings: AutomationSettings) {
  if (!settings.water_reminders_enabled) return;
  if (!(await notificationsAreEnabled())) return;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseClockToMinutes(settings.water_start_time);
  const endMinutes = parseClockToMinutes(settings.water_end_time);

  if (nowMinutes < startMinutes || nowMinutes > endMinutes) return;

  const state = await readAutomationState();

  if (state.lastWaterReminderAt) {
    const elapsedMs = now.getTime() - new Date(state.lastWaterReminderAt).getTime();
    const minimumElapsedMs =
      Math.max(WATER_REMINDER_MIN_INTERVAL, settings.water_reminder_interval_min) * 60 * 1000;
    if (elapsedMs < minimumElapsedMs) return;
  }

  const waterStatus = await fetchWaterStatus();
  if (!waterStatus) return;

  const { consumedMl, targetMl } = waterStatus;
  const progress = hydrationProgressStatus(
    targetMl,
    consumedMl,
    now,
    settings.water_start_time,
    settings.water_end_time
  );

  if (!progress.isBehind || progress.expectedMl <= 0) return;

  const deficitMl = Math.max(0, Math.round(progress.expectedMl - consumedMl));
  await sendWaterReminderNotification(
    `Voce esta ${formatWater(deficitMl)} abaixo do ritmo ideal de hidratacao de hoje.`
  );

  await writeAutomationState({ lastWaterReminderAt: now.toISOString() });

  // Reschedule OS-level notifications with fresh data after WorkManager fires
  await scheduleSmartWaterNotifications({ settings, consumedMl, targetMl }).catch(() => {});
}

export async function runBackgroundAutomations() {
  const remoteSettings = await getUserAppSettings();
  const settings: AutomationSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(remoteSettings ?? {}),
  };

  await runHealthConnectAutomation(settings);
  await runWaterReminderAutomation(settings);
}

if (!TaskManager.isTaskDefined(APP_BACKGROUND_TASK_NAME)) {
  TaskManager.defineTask(APP_BACKGROUND_TASK_NAME, async () => {
    try {
      await runBackgroundAutomations();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function syncBackgroundAutomationRegistration(settings: AutomationSettings) {
  const minimumInterval = resolveMinimumInterval(settings);
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(APP_BACKGROUND_TASK_NAME);

  if (!minimumInterval) {
    if (alreadyRegistered) {
      await BackgroundTask.unregisterTaskAsync(APP_BACKGROUND_TASK_NAME);
    }
    return;
  }

  if (alreadyRegistered) {
    await BackgroundTask.unregisterTaskAsync(APP_BACKGROUND_TASK_NAME);
  }

  await BackgroundTask.registerTaskAsync(APP_BACKGROUND_TASK_NAME, {
    minimumInterval,
  });
}
