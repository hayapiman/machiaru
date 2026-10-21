import { describe, expect, it } from "vitest";
import type { RoutePoint } from "../drizzle/schema";
import {
  haversineMeters,
  isPlausibleWalkSegment,
  medianSpeed,
  movementThresholdMeters,
  splitRouteAtGaps,
  stabilizedSegmentSpeed,
} from "../lib/walk-metrics";

const point = (latitude: number, longitude: number, timestamp: number, breakBefore = false): RoutePoint => ({
  latitude,
  longitude,
  timestamp,
  speedMps: null,
  ...(breakBefore ? { breakBefore: true } : {}),
});

describe("walk metrics", () => {
  it("calculates short geographic distances in meters", () => {
    expect(haversineMeters(point(0, 0, 0), point(0.001, 0, 1))).toBeCloseTo(111.2, 0);
    expect(haversineMeters(point(35.6, 139.7, 0), point(35.6, 139.7, 1))).toBe(0);
  });

  it("adapts the deadband to GPS accuracy and caps it", () => {
    expect(movementThresholdMeters(8, 10)).toBe(2);
    expect(movementThresholdMeters(25, 35)).toBe(4);
  });

  it("accepts normal walking segments but rejects jitter and implausible jumps", () => {
    expect(isPlausibleWalkSegment(3.2, 2.5, 2.2)).toBe(true);
    expect(isPlausibleWalkSegment(1.2, 2.5, 2.2)).toBe(false);
    expect(isPlausibleWalkSegment(40, 2, 2.2)).toBe(false);
    expect(isPlausibleWalkSegment(30, 30, 2.2)).toBe(false);
  });

  it("uses the device speed only when it agrees with the GPS segment", () => {
    expect(stabilizedSegmentSpeed(1.2, 1.6)).toBeCloseTo(1.3);
    expect(stabilizedSegmentSpeed(1.2, 20)).toBe(1.2);
    expect(stabilizedSegmentSpeed(1.2, null)).toBe(1.2);
  });

  it("uses a rolling median to suppress one noisy speed sample", () => {
    expect(medianSpeed([1.0, 1.2, 12, 1.1, 1.3])).toBe(1.2);
  });

  it("splits route lines after long gaps without discarding points", () => {
    const route = [
      point(35.6, 139.7, 0),
      point(35.601, 139.7, 1),
      point(35.61, 139.7, 30, true),
      point(35.611, 139.7, 31),
    ];
    expect(splitRouteAtGaps(route)).toEqual([[route[0], route[1]], [route[2], route[3]]]);
  });
});
