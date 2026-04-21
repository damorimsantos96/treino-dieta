import { UserAppSettings } from "@/types";

export const DEFAULT_USER_APP_SETTINGS: Pick<
  UserAppSettings,
  | "water_start_time"
  | "water_end_time"
  | "water_reminders_enabled"
  | "water_reminder_interval_min"
  | "health_connect_enabled"
  | "health_connect_background_enabled"
  | "health_connect_last_sync_at"
  | "health_connect_last_error"
> = {
  water_start_time: "07:00",
  water_end_time: "22:00",
  water_reminders_enabled: false,
  water_reminder_interval_min: 60,
  health_connect_enabled: false,
  health_connect_background_enabled: false,
  health_connect_last_sync_at: null,
  health_connect_last_error: null,
};

export const DEFAULT_WATER_PRESETS = [
  { label: "250 ml", amount_ml: 250, sort_order: 0 },
  { label: "500 ml", amount_ml: 500, sort_order: 1 },
  { label: "750 ml", amount_ml: 750, sort_order: 2 },
];

export const WATER_REMINDER_MIN_INTERVAL = 15;
export const HEALTH_CONNECT_BACKGROUND_INTERVAL_MIN = 60;
