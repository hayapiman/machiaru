import type { RoutePoint } from "@/drizzle/schema";

export const MAX_TRACKED_GPS_ACCURACY_METERS = 45;
export const MAX_PLAUSIBLE_WALK_SPEED_MPS = 7;
export const MAX_TRACK_SEGMENT_SECONDS = 20;

export function haversineMeters(
  a: Pick<RoutePoint, "latitude" | "longitude">,
  b: Pick<RoutePoint, "latitude" | "longitude">,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function movementThresholdMeters(previousAccuracy: number, currentAccuracy: number): number {
  const averageAccuracy = (previousAccuracy + currentAccuracy) / 2;
  return Math.max(2, Math.min(4, averageAccuracy * 0.22));
}

export function isPlausibleWalkSegment(distanceMeters: number, seconds: number, thresholdMeters: number): boolean {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TRACK_SEGMENT_SECONDS) {
    return false;
  }
  if (distanceMeters < thresholdMeters || distanceMeters <= 0) return false;
  return distanceMeters / seconds <= MAX_PLAUSIBLE_WALK_SPEED_MPS;
}

export function stabilizedSegmentSpeed(derivedSpeedMps: number, deviceSpeedMps: number | null): number {
  if (!Number.isFinite(derivedSpeedMps) || derivedSpeedMps <= 0) return 0;
  if (
    deviceSpeedMps === null ||
    !Number.isFinite(deviceSpeedMps) ||
    deviceSpeedMps < 0 ||
    deviceSpeedMps > MAX_PLAUSIBLE_WALK_SPEED_MPS ||
    Math.abs(deviceSpeedMps - derivedSpeedMps) > 2.5
  ) {
    return derivedSpeedMps;
  }
  return derivedSpeedMps * 0.75 + deviceSpeedMps * 0.25;
}

export function medianSpeed(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function splitRouteAtGaps(points: RoutePoint[]): RoutePoint[][] {
  const segments: RoutePoint[][] = [];
  for (const point of points) {
    if (!segments.length || point.breakBefore) segments.push([]);
    segments[segments.length - 1].push(point);
  }
  return segments.filter((segment) => segment.length > 0);
}
