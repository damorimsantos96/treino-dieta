import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useUpdates } from "expo-updates";
import * as Updates from "expo-updates";

const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useAppUpdate() {
  const { isUpdateAvailable, isUpdatePending } = useUpdates();
  const lastChecked = useRef<number>(0);

  async function checkAndFetch() {
    if (__DEV__) return;
    const now = Date.now();
    if (now - lastChecked.current < MIN_CHECK_INTERVAL_MS) return;
    lastChecked.current = now;
    try {
      await Updates.checkForUpdateAsync();
    } catch {}
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") checkAndFetch();
    });
    checkAndFetch();
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isUpdateAvailable) {
      Updates.fetchUpdateAsync().catch(() => {});
    }
  }, [isUpdateAvailable]);

  return { isUpdatePending };
}
