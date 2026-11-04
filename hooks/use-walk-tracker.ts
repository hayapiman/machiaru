import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import type { RoutePoint } from "@/drizzle/schema";
import {
  MAX_PLAUSIBLE_WALK_SPEED_MPS,
  MAX_TRACKED_GPS_ACCURACY_METERS,
  MAX_TRACK_SEGMENT_SECONDS,
  haversineMeters,
  isPlausibleWalkSegment,
  medianSpeed,
  movementThresholdMeters,
  stabilizedSegmentSpeed,
} from "@/lib/walk-metrics";
import {
  clearOrphanedBackgroundWalkSession,
  clearWalkDraft,
  deactivateAndDrainBackgroundWalkSession,
  drainBackgroundWalkLocations,
  loadWalkDraft,
  saveWalkDraft,
  startBackgroundWalkLocationUpdates,
  stopBackgroundWalkLocationUpdates,
  type WalkDraft,
} from "@/lib/background-walk";

type RunState = "idle" | "tracking" | "paused";
type AccurateFix = RoutePoint & { accuracyMeters: number };
type CurrentLocation = { latitude: number; longitude: number };
type BackgroundTrackingStatus = "idle" | "enabled" | "requires-build" | "permission-denied" | "unavailable" | "error";
type WalkResult = {
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distanceMeters: number;
  stepCount: number;
  routeData: RoutePoint[];
};

const ESTIMATED_STRIDE_METERS = 0.72;
const POSITION_STALE_MS = 6500;
const FOREGROUND_LOCATION_OPTIONS = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2000,
  distanceInterval: 2,
};

function useWalkTrackerController() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [isRestoringDraft, setIsRestoringDraft] = useState(true);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [draftOwnerId, setDraftOwnerIdState] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [currentSpeedMps, setCurrentSpeedMps] = useState(0);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null);
  const [currentLocationAccuracyMeters, setCurrentLocationAccuracyMeters] = useState<number | null>(null);
  const [estimatedSteps, setEstimatedSteps] = useState(false);
  const [backgroundTrackingStatus, setBackgroundTrackingStatus] = useState<BackgroundTrackingStatus>("idle");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RoutePoint[]>([]);
  const estimatedStepsRef = useRef(false);
  const draftOwnerIdRef = useRef<string | null>(null);
  const routeRef = useRef<RoutePoint[]>([]);
  const distanceRef = useRef(0);
  const stepRef = useRef(0);
  const pedometerBaseRef = useRef(0);
  const distanceAnchorRef = useRef<AccurateFix | null>(null);
  const speedSamplesRef = useRef<number[]>([]);
  const lastMovementAtRef = useRef(0);
  const lastProcessedTimestampRef = useRef(0);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const pedometerSubscription = useRef<{ remove: () => void } | null>(null);
  const runStateRef = useRef<RunState>("idle");
  const startedAtRef = useRef(0);
  const elapsedBeforeActiveRef = useRef(0);
  const activeSinceRef = useRef(0);
  const backgroundSessionIdRef = useRef<string | null>(null);
  const backgroundTrackingActiveRef = useRef(false);
  const backgroundFlushPromiseRef = useRef<Promise<void> | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraftSavedAtRef = useRef(0);

  const changeState = useCallback((next: RunState) => {
    runStateRef.current = next;
    setRunState(next);
  }, []);

  const snapshotElapsed = useCallback(() => {
    if (runStateRef.current !== "tracking") return elapsedBeforeActiveRef.current;
    return elapsedBeforeActiveRef.current + Math.max(0, Math.floor((Date.now() - activeSinceRef.current) / 1000));
  }, []);

  const persistWalkDraft = useCallback(async () => {
    const ownerId = draftOwnerIdRef.current;
    if (!ownerId || !startedAtRef.current) return;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const now = Date.now();
    const draft: WalkDraft = {
      ownerId,
      sessionId: String(startedAtRef.current),
      startedAt: startedAtRef.current,
      elapsedSeconds: Math.max(0, snapshotElapsed()),
      distanceMeters: Math.max(0, distanceRef.current),
      stepCount: estimatedStepsRef.current
        ? Math.round(distanceRef.current / ESTIMATED_STRIDE_METERS)
        : Math.max(0, stepRef.current),
      estimatedSteps: estimatedStepsRef.current,
      wasTracking: runStateRef.current === "tracking",
      routeData: [...routeRef.current],
      savedAt: now,
    };
    await saveWalkDraft(draft);
    lastDraftSavedAtRef.current = Date.now();
  }, [snapshotElapsed]);

  const scheduleWalkDraftSave = useCallback(() => {
    if (!startedAtRef.current || draftSaveTimerRef.current) return;
    const waitMs = Math.max(0, 5000 - (Date.now() - lastDraftSavedAtRef.current));
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      void persistWalkDraft().catch(() => undefined);
    }, waitMs);
  }, [persistWalkDraft]);

  const clearSavedDraft = useCallback(async () => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const ownerId = draftOwnerIdRef.current;
    if (!ownerId) return;
    const sessionId = startedAtRef.current ? String(startedAtRef.current) : undefined;
    await clearWalkDraft(ownerId, sessionId);
    if (!sessionId || sessionId === String(startedAtRef.current)) {
      startedAtRef.current = 0;
      elapsedBeforeActiveRef.current = 0;
      lastDraftSavedAtRef.current = 0;
      setRestoredDraft(false);
    }
  }, []);

  const stopSubscriptions = useCallback(() => {
    locationSubscription.current?.remove();
    locationSubscription.current = null;
    if (pedometerSubscription.current) {
      pedometerSubscription.current.remove();
      pedometerSubscription.current = null;
      pedometerBaseRef.current = stepRef.current;
    }
  }, []);

  const appendRoutePoint = useCallback((point: RoutePoint) => {
    routeRef.current = [...routeRef.current, point];
    setRouteData(routeRef.current);
  }, []);

  const clearSpeedIfStale = useCallback((now: number) => {
    if (!lastMovementAtRef.current || now - lastMovementAtRef.current > POSITION_STALE_MS) {
      speedSamplesRef.current = [];
      setCurrentSpeedMps(0);
    }
  }, []);

  const onPosition = useCallback((position: Location.LocationObject) => {
    const now = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now();
    if (now <= lastProcessedTimestampRef.current) return;
    lastProcessedTimestampRef.current = now;

    const rawAccuracy = position.coords.accuracy;
    const accuracy = rawAccuracy !== null && Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : null;
    setGpsAccuracyMeters(accuracy);
    if (Number.isFinite(position.coords.latitude) && Number.isFinite(position.coords.longitude)) {
      setCurrentLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setCurrentLocationAccuracyMeters(accuracy);
    }

    if (
      accuracy === null ||
      accuracy > MAX_TRACKED_GPS_ACCURACY_METERS ||
      !Number.isFinite(position.coords.latitude) ||
      !Number.isFinite(position.coords.longitude)
    ) {
      clearSpeedIfStale(now);
      return;
    }

    const point: RoutePoint = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: now,
      speedMps: null,
    };
    const currentFix: AccurateFix = { ...point, accuracyMeters: accuracy };
    const anchor = distanceAnchorRef.current;

    if (!anchor) {
      distanceAnchorRef.current = currentFix;
      appendRoutePoint(routeRef.current.length ? { ...point, breakBefore: true } : point);
      scheduleWalkDraftSave();
      return;
    }

    const seconds = (now - anchor.timestamp) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      distanceAnchorRef.current = currentFix;
      return;
    }
    if (seconds < 1) return;

    const segmentMeters = haversineMeters(anchor, point);
    if (seconds > MAX_TRACK_SEGMENT_SECONDS) {
      distanceAnchorRef.current = currentFix;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      setCurrentSpeedMps(0);
      appendRoutePoint({ ...point, breakBefore: true });
      scheduleWalkDraftSave();
      return;
    }

    const segmentSpeed = segmentMeters / seconds;
    if (segmentSpeed > MAX_PLAUSIBLE_WALK_SPEED_MPS) {
      distanceAnchorRef.current = currentFix;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      setCurrentSpeedMps(0);
      appendRoutePoint({ ...point, breakBefore: true });
      scheduleWalkDraftSave();
      return;
    }

    const threshold = movementThresholdMeters(anchor.accuracyMeters, accuracy);
    if (!isPlausibleWalkSegment(segmentMeters, seconds, threshold)) {
      clearSpeedIfStale(now);
      return;
    }

    distanceAnchorRef.current = currentFix;
    distanceRef.current += segmentMeters;
    setDistanceMeters(distanceRef.current);

    if (estimatedStepsRef.current) {
      const estimate = Math.round(distanceRef.current / ESTIMATED_STRIDE_METERS);
      stepRef.current = estimate;
      setStepCount(estimate);
    }
    lastMovementAtRef.current = now;

    const speed = stabilizedSegmentSpeed(segmentSpeed, position.coords.speed);
    speedSamplesRef.current = [...speedSamplesRef.current, speed].slice(-5);
    const smoothedSpeed = medianSpeed(speedSamplesRef.current);
    setCurrentSpeedMps(smoothedSpeed);
    appendRoutePoint({ ...point, speedMps: smoothedSpeed });
    scheduleWalkDraftSave();
  }, [appendRoutePoint, clearSpeedIfStale, scheduleWalkDraftSave]);

  const startForegroundLocationSubscription = useCallback(async () => {
    if (locationSubscription.current) return;
    locationSubscription.current = await Location.watchPositionAsync(FOREGROUND_LOCATION_OPTIONS, onPosition);
  }, [onPosition]);

  const startBackgroundTrackingIfPossible = useCallback(async () => {
    if (Platform.OS === "web") {
      setBackgroundTrackingStatus("unavailable");
      return;
    }
    if (Constants.appOwnership === "expo") {
      setBackgroundTrackingStatus("requires-build");
      return;
    }

    try {
      if (!(await TaskManager.isAvailableAsync())) {
        setBackgroundTrackingStatus("requires-build");
        return;
      }
      const currentPermission = await Location.getBackgroundPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await Location.requestBackgroundPermissionsAsync();
      if (!permission.granted) {
        setBackgroundTrackingStatus("permission-denied");
        return;
      }

      const sessionId = String(startedAtRef.current);
      await startBackgroundWalkLocationUpdates(sessionId);
      backgroundSessionIdRef.current = sessionId;
      backgroundTrackingActiveRef.current = true;
      setBackgroundTrackingStatus("enabled");
    } catch {
      setBackgroundTrackingStatus("error");
    }
  }, []);

  const startSubscriptions = useCallback(async () => {
    const currentPermission = await Location.getForegroundPermissionsAsync();
    const permission = currentPermission.granted
      ? currentPermission
      : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error("歩行ルートを記録するには位置情報の使用を許可してください。");

    distanceAnchorRef.current = null;
    if (!estimatedStepsRef.current) {
      try {
        const available = Platform.OS !== "web" && await Pedometer.isAvailableAsync();
        if (available) {
          pedometerSubscription.current = Pedometer.watchStepCount(({ steps }) => {
            stepRef.current = pedometerBaseRef.current + steps;
            setStepCount(stepRef.current);
          });
        } else {
          estimatedStepsRef.current = true;
          setEstimatedSteps(true);
        }
      } catch {
        estimatedStepsRef.current = true;
        setEstimatedSteps(true);
      }
    }

    const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    onPosition(initial);
    await startForegroundLocationSubscription();
    await startBackgroundTrackingIfPossible();
  }, [onPosition, startBackgroundTrackingIfPossible, startForegroundLocationSubscription]);

  const processBackgroundLocations = useCallback((locations: Location.LocationObject[]) => {
    const pending = locations
      .filter((location) => Number.isFinite(location.timestamp) && location.timestamp > lastProcessedTimestampRef.current)
      .sort((left, right) => left.timestamp - right.timestamp);
    if (!pending.length) return;

    // Pedometer may stop while the app is backgrounded; use the clearly-labelled distance estimate.
    estimatedStepsRef.current = true;
    setEstimatedSteps(true);
    for (const location of pending) onPosition(location);
  }, [onPosition]);

  const flushBackgroundLocations = useCallback(async () => {
    const sessionId = backgroundSessionIdRef.current;
    if (!sessionId || !backgroundTrackingActiveRef.current) return;
    if (backgroundFlushPromiseRef.current) {
      await backgroundFlushPromiseRef.current;
      if (backgroundSessionIdRef.current === sessionId && backgroundTrackingActiveRef.current) {
        processBackgroundLocations(await drainBackgroundWalkLocations(sessionId));
      }
      return;
    }
    const operation = (async () => {
      const queued = await drainBackgroundWalkLocations(sessionId);
      processBackgroundLocations(queued);
    })();
    backgroundFlushPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      if (backgroundFlushPromiseRef.current === operation) backgroundFlushPromiseRef.current = null;
    }
  }, [processBackgroundLocations]);

  const stopBackgroundTracking = useCallback(async () => {
    const sessionId = backgroundSessionIdRef.current;
    if (!sessionId) {
      backgroundTrackingActiveRef.current = false;
      setBackgroundTrackingStatus("idle");
      return;
    }
    let stopHadError = false;
    try {
      await flushBackgroundLocations();
    } catch {
      stopHadError = true;
    }
    try {
      await stopBackgroundWalkLocationUpdates();
    } catch {
      stopHadError = true;
    }
    try {
      await flushBackgroundLocations();
    } catch {
      stopHadError = true;
    }
    let finalLocations: Location.LocationObject[] = [];
    try {
      finalLocations = await deactivateAndDrainBackgroundWalkSession(sessionId);
    } catch {
      stopHadError = true;
    }
    backgroundTrackingActiveRef.current = false;
    backgroundSessionIdRef.current = null;
    processBackgroundLocations(finalLocations);
    setBackgroundTrackingStatus(stopHadError ? "error" : "idle");
  }, [flushBackgroundLocations, processBackgroundLocations]);

  const setDraftOwnerId = useCallback(async (nextOwnerId: string | null) => {
    const normalizedOwnerId = nextOwnerId?.trim() || null;
    const previousOwnerId = draftOwnerIdRef.current;
    if (previousOwnerId === normalizedOwnerId) return;

    if (previousOwnerId) {
      try {
        await flushBackgroundLocations();
      } catch {
        // Preserve the last saved draft even if an OS queue read fails.
      }
      if (runStateRef.current === "tracking") {
        elapsedBeforeActiveRef.current = snapshotElapsed();
        setElapsedSeconds(elapsedBeforeActiveRef.current);
        changeState("paused");
      }
      stopSubscriptions();
      await stopBackgroundTracking();
      await persistWalkDraft().catch(() => undefined);

      routeRef.current = [];
      distanceRef.current = 0;
      stepRef.current = 0;
      pedometerBaseRef.current = 0;
      estimatedStepsRef.current = false;
      startedAtRef.current = 0;
      elapsedBeforeActiveRef.current = 0;
      activeSinceRef.current = 0;
      lastProcessedTimestampRef.current = 0;
      distanceAnchorRef.current = null;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      setRouteData([]);
      setDistanceMeters(0);
      setStepCount(0);
      setEstimatedSteps(false);
      setElapsedSeconds(0);
      setCurrentSpeedMps(0);
      setGpsAccuracyMeters(null);
      setCurrentLocation(null);
      setCurrentLocationAccuracyMeters(null);
      setBackgroundTrackingStatus("idle");
      changeState("idle");
    }

    draftOwnerIdRef.current = normalizedOwnerId;
    setDraftOwnerIdState(normalizedOwnerId);
    setIsRestoringDraft(Boolean(normalizedOwnerId));
    setRestoredDraft(false);
  }, [changeState, flushBackgroundLocations, persistWalkDraft, snapshotElapsed, stopBackgroundTracking, stopSubscriptions]);

  useEffect(() => {
    let cancelled = false;
    const restoreDraft = async () => {
      if (!draftOwnerId) {
        if (!cancelled) setIsRestoringDraft(false);
        return;
      }
      let draft: WalkDraft | null = null;
      try {
        draft = await loadWalkDraft(draftOwnerId);
      } catch {
        draft = null;
      }
      if (cancelled) return;

      if (!draft) {
        if (Platform.OS !== "web") {
          try {
            await stopBackgroundWalkLocationUpdates();
          } catch {
            // There may be no native task registered on this installation.
          }
          try {
            await clearOrphanedBackgroundWalkSession();
          } catch {
            // A future walk will start with a fresh queue if local storage is unavailable.
          }
        }
        if (!cancelled) setIsRestoringDraft(false);
        return;
      }

      if (Platform.OS !== "web") {
        try {
          await stopBackgroundWalkLocationUpdates();
        } catch {
          // The task may already have been stopped by the operating system.
        }
      }
      if (cancelled) return;

      let pendingLocations: Location.LocationObject[] = [];
      try {
        pendingLocations = await deactivateAndDrainBackgroundWalkSession(draft.sessionId);
      } catch {
        // Keep the saved route even if the pending OS queue cannot be read.
      }
      if (cancelled) return;

      const lastQueuedTimestamp = pendingLocations.reduce((latest, location) => Math.max(latest, location.timestamp), 0);
      const backgroundElapsedSeconds = draft.wasTracking && lastQueuedTimestamp > draft.savedAt
        ? Math.floor((lastQueuedTimestamp - draft.savedAt) / 1000)
        : 0;

      routeRef.current = [...draft.routeData];
      distanceRef.current = draft.distanceMeters;
      stepRef.current = draft.stepCount;
      pedometerBaseRef.current = draft.stepCount;
      estimatedStepsRef.current = draft.estimatedSteps;
      lastProcessedTimestampRef.current = draft.routeData.at(-1)?.timestamp ?? 0;
      distanceAnchorRef.current = null;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      startedAtRef.current = draft.startedAt;
      elapsedBeforeActiveRef.current = draft.elapsedSeconds + backgroundElapsedSeconds;
      activeSinceRef.current = 0;
      backgroundSessionIdRef.current = null;
      backgroundTrackingActiveRef.current = false;
      lastDraftSavedAtRef.current = draft.savedAt;
      setRouteData(routeRef.current);
      setDistanceMeters(distanceRef.current);
      setStepCount(stepRef.current);
      setEstimatedSteps(estimatedStepsRef.current);
      setElapsedSeconds(elapsedBeforeActiveRef.current);
      setCurrentSpeedMps(0);
      setGpsAccuracyMeters(null);
      const lastPoint = routeRef.current.at(-1);
      setCurrentLocation(lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude } : null);
      setCurrentLocationAccuracyMeters(null);
      processBackgroundLocations(pendingLocations);
      changeState("paused");
      setRestoredDraft(true);
      setIsRestoringDraft(false);
      try {
        await persistWalkDraft();
      } catch {
        // The recovered in-memory route remains usable if storage is temporarily unavailable.
      }
    };

    void restoreDraft().catch(() => {
      if (!cancelled) setIsRestoringDraft(false);
    });
    return () => {
      cancelled = true;
    };
  }, [changeState, draftOwnerId, persistWalkDraft, processBackgroundLocations]);

  const start = useCallback(async () => {
    if (!draftOwnerIdRef.current || isRestoringDraft) return false;
    setLocationError(null);
    try {
      await clearSavedDraft();
      setRestoredDraft(false);
      routeRef.current = [];
      setRouteData([]);
      distanceRef.current = 0;
      stepRef.current = 0;
      pedometerBaseRef.current = 0;
      distanceAnchorRef.current = null;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      lastProcessedTimestampRef.current = 0;
      estimatedStepsRef.current = false;
      setEstimatedSteps(false);
      setGpsAccuracyMeters(null);
      setCurrentLocation(null);
      setCurrentLocationAccuracyMeters(null);
      setDistanceMeters(0);
      setStepCount(0);
      setCurrentSpeedMps(0);
      setElapsedSeconds(0);
      elapsedBeforeActiveRef.current = 0;
      startedAtRef.current = Date.now();
      backgroundSessionIdRef.current = null;
      backgroundTrackingActiveRef.current = false;
      setBackgroundTrackingStatus("idle");
      await persistWalkDraft();
      await startSubscriptions();
      activeSinceRef.current = Date.now();
      changeState("tracking");
      await persistWalkDraft();
      return true;
    } catch (error) {
      stopSubscriptions();
      await stopBackgroundTracking();
      await clearSavedDraft().catch(() => undefined);
      setLocationError(error instanceof Error ? error.message : "位置情報を取得できませんでした。");
      changeState("idle");
      return false;
    }
  }, [changeState, clearSavedDraft, isRestoringDraft, persistWalkDraft, startSubscriptions, stopBackgroundTracking, stopSubscriptions]);

  const pause = useCallback(async () => {
    if (runStateRef.current !== "tracking") return;
    try {
      await flushBackgroundLocations();
    } catch {
      setBackgroundTrackingStatus("error");
    }
    if (runStateRef.current !== "tracking") return;
    elapsedBeforeActiveRef.current = snapshotElapsed();
    setElapsedSeconds(elapsedBeforeActiveRef.current);
    stopSubscriptions();
    await stopBackgroundTracking();
    stopSubscriptions();
    speedSamplesRef.current = [];
    lastMovementAtRef.current = 0;
    setCurrentSpeedMps(0);
    changeState("paused");
    await persistWalkDraft().catch(() => undefined);
  }, [changeState, flushBackgroundLocations, persistWalkDraft, snapshotElapsed, stopBackgroundTracking, stopSubscriptions]);

  const resume = useCallback(async () => {
    setLocationError(null);
    try {
      await startSubscriptions();
      activeSinceRef.current = Date.now();
      changeState("tracking");
      setRestoredDraft(false);
      await persistWalkDraft();
      return true;
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "位置情報を再開できませんでした。");
      return false;
    }
  }, [changeState, persistWalkDraft, startSubscriptions]);

  const finish = useCallback(async (): Promise<WalkResult | null> => {
    if (runStateRef.current === "idle" || !startedAtRef.current) return null;
    try {
      await flushBackgroundLocations();
    } catch {
      setBackgroundTrackingStatus("error");
    }
    const endedAt = Date.now();
    stopSubscriptions();
    await stopBackgroundTracking();
    stopSubscriptions();
    const durationSeconds = Math.max(1, snapshotElapsed());
    elapsedBeforeActiveRef.current = durationSeconds;
    changeState("idle");
    setCurrentSpeedMps(0);
    setElapsedSeconds(durationSeconds);
    const result = {
      startedAt: startedAtRef.current,
      endedAt,
      durationSeconds,
      distanceMeters: distanceRef.current,
      stepCount: estimatedStepsRef.current
        ? Math.round(distanceRef.current / ESTIMATED_STRIDE_METERS)
        : stepRef.current,
      routeData: [...routeRef.current],
    };
    await persistWalkDraft().catch(() => undefined);
    return result;
  }, [changeState, flushBackgroundLocations, persistWalkDraft, snapshotElapsed, stopBackgroundTracking, stopSubscriptions]);

  const stopForAccountRemoval = useCallback(async () => {
    if (runStateRef.current === "tracking") {
      try {
        await flushBackgroundLocations();
      } catch {
        // Keep the last persisted draft if an OS queue read is unavailable.
      }
      elapsedBeforeActiveRef.current = snapshotElapsed();
      setElapsedSeconds(elapsedBeforeActiveRef.current);
    }
    stopSubscriptions();
    await stopBackgroundTracking();
    if (runStateRef.current === "tracking") changeState("paused");
    await persistWalkDraft().catch(() => undefined);
  }, [changeState, flushBackgroundLocations, persistWalkDraft, snapshotElapsed, stopBackgroundTracking, stopSubscriptions]);

  const discardCurrentAccountDraft = useCallback(async () => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const ownerId = draftOwnerIdRef.current;
    const sessionId = startedAtRef.current ? String(startedAtRef.current) : undefined;
    if (ownerId) await clearWalkDraft(ownerId, sessionId);
    if (Platform.OS !== "web") {
      await clearOrphanedBackgroundWalkSession().catch(() => undefined);
    }
    routeRef.current = [];
    distanceRef.current = 0;
    stepRef.current = 0;
    pedometerBaseRef.current = 0;
    estimatedStepsRef.current = false;
    startedAtRef.current = 0;
    elapsedBeforeActiveRef.current = 0;
    activeSinceRef.current = 0;
    lastProcessedTimestampRef.current = 0;
    distanceAnchorRef.current = null;
    speedSamplesRef.current = [];
    lastMovementAtRef.current = 0;
    lastDraftSavedAtRef.current = 0;
    backgroundSessionIdRef.current = null;
    backgroundTrackingActiveRef.current = false;
    setRouteData([]);
    setDistanceMeters(0);
    setStepCount(0);
    setEstimatedSteps(false);
    setElapsedSeconds(0);
    setCurrentSpeedMps(0);
    setGpsAccuracyMeters(null);
    setCurrentLocation(null);
    setCurrentLocationAccuracyMeters(null);
    setBackgroundTrackingStatus("idle");
    setRestoredDraft(false);
    setIsRestoringDraft(false);
    draftOwnerIdRef.current = null;
    setDraftOwnerIdState(null);
    changeState("idle");
  }, [changeState]);

  useEffect(() => {
    if (runState !== "tracking") return;
    const timer = setInterval(() => setElapsedSeconds(snapshotElapsed()), 1000);
    return () => clearInterval(timer);
  }, [runState, snapshotElapsed]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" && runStateRef.current === "tracking") {
        locationSubscription.current?.remove();
        locationSubscription.current = null;
        if (pedometerSubscription.current) {
          pedometerSubscription.current.remove();
          pedometerSubscription.current = null;
          pedometerBaseRef.current = stepRef.current;
        }
        estimatedStepsRef.current = true;
        setEstimatedSteps(true);
        void (async () => {
          try {
            await flushBackgroundLocations();
            await persistWalkDraft();
          } catch {
            // Periodic draft saves remain available if this lifecycle write is interrupted.
          }
        })();
        return;
      }
      if (nextState === "active" && runStateRef.current === "tracking") {
        void (async () => {
          try {
            if (backgroundTrackingActiveRef.current) await flushBackgroundLocations();
            if (runStateRef.current !== "tracking") return;
            const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
            if (runStateRef.current !== "tracking") return;
            onPosition(current);
            await startForegroundLocationSubscription();
          } catch {
            // The foreground watcher remains the fallback if a resume-time fix is unavailable.
            if (runStateRef.current === "tracking") await startForegroundLocationSubscription().catch(() => undefined);
          }
        })();
      }
    });
    return () => subscription.remove();
  }, [flushBackgroundLocations, onPosition, persistWalkDraft, startForegroundLocationSubscription]);

  useEffect(() => () => {
    stopSubscriptions();
    void persistWalkDraft().catch(() => undefined);
  }, [persistWalkDraft, stopSubscriptions]);

  return {
    runState,
    isRestoringDraft,
    restoredDraft,
    draftOwnerId,
    elapsedSeconds,
    distanceMeters,
    stepCount,
    currentSpeedMps,
    gpsAccuracyMeters,
    currentLocation,
    currentLocationAccuracyMeters,
    estimatedSteps,
    backgroundTrackingStatus,
    locationError,
    routeData,
    start,
    pause,
    resume,
    finish,
    clearSavedDraft,
    stopForAccountRemoval,
    discardCurrentAccountDraft,
    setDraftOwnerId,
  };
}

type WalkTrackerValue = ReturnType<typeof useWalkTrackerController>;
const WalkTrackerContext = createContext<WalkTrackerValue | null>(null);

export function WalkTrackerProvider({ children }: PropsWithChildren) {
  const tracker = useWalkTrackerController();
  return createElement(WalkTrackerContext.Provider, { value: tracker }, children);
}

export function useWalkTracker(): WalkTrackerValue {
  const tracker = useContext(WalkTrackerContext);
  if (!tracker) throw new Error("useWalkTracker must be used inside WalkTrackerProvider.");
  return tracker;
}
