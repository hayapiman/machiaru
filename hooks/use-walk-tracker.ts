import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import type { RoutePoint } from "@/drizzle/schema";

type RunState = "idle" | "tracking" | "paused";
type WalkResult = {
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distanceMeters: number;
  stepCount: number;
  routeData: RoutePoint[];
};

function distanceBetween(a: RoutePoint, b: RoutePoint) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function useWalkTracker() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [currentSpeedMps, setCurrentSpeedMps] = useState(0);
  const [estimatedSteps, setEstimatedSteps] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RoutePoint[]>([]);
  const estimatedStepsRef = useRef(false);
  const routeRef = useRef<RoutePoint[]>([]);
  const distanceRef = useRef(0);
  const stepRef = useRef(0);
  const pedometerBaseRef = useRef(0);
  const lastPositionRef = useRef<RoutePoint | null>(null);
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

  const onPosition = useCallback((position: Location.LocationObject) => {
    const accuracy = position.coords.accuracy ?? 999;
    if (accuracy > 60) return;
    const now = position.timestamp || Date.now();
    const previous = lastPositionRef.current;
    const point: RoutePoint = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: now,
      speedMps: position.coords.speed,
    };
    let derivedSpeed = 0;
    if (previous) {
      const segment = distanceBetween(previous, point);
      const seconds = Math.max(0.1, (now - previous.timestamp) / 1000);
      // Ignore large GPS jumps rather than inflating a walk.
      if (segment > 0.8 && segment / seconds < 8) {
        distanceRef.current += segment;
        setDistanceMeters(distanceRef.current);
        derivedSpeed = segment / seconds;
        routeRef.current = [...routeRef.current, point];
        setRouteData(routeRef.current);
      }
    } else {
      routeRef.current = [...routeRef.current, point];
      setRouteData(routeRef.current);
    }
    lastPositionRef.current = point;
    const speed = position.coords.speed;
    setCurrentSpeedMps(speed !== null && speed >= 0 ? speed : derivedSpeed);
    if (estimatedStepsRef.current) setStepCount(Math.round(distanceRef.current / 0.72));
  }, []);

  const startSubscriptions = useCallback(async () => {
    const currentPermission = await Location.getForegroundPermissionsAsync();
    const permission = currentPermission.granted
      ? currentPermission
      : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error("歩行ルートを記録するには位置情報の使用を許可してください。");

    lastPositionRef.current = null;
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

    const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    onPosition(initial);
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 2500,
        distanceInterval: 3,
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
      setDistanceMeters(0);
      setStepCount(0);
      setCurrentSpeedMps(0);
      setElapsedSeconds(0);
      elapsedBeforeActiveRef.current = 0;
      startedAtRef.current = Date.now();
      activeSinceRef.current = Date.now();
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
      stepCount: estimatedStepsRef.current ? Math.round(distanceRef.current / 0.72) : stepRef.current,
      routeData: [...routeRef.current],
    };
  }, [estimatedSteps, snapshotElapsed, stopSubscriptions]);

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
    estimatedSteps,
    locationError,
    routeData,
    start,
    pause,
    resume,
    finish,
  };
}
