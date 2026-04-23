import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_USER_APP_SETTINGS } from "@/constants/appDefaults";
import { syncBackgroundAutomationRegistration } from "@/lib/backgroundAutomation";
import { scheduleWaterReminderNotifications } from "@/lib/notifications";
import { getUserAppSettings, upsertUserAppSettings } from "@/lib/api";
import { syncHealthConnectWeights } from "@/lib/healthConnect";

export function useAppAutomation() {
  const queryClient = useQueryClient();
  const syncInFlightRef = useRef(false);

  const { data: settings } = useQuery({
    queryKey: ["user_app_settings"],
    queryFn: getUserAppSettings,
  });

  const effectiveSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(settings ?? {}),
  };

  useEffect(() => {
    syncBackgroundAutomationRegistration(effectiveSettings).catch(() => {
      // Best effort registration only.
    });
  }, [
    effectiveSettings.health_connect_background_enabled,
    effectiveSettings.health_connect_enabled,
    effectiveSettings.water_end_time,
    effectiveSettings.water_reminder_interval_min,
    effectiveSettings.water_reminders_enabled,
    effectiveSettings.water_start_time,
  ]);

  useEffect(() => {
    scheduleWaterReminderNotifications(effectiveSettings).catch(() => {
      // Best effort scheduling only.
    });
  }, [
    effectiveSettings.water_reminders_enabled,
    effectiveSettings.water_start_time,
    effectiveSettings.water_end_time,
    effectiveSettings.water_reminder_interval_min,
  ]);

  useEffect(() => {
    if (!effectiveSettings.health_connect_enabled) return;

    const runForegroundSync = async () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;

      try {
        await syncHealthConnectWeights();
        await upsertUserAppSettings({
          health_connect_last_sync_at: new Date().toISOString(),
          health_connect_last_error: null,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["daily_log"] }),
          queryClient.invalidateQueries({ queryKey: ["daily_logs"] }),
        ]);
      } catch (error) {
        await upsertUserAppSettings({
          health_connect_last_error:
            error instanceof Error ? error.message : "Falha ao sincronizar Health Connect.",
        }).catch(() => {
          // Ignore silent sync errors.
        });
      } finally {
        syncInFlightRef.current = false;
      }
    };

    runForegroundSync();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runForegroundSync();
      }
    });

    return () => subscription.remove();
  }, [effectiveSettings.health_connect_enabled, queryClient]);
}
