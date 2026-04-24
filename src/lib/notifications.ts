import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { formatWater } from "@/utils/calculations";

export const WATER_REMINDER_CHANNEL_ID = "water-reminders";
const WATER_REMINDER_DATA_TAG = "water-reminder-scheduled";

export function hasNotificationPermission(
  permission: Notifications.NotificationPermissionsStatus
) {
  const details = permission as {
    granted?: boolean;
    status?: string;
    ios?: { status?: number | null };
  };

  return (
    details.granted === true ||
    details.status === "granted" ||
    details.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureNotificationChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(WATER_REMINDER_CHANNEL_ID, {
    name: "Lembretes de agua",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function requestNotificationPermissions() {
  await ensureNotificationChannel();

  const current = await Notifications.getPermissionsAsync();
  if (hasNotificationPermission(current)) return current;

  return Notifications.requestPermissionsAsync();
}

export async function notificationsAreEnabled() {
  const current = await Notifications.getPermissionsAsync();
  return hasNotificationPermission(current);
}

export async function sendWaterReminderNotification(message: string) {
  await ensureNotificationChannel();

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "Hora de beber agua",
      body: message,
      sound: true,
      data: { screen: "agua" },
    },
    trigger: null,
  });
}

function parseHM(clock: string): [number, number] {
  const parts = clock.split(":").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

async function cancelScheduledWaterNotifications() {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.content.data?.tag === WATER_REMINDER_DATA_TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

/**
 * Schedules DateTriggerInput notifications for remaining time slots today
 * where the user is projected to be behind on water, based on their current
 * consumption rate. Fired by the OS's AlarmManager — works even when app is killed.
 *
 * Call this whenever: app becomes active, water is logged, or settings change.
 */
export async function scheduleSmartWaterNotifications(params: {
  settings: {
    water_reminders_enabled: boolean;
    water_start_time: string;
    water_end_time: string;
    water_reminder_interval_min: number;
  };
  consumedMl: number;
  targetMl: number;
  now?: Date;
}) {
  await cancelScheduledWaterNotifications();

  const { settings, consumedMl, targetMl } = params;
  const now = params.now ?? new Date();

  if (!settings.water_reminders_enabled || targetMl <= 0) return;
  if (!(await notificationsAreEnabled())) return;

  const [startH, startM] = parseHM(settings.water_start_time);
  const [endH, endM] = parseHM(settings.water_end_time);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const totalWindowMinutes = endMinutes - startMinutes;
  const interval = Math.max(15, settings.water_reminder_interval_min);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (totalWindowMinutes <= 0 || nowMinutes >= endMinutes) return;

  // Consumption rate since window opened (ml/min). Falls back to 0 if window hasn't started.
  const elapsedWindowMinutes = Math.max(0, nowMinutes - startMinutes);
  const ratePerMinute = elapsedWindowMinutes > 0 ? consumedMl / elapsedWindowMinutes : 0;

  // First future slot boundary after now
  let firstSlot = startMinutes;
  while (firstSlot <= nowMinutes) firstSlot += interval;

  await ensureNotificationChannel();

  for (let slotMinutes = firstSlot; slotMinutes <= endMinutes; slotMinutes += interval) {
    const slotElapsed = slotMinutes - startMinutes;
    // Expected progress at this slot (linear target distribution across window)
    const expectedAtSlot = targetMl * (slotElapsed / totalWindowMinutes);
    // Projected actual consumption if user maintains current drinking rate
    const projectedAtSlot = Math.min(targetMl, ratePerMinute * slotElapsed);
    const projectedDeficit = Math.max(0, Math.round(expectedAtSlot - projectedAtSlot));

    if (projectedDeficit <= 0) continue;

    const slotDate = new Date(now);
    slotDate.setHours(Math.floor(slotMinutes / 60), slotMinutes % 60, 0, 0);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Hora de beber agua",
        body: `Voce esta ${formatWater(projectedDeficit)} abaixo do ritmo ideal de hidratacao.`,
        sound: true,
        data: { screen: "agua", tag: WATER_REMINDER_DATA_TAG },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: slotDate,
      },
    });
  }
}
