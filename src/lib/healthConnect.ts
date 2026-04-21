import { format, subDays } from "date-fns";
import { Platform } from "react-native";
import {
  getChanges,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectDataManagement,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import type {
  BackgroundAccessPermission,
  Permission,
  ReadHealthDataHistoryPermission,
  RecordResult,
  WriteExerciseRoutePermission,
} from "react-native-health-connect";
import { upsertDailyLog } from "@/lib/api";
import { readJsonItem, writeJsonItem, deleteJsonItem } from "@/lib/deviceStorage";

const HEALTH_CONNECT_PROVIDER = "com.google.android.apps.healthdata";
const HEALTH_CONNECT_STATE_KEY = "health_connect_sync_state";
const HEALTH_CONNECT_LOOKBACK_DAYS = 30;

type WeightPermission = Permission & { recordType: "Weight"; accessType: "read" };
type HealthConnectPermission =
  | Permission
  | BackgroundAccessPermission
  | ReadHealthDataHistoryPermission
  | WriteExerciseRoutePermission;
type RawWeightMass = {
  value: number;
  unit: "grams" | "kilograms" | "milligrams" | "micrograms" | "ounces" | "pounds";
};
type WeightMass = RecordResult<"Weight">["weight"] | RawWeightMass;
type WeightRecordLike = { time: string; weight: WeightMass };

type HealthConnectLocalState = {
  changesToken: string | null;
  initialImportDone: boolean;
  lastSyncAt: string | null;
};

export type HealthConnectAvailability = {
  platformSupported: boolean;
  sdkStatus: number | null;
  isAvailable: boolean;
  needsProviderUpdate: boolean;
  initialized: boolean;
  permissions: HealthConnectPermission[];
  hasWeightAccess: boolean;
  hasBackgroundAccess: boolean;
};

export type HealthConnectSyncResult = {
  syncedDates: number;
  latestWeightKg: number | null;
  latestRecordedAt: string | null;
  source: "initial" | "changes";
};

function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hasPermission(
  permissions: HealthConnectPermission[],
  recordType: string,
  accessType: "read" | "write" = "read"
) {
  return permissions.some(
    (permission) =>
      permission.recordType === recordType &&
      permission.accessType === accessType
  );
}

async function readLocalState(): Promise<HealthConnectLocalState> {
  return readJsonItem<HealthConnectLocalState>(HEALTH_CONNECT_STATE_KEY, {
    changesToken: null,
    initialImportDone: false,
    lastSyncAt: null,
  });
}

async function writeLocalState(state: HealthConnectLocalState) {
  await writeJsonItem(HEALTH_CONNECT_STATE_KEY, state);
}

async function ensureInitialized(): Promise<HealthConnectAvailability> {
  if (Platform.OS !== "android") {
    return {
      platformSupported: false,
      sdkStatus: null,
      isAvailable: false,
      needsProviderUpdate: false,
      initialized: false,
      permissions: [],
      hasWeightAccess: false,
      hasBackgroundAccess: false,
    };
  }

  const sdkStatus = await getSdkStatus(HEALTH_CONNECT_PROVIDER);
  if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    return {
      platformSupported: true,
      sdkStatus,
      isAvailable: false,
      needsProviderUpdate:
        sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
      initialized: false,
      permissions: [],
      hasWeightAccess: false,
      hasBackgroundAccess: false,
    };
  }

  const initialized = await initialize(HEALTH_CONNECT_PROVIDER);
  const permissions = initialized ? await getGrantedPermissions() : [];

  return {
    platformSupported: true,
    sdkStatus,
    isAvailable: true,
    needsProviderUpdate: false,
    initialized,
    permissions,
    hasWeightAccess: hasPermission(permissions, "Weight"),
    hasBackgroundAccess: hasPermission(permissions, "BackgroundAccessPermission"),
  };
}

function toWeightPermission(): WeightPermission {
  return { accessType: "read", recordType: "Weight" };
}

function toBackgroundPermission(): BackgroundAccessPermission {
  return { accessType: "read", recordType: "BackgroundAccessPermission" };
}

function toKilograms(weight: WeightMass): number | null {
  if ("inKilograms" in weight) {
    return weight.inKilograms;
  }

  if (weight.unit === "kilograms") return weight.value;
  if (weight.unit === "grams") return weight.value / 1000;
  if (weight.unit === "milligrams") return weight.value / 1_000_000;
  if (weight.unit === "micrograms") return weight.value / 1_000_000_000;
  if (weight.unit === "ounces") return weight.value * 0.028349523125;
  if (weight.unit === "pounds") return weight.value * 0.45359237;

  return null;
}

async function readRecentWeightRecords() {
  const start = subDays(new Date(), HEALTH_CONNECT_LOOKBACK_DAYS);
  const end = new Date();
  const { records } = await readRecords("Weight", {
    timeRangeFilter: {
      operator: "between",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    ascendingOrder: true,
    pageSize: 1000,
  });

  return records;
}

async function syncWeightRecords(
  records: WeightRecordLike[]
) {
  const latestByDate = new Map<
    string,
    { time: string; weightKg: number }
  >();

  for (const record of records) {
    const weightKg = toKilograms(record.weight);
    if (weightKg == null) continue;

    const date = format(new Date(record.time), "yyyy-MM-dd");
    const current = latestByDate.get(date);
    if (!current || new Date(record.time).getTime() > new Date(current.time).getTime()) {
      latestByDate.set(date, {
        time: record.time,
        weightKg: roundTo(weightKg),
      });
    }
  }

  const ordered = [...latestByDate.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );

  for (const [date, item] of ordered) {
    await upsertDailyLog({
      date,
      weight_kg: item.weightKg,
    });
  }

  const latest = ordered.at(-1)?.[1] ?? null;

  return {
    syncedDates: ordered.length,
    latestWeightKg: latest?.weightKg ?? null,
    latestRecordedAt: latest?.time ?? null,
  };
}

async function seedChangesToken() {
  const response = await getChanges({ recordTypes: ["Weight"] });
  return response.nextChangesToken;
}

export async function getHealthConnectAvailability() {
  return ensureInitialized();
}

export async function requestHealthConnectPermissions(options?: {
  includeBackground?: boolean;
}) {
  const availability = await ensureInitialized();
  if (!availability.isAvailable || !availability.initialized) {
    return availability;
  }

  const requested: HealthConnectPermission[] = [toWeightPermission()];
  if (options?.includeBackground) {
    requested.push(toBackgroundPermission());
  }

  await requestPermission(requested);
  return ensureInitialized();
}

export async function syncHealthConnectWeights(): Promise<HealthConnectSyncResult> {
  const availability = await ensureInitialized();
  if (!availability.isAvailable || !availability.initialized) {
    throw new Error("Health Connect nao esta disponivel neste dispositivo.");
  }
  if (!availability.hasWeightAccess) {
    throw new Error("Permissao de leitura de peso ainda nao foi concedida.");
  }

  const localState = await readLocalState();

  if (!localState.initialImportDone) {
    const recent = await readRecentWeightRecords();
    const initialResult = await syncWeightRecords(recent);
    const changesToken = await seedChangesToken();
    await writeLocalState({
      changesToken,
      initialImportDone: true,
      lastSyncAt: new Date().toISOString(),
    });

    return { ...initialResult, source: "initial" };
  }

  let changesToken = localState.changesToken;
  if (!changesToken) {
    changesToken = await seedChangesToken();
  }

  const changedRecords: WeightRecordLike[] = [];

  while (changesToken) {
    const response = await getChanges({ changesToken });

    if (response.changesTokenExpired) {
      await deleteJsonItem(HEALTH_CONNECT_STATE_KEY);
      const recent = await readRecentWeightRecords();
      const resetResult = await syncWeightRecords(recent);
      const nextChangesToken = await seedChangesToken();
      await writeLocalState({
        changesToken: nextChangesToken,
        initialImportDone: true,
        lastSyncAt: new Date().toISOString(),
      });
      return { ...resetResult, source: "initial" };
    }

    for (const change of response.upsertionChanges) {
      if (change.record.recordType !== "Weight") continue;
      changedRecords.push({
        time: change.record.time,
        weight: change.record.weight,
      });
    }

    changesToken = response.nextChangesToken;
    if (!response.hasMore) break;
  }

  const result = await syncWeightRecords(changedRecords);
  await writeLocalState({
    changesToken: changesToken ?? null,
    initialImportDone: true,
    lastSyncAt: new Date().toISOString(),
  });

  return { ...result, source: "changes" };
}

export async function clearHealthConnectLocalState() {
  await deleteJsonItem(HEALTH_CONNECT_STATE_KEY);
}

export function openHealthConnectManager() {
  if (Platform.OS !== "android") return;
  openHealthConnectDataManagement(HEALTH_CONNECT_PROVIDER);
}

export function openHealthConnectAppSettings() {
  if (Platform.OS !== "android") return;
  openHealthConnectSettings();
}
