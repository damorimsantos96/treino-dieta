import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

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
      data: {
        screen: "agua",
      },
    },
    trigger: null,
  });
}

export async function scheduleWaterReminderNotifications(settings: {
  water_reminders_enabled: boolean;
  water_start_time: string;
  water_end_time: string;
  water_reminder_interval_min: number;
}) {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of existing) {
    if (notif.content.data?.tag === WATER_REMINDER_DATA_TAG) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }

  if (!settings.water_reminders_enabled) return;

  const parseHM = (clock: string): [number, number] => {
    const [h, m] = clock.split(":").map(Number);
    return [h ?? 0, m ?? 0];
  };

  const [startH, startM] = parseHM(settings.water_start_time);
  const [endH, endM] = parseHM(settings.water_end_time);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const interval = Math.max(15, settings.water_reminder_interval_min);

  await ensureNotificationChannel();

  for (let t = startMinutes; t <= endMinutes; t += interval) {
    const hour = Math.floor(t / 60);
    const minute = t % 60;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Hora de beber agua",
        body: "Nao esqueca de se hidratar!",
        sound: true,
        data: { screen: "agua", tag: WATER_REMINDER_DATA_TAG },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }
}
