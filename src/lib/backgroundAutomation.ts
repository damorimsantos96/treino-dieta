import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { UserAppSettings } from "@/types";
import { DEFAULT_USER_APP_SETTINGS, HEALTH_CONNECT_BACKGROUND_INTERVAL_MIN, WATER_REMINDER_MIN_INTERVAL } from "@/constants/appDefaults";
import { getUserAppSettings, upsertUserAppSettings } from "@/lib/api";
import { syncHealthConnectWeights } from "@/lib/healthConnect";

export const APP_BACKGROUND_TASK_NAME = "app-background-automation";

type AutomationSettings = Pick<
  UserAppSettings,
  | "water_start_time"
  | "water_end_time"
  | "water_reminders_enabled"
  | "water_reminder_interval_min"
  | "health_connect_enabled"
  | "health_connect_background_enabled"
>;

function resolveMinimumInterval(settings: AutomationSettings) {
  const intervals: number[] = [];

  if (settings.water_reminders_enabled) {
    intervals.push(Math.max(WATER_REMINDER_MIN_INTERVAL, settings.water_reminder_interval_min));
  }

  if (settings.health_connect_enabled && settings.health_connect_background_enabled) {
    intervals.push(HEALTH_CONNECT_BACKGROUND_INTERVAL_MIN);
  }

  if (intervals.length === 0) return null;
  return Math.max(WATER_REMINDER_MIN_INTERVAL, Math.min(...intervals));
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

export async function runBackgroundAutomations() {
  const remoteSettings = await getUserAppSettings();
  const settings: AutomationSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(remoteSettings ?? {}),
  };

  await runHealthConnectAutomation(settings);
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
