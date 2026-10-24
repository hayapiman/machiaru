import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import type { RoutePoint } from "@/drizzle/schema";

export const BACKGROUND_WALK_LOCATION_TASK = "machiaru-background-walk-location-v1";
const ACTIVE_SESSION_KEY = "@machiaru/background-walk/active-session";
const PENDING_LOCATIONS_KEY = "@machiaru/background-walk/pending-locations";
const WALK_DRAFT_KEY = "@machiaru/background-walk/active-draft";
const MAX_PENDING_LOCATIONS = 5000;
const MAX_DRAFT_ROUTE_POINTS = 5000;

type BackgroundLocationPayload = { locations?: Location.LocationObject[] };
export type WalkDraft = {
  ownerId: string;
  sessionId: string;
  startedAt: number;
  elapsedSeconds: number;
  distanceMeters: number;
  stepCount: number;
  estimatedSteps: boolean;
  wasTracking: boolean;
  routeData: RoutePoint[];
  savedAt: number;
};

let storageQueue: Promise<void> = Promise.resolve();

function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function parseLocations(value: string | null): Location.LocationObject[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Location.LocationObject => {
      if (!item || typeof item !== "object") return false;
      const location = item as Location.LocationObject;
      return Number.isFinite(location.timestamp)
        && Number.isFinite(location.coords?.latitude)
        && Number.isFinite(location.coords?.longitude);
    });
  } catch {
    return [];
  }
}

function parseWalkDraft(value: string | null): WalkDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<WalkDraft>;
    if (
      typeof candidate.ownerId !== "string"
      || typeof candidate.sessionId !== "string"
      || !Number.isFinite(candidate.startedAt)
      || candidate.sessionId !== String(candidate.startedAt)
      || !Number.isFinite(candidate.elapsedSeconds)
      || !Number.isFinite(candidate.distanceMeters)
      || !Number.isFinite(candidate.stepCount)
      || typeof candidate.estimatedSteps !== "boolean"
      || typeof candidate.wasTracking !== "boolean"
      || !Array.isArray(candidate.routeData)
    ) return null;

    const routeData = candidate.routeData.filter((point): point is RoutePoint => {
      if (!point || typeof point !== "object") return false;
      const routePoint = point as RoutePoint;
      return Number.isFinite(routePoint.latitude)
        && Number.isFinite(routePoint.longitude)
        && Number.isFinite(routePoint.timestamp);
    }).slice(-MAX_DRAFT_ROUTE_POINTS);
    return {
      ownerId: candidate.ownerId,
      sessionId: candidate.sessionId,
      startedAt: candidate.startedAt as number,
      elapsedSeconds: candidate.elapsedSeconds as number,
      distanceMeters: candidate.distanceMeters as number,
      stepCount: candidate.stepCount as number,
      estimatedSteps: candidate.estimatedSteps,
      wasTracking: candidate.wasTracking,
      routeData,
      savedAt: Number.isFinite(candidate.savedAt) ? candidate.savedAt as number : Date.now(),
    };
  } catch {
    return null;
  }
}

async function appendLocations(locations: Location.LocationObject[]): Promise<void> {
  await withStorageLock(async () => {
    const activeSession = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (!activeSession) return;

    const sessionStartedAt = Number(activeSession);
    const minimumTimestamp = Number.isFinite(sessionStartedAt) ? sessionStartedAt : 0;
    const existing = parseLocations(await AsyncStorage.getItem(PENDING_LOCATIONS_KEY));
    const seen = new Set(existing.map((location) => location.timestamp));
    const fresh = locations.filter((location) => {
      if (
        !Number.isFinite(location.timestamp)
        || location.timestamp < minimumTimestamp
        || seen.has(location.timestamp)
      ) return false;
      seen.add(location.timestamp);
      return true;
    });
    if (!fresh.length) return;

    const combined = [...existing, ...fresh]
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-MAX_PENDING_LOCATIONS);
    await AsyncStorage.setItem(PENDING_LOCATIONS_KEY, JSON.stringify(combined));
  });
}

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(BACKGROUND_WALK_LOCATION_TASK)) {
  TaskManager.defineTask<BackgroundLocationPayload>(BACKGROUND_WALK_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await appendLocations(data.locations);
  });
}

function walkDraftKey(ownerId: string): string {
  return `${WALK_DRAFT_KEY}/${encodeURIComponent(ownerId)}`;
}

export async function saveWalkDraft(draft: WalkDraft): Promise<void> {
  await withStorageLock(async () => {
    await AsyncStorage.setItem(walkDraftKey(draft.ownerId), JSON.stringify(draft));
  });
}

export async function loadWalkDraft(ownerId: string): Promise<WalkDraft | null> {
  return withStorageLock(async () => {
    const draft = parseWalkDraft(await AsyncStorage.getItem(walkDraftKey(ownerId)));
    return draft?.ownerId === ownerId ? draft : null;
  });
}

export async function clearWalkDraft(ownerId: string, sessionId?: string): Promise<void> {
  await withStorageLock(async () => {
    const key = walkDraftKey(ownerId);
    if (sessionId) {
      const draft = parseWalkDraft(await AsyncStorage.getItem(key));
      if (draft && draft.sessionId !== sessionId) return;
    }
    await AsyncStorage.removeItem(key);
  });
}

export async function beginBackgroundWalkSession(sessionId: string): Promise<void> {
  await withStorageLock(async () => {
    await AsyncStorage.multiSet([
      [ACTIVE_SESSION_KEY, sessionId],
      [PENDING_LOCATIONS_KEY, "[]"],
    ]);
  });
}

export async function startBackgroundWalkLocationUpdates(sessionId: string): Promise<void> {
  await beginBackgroundWalkSession(sessionId);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2500,
      distanceInterval: 3,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "まちあるで歩行を記録中",
        notificationBody: "画面をロックしている間も歩いた道を記録しています。",
        notificationColor: "#D05A3A",
      },
    });
  } catch (error) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK);
      }
    } catch {
      // Keep the original startup error; the active marker below still rejects late events.
    }
    await deactivateAndDrainBackgroundWalkSession(sessionId);
    throw error;
  }
}

export async function drainBackgroundWalkLocations(sessionId: string): Promise<Location.LocationObject[]> {
  return withStorageLock(async () => {
    const activeSession = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (activeSession !== sessionId) return [];
    const locations = parseLocations(await AsyncStorage.getItem(PENDING_LOCATIONS_KEY));
    await AsyncStorage.setItem(PENDING_LOCATIONS_KEY, "[]");
    return locations;
  });
}

export async function deactivateAndDrainBackgroundWalkSession(sessionId: string): Promise<Location.LocationObject[]> {
  return withStorageLock(async () => {
    const activeSession = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (activeSession !== sessionId) return [];
    const locations = parseLocations(await AsyncStorage.getItem(PENDING_LOCATIONS_KEY));
    await AsyncStorage.multiRemove([ACTIVE_SESSION_KEY, PENDING_LOCATIONS_KEY]);
    return locations;
  });
}

export async function clearOrphanedBackgroundWalkSession(): Promise<void> {
  await withStorageLock(async () => {
    await AsyncStorage.multiRemove([ACTIVE_SESSION_KEY, PENDING_LOCATIONS_KEY]);
  });
}

export async function stopBackgroundWalkLocationUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_WALK_LOCATION_TASK);
  }
}
