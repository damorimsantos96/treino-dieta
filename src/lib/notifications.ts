import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const WATER_REMINDER_CHANNEL_ID = "water-reminders";

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
