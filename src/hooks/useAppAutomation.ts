import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_USER_APP_SETTINGS } from "@/constants/appDefaults";
import { fetchWaterStatus, syncBackgroundAutomationRegistration } from "@/lib/backgroundAutomation";
import { scheduleSmartWaterNotifications } from "@/lib/notifications";
import { getDailyLog, getUserAppSettings, upsertUserAppSettings } from "@/lib/api";
import { syncHealthConnectWeights } from "@/lib/healthConnect";

export function useAppAutomation() {
  const queryClient = useQueryClient();
  const syncInFlightRef = useRef(false);
  const waterScheduleInFlightRef = useRef(false);

  const { data: settings } = useQuery({
    queryKey: ["user_app_settings"],
    queryFn: getUserAppSettings,
  });

  const effectiveSettings = {
    ...DEFAULT_USER_APP_SETTINGS,
    ...(settings ?? {}),
  };

  const today = format(new Date(), "yyyy-MM-dd");

  // Watch today's water consumption so notifications reschedule when water is logged.
  const { data: dailyLog } = useQuery({
    queryKey: ["daily_log", today],
    queryFn: () => getDailyLog(new Date()),
    enabled: effectiveSettings.water_reminders_enabled,
    staleTime: 30_000,
  });

  // Register / unregister WorkManager background task when settings change.
  // WorkManager runs the smart water check + Health Connect sync while the app
  // is backgrounded (not killed). minimumInterval unit is minutes.
  useEffect(() => {
    syncBackgroundAutomationRegistration(effectiveSettings).catch(() => {});
  }, [
    effectiveSettings.health_connect_background_enabled,
    effectiveSettings.health_connect_enabled,
    effectiveSettings.water_end_time,
    effectiveSettings.water_reminder_interval_min,
    effectiveSettings.water_reminders_enabled,
    effectiveSettings.water_start_time,
  ]);

  // Schedule OS-level (AlarmManager) notifications for remaining slots today.
  // These fire even when the app is completely killed. Triggered by:
  //   - settings changes
  //   - water_consumed_ml change (user logged water)
  //   - app becoming active
  useEffect(() => {
    const schedule = async () => {
      if (waterScheduleInFlightRef.current) return;
      waterScheduleInFlightRef.current = true;
      try {
        const waterStatus = await fetchWaterStatus();
        if (!waterStatus) return;
        await scheduleSmartWaterNotifications({
          settings: effectiveSettings,
          consumedMl: waterStatus.consumedMl,
          targetMl: waterStatus.targetMl,
        });
      } catch {
        // Best effort
      } finally {
        waterScheduleInFlightRef.current = false;
      }
    };

    schedule();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule();
    });

    return () => subscription.remove();
  }, [
    effectiveSettings.water_reminders_enabled,
    effectiveSettings.water_start_time,
    effectiveSettings.water_end_time,
    effectiveSettings.water_reminder_interval_min,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dailyLog?.water_consumed_ml,
  ]);

  // Foreground Health Connect sync on app active.
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
        }).catch(() => {});
      } finally {
        syncInFlightRef.current = false;
      }
    };

    runForegroundSync();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runForegroundSync();
    });

    return () => subscription.remove();
  }, [effectiveSettings.health_connect_enabled, queryClient]);
}
