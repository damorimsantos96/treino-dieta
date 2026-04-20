import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useUpdates } from "expo-updates";
import * as Updates from "expo-updates";

const MIN_CHECK_INTERVAL_MS = 60 * 1000;
const AUTO_RELOAD_DELAY_MS = 1200;

export function useAppUpdate() {
  const { isUpdateAvailable, isUpdatePending } = useUpdates();
  const lastChecked = useRef<number>(0);
  const checking = useRef(false);
  const fetching = useRef(false);

  async function checkAndFetch() {
    if (__DEV__) return;
    if (checking.current) return;
    const now = Date.now();
    if (now - lastChecked.current < MIN_CHECK_INTERVAL_MS) return;
    lastChecked.current = now;
    checking.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) await fetchAvailableUpdate();
    } catch {
    } finally {
      checking.current = false;
    }
  }

  async function fetchAvailableUpdate() {
    if (__DEV__ || fetching.current) return;
    fetching.current = true;
    try {
      await Updates.fetchUpdateAsync();
    } catch {
    } finally {
      fetching.current = false;
    }
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") checkAndFetch();
    });
    checkAndFetch();
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isUpdateAvailable) fetchAvailableUpdate();
  }, [isUpdateAvailable]);

  useEffect(() => {
    if (__DEV__ || !isUpdatePending) return;
    const timer = setTimeout(() => {
      Updates.reloadAsync().catch(() => {});
    }, AUTO_RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isUpdatePending]);

  return { isUpdatePending };
}
