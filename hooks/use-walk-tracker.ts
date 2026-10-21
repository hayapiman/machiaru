import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
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

type RunState = "idle" | "tracking" | "paused";
type AccurateFix = RoutePoint & { accuracyMeters: number };
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

export function useWalkTracker() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [currentSpeedMps, setCurrentSpeedMps] = useState(0);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [estimatedSteps, setEstimatedSteps] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RoutePoint[]>([]);
  const estimatedStepsRef = useRef(false);
  const routeRef = useRef<RoutePoint[]>([]);
  const distanceRef = useRef(0);
  const stepRef = useRef(0);
  const pedometerBaseRef = useRef(0);
  const distanceAnchorRef = useRef<AccurateFix | null>(null);
  const speedSamplesRef = useRef<number[]>([]);
  const lastMovementAtRef = useRef(0);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const pedometerSubscription = useRef<{ remove: () => void } | null>(null);
  const runStateRef = useRef<RunState>("idle");
  const startedAtRef = useRef(0);
  const elapsedBeforeActiveRef = useRef(0);
  const activeSinceRef = useRef(0);

  const changeState = (next: RunState) => {
    runStateRef.current = next;
    setRunState(next);
  };

  const snapshotElapsed = useCallback(() => {
    if (runStateRef.current !== "tracking") return elapsedBeforeActiveRef.current;
    return elapsedBeforeActiveRef.current + Math.max(0, Math.floor((Date.now() - activeSinceRef.current) / 1000));
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
    const rawAccuracy = position.coords.accuracy;
    const accuracy = rawAccuracy !== null && Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : null;
    setGpsAccuracyMeters(accuracy);
    const now = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now();

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
      return;
    }

    const segmentSpeed = segmentMeters / seconds;
    if (segmentSpeed > MAX_PLAUSIBLE_WALK_SPEED_MPS) {
      distanceAnchorRef.current = currentFix;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      setCurrentSpeedMps(0);
      appendRoutePoint({ ...point, breakBefore: true });
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
    lastMovementAtRef.current = now;

    if (estimatedStepsRef.current) {
      const estimate = Math.round(distanceRef.current / ESTIMATED_STRIDE_METERS);
      stepRef.current = estimate;
      setStepCount(estimate);
    }

    const speed = stabilizedSegmentSpeed(segmentSpeed, position.coords.speed);
    speedSamplesRef.current = [...speedSamplesRef.current, speed].slice(-5);
    const smoothedSpeed = medianSpeed(speedSamplesRef.current);
    setCurrentSpeedMps(smoothedSpeed);
    appendRoutePoint({ ...point, speedMps: smoothedSpeed });
  }, [appendRoutePoint, clearSpeedIfStale]);

  const startSubscriptions = useCallback(async () => {
    const currentPermission = await Location.getForegroundPermissionsAsync();
    const permission = currentPermission.granted
      ? currentPermission
      : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error("歩行ルートを記録するには位置情報の使用を許可してください。");

    distanceAnchorRef.current = null;
    try {
      const available = Platform.OS !== "web" && await Pedometer.isAvailableAsync();
      estimatedStepsRef.current = !available;
      setEstimatedSteps(!available);
      if (available) {
        pedometerSubscription.current = Pedometer.watchStepCount(({ steps }) => {
          stepRef.current = pedometerBaseRef.current + steps;
          setStepCount(stepRef.current);
        });
      }
    } catch {
      estimatedStepsRef.current = true;
      setEstimatedSteps(true);
    }

    const accuracy = Location.Accuracy.BestForNavigation;
    const initial = await Location.getCurrentPositionAsync({ accuracy });
    onPosition(initial);
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy,
        timeInterval: 2000,
        distanceInterval: 2,
      },
      onPosition,
    );
  }, [onPosition]);

  const start = useCallback(async () => {
    setLocationError(null);
    try {
      routeRef.current = [];
      setRouteData([]);
      distanceRef.current = 0;
      stepRef.current = 0;
      pedometerBaseRef.current = 0;
      distanceAnchorRef.current = null;
      speedSamplesRef.current = [];
      lastMovementAtRef.current = 0;
      estimatedStepsRef.current = false;
      setEstimatedSteps(false);
      setGpsAccuracyMeters(null);
      setDistanceMeters(0);
      setStepCount(0);
      setCurrentSpeedMps(0);
      setElapsedSeconds(0);
      elapsedBeforeActiveRef.current = 0;
      startedAtRef.current = Date.now();
      activeSinceRef.current = startedAtRef.current;
      await startSubscriptions();
      changeState("tracking");
      return true;
    } catch (error) {
      stopSubscriptions();
      setLocationError(error instanceof Error ? error.message : "位置情報を取得できませんでした。");
      changeState("idle");
      return false;
    }
  }, [startSubscriptions, stopSubscriptions]);

  const pause = useCallback(() => {
    if (runStateRef.current !== "tracking") return;
    elapsedBeforeActiveRef.current = snapshotElapsed();
    setElapsedSeconds(elapsedBeforeActiveRef.current);
    stopSubscriptions();
    speedSamplesRef.current = [];
    lastMovementAtRef.current = 0;
    setCurrentSpeedMps(0);
    changeState("paused");
  }, [snapshotElapsed, stopSubscriptions]);

  const resume = useCallback(async () => {
    setLocationError(null);
    try {
      activeSinceRef.current = Date.now();
      await startSubscriptions();
      changeState("tracking");
      return true;
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "位置情報を再開できませんでした。");
      return false;
    }
  }, [startSubscriptions]);

  const finish = useCallback((): WalkResult | null => {
    if (runStateRef.current === "idle" || !startedAtRef.current) return null;
    const endedAt = Date.now();
    const durationSeconds = Math.max(1, snapshotElapsed());
    stopSubscriptions();
    changeState("idle");
    setCurrentSpeedMps(0);
    setElapsedSeconds(durationSeconds);
    return {
      startedAt: startedAtRef.current,
      endedAt,
      durationSeconds,
      distanceMeters: distanceRef.current,
      stepCount: estimatedStepsRef.current
        ? Math.round(distanceRef.current / ESTIMATED_STRIDE_METERS)
        : stepRef.current,
      routeData: [...routeRef.current],
    };
  }, [snapshotElapsed, stopSubscriptions]);

  useEffect(() => {
    if (runState !== "tracking") return;
    const timer = setInterval(() => setElapsedSeconds(snapshotElapsed()), 1000);
    return () => clearInterval(timer);
  }, [runState, snapshotElapsed]);

  useEffect(() => () => stopSubscriptions(), [stopSubscriptions]);

  return {
    runState,
    elapsedSeconds,
    distanceMeters,
    stepCount,
    currentSpeedMps,
    gpsAccuracyMeters,
    estimatedSteps,
    locationError,
    routeData,
    start,
    pause,
    resume,
    finish,
  };
}
