import { useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Polyline } from "react-native-svg";
import type { RoutePoint } from "@/drizzle/schema";
import { trpc } from "@/lib/trpc";
import { brand, typeface } from "@/lib/brand";

type Coordinate = { latitude: number; longitude: number };
const DEFAULT_CENTER = { latitude: 35.6812, longitude: 139.7671 };
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const EARTH_CIRCUMFERENCE_METERS = 40_075_017;

type MapSize = { width: number; height: number };

function worldPosition(point: Coordinate, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const latitude = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180;
  const x = ((point.longitude + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * scale;
  return { x, y };
}

function screenPosition(point: Coordinate, center: Coordinate, zoom: number, width: number, height: number, mapSize: MapSize) {
  const centerWorld = worldPosition(center, zoom);
  const world = worldPosition(point, zoom);
  return {
    x: width / 2 + (world.x - centerWorld.x) * (width / mapSize.width),
    y: height / 2 + (world.y - centerWorld.y) * (height / mapSize.height),
  };
}

export function coordinateAtPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  center: Coordinate,
  zoom: number,
  mapWidth = 640,
  mapHeight = 480,
): Coordinate {
  const worldSize = 256 * 2 ** zoom;
  const centerWorld = worldPosition(center, zoom);
  const worldX = centerWorld.x + (x / Math.max(1, width) - 0.5) * mapWidth;
  const worldY = centerWorld.y + (y / Math.max(1, height) - 0.5) * mapHeight;
  const longitude = (worldX / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * worldY) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude: Math.max(-180, Math.min(180, longitude)) };
}

function centerAfterPan(
  dx: number,
  dy: number,
  width: number,
  height: number,
  center: Coordinate,
  zoom: number,
  mapWidth: number,
  mapHeight: number,
): Coordinate {
  const worldSize = 256 * 2 ** zoom;
  const centerWorld = worldPosition(center, zoom);
  const worldX = centerWorld.x - (dx / Math.max(1, width)) * mapWidth;
  const worldY = centerWorld.y - (dy / Math.max(1, height)) * mapHeight;
  const longitude = (worldX / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * worldY) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude: Math.max(-85, Math.min(85, latitude)), longitude: Math.max(-180, Math.min(180, longitude)) };
}

function getMapSize(width: number, height: number): MapSize {
  if (width < 1 || height < 1) return { width: 640, height: 480 };
  let mapWidth = 640;
  let mapHeight = Math.round((mapWidth * height) / width);
  if (mapHeight > 640) {
    mapHeight = 640;
    mapWidth = Math.max(1, Math.round((mapHeight * width) / height));
  }
  return { width: mapWidth, height: mapHeight };
}

function splitRoute(points: RoutePoint[]): RoutePoint[][] {
  const lines: RoutePoint[][] = [];
  for (const point of points) {
    if (!lines.length || point.breakBefore) lines.push([]);
    lines[lines.length - 1].push(point);
  }
  return lines.filter((line) => line.length > 0);
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function StaticMap({
  center = DEFAULT_CENTER,
  zoom = 15,
  routePoints = [],
  routeLines,
  markers = [],
  currentLocation,
  currentLocationAccuracyMeters,
  authenticated = true,
  onMapTap,
  onMapPan,
  onZoomChange,
  height = 270,
  routeWidth = 5,
}: {
  center?: Coordinate;
  zoom?: number;
  routePoints?: RoutePoint[];
  routeLines?: RoutePoint[][];
  markers?: Coordinate[];
  currentLocation?: Coordinate | null;
  currentLocationAccuracyMeters?: number | null;
  authenticated?: boolean;
  onMapTap?: (coordinate: Coordinate) => void;
  onMapPan?: (center: Coordinate) => void;
  onZoomChange?: (zoom: number) => void;
  height?: number;
  routeWidth?: number;
}) {
  const [dimensions, setDimensions] = useState({ width: 0, height });
  const activeCenter = center;
  const activeZoom = zoom;
  const mapSize = useMemo(() => getMapSize(dimensions.width, dimensions.height), [dimensions.height, dimensions.width]);
  const markerInput = useMemo(() => markers.slice(0, 200), [markers]);
  const mapQuery = trpc.map.image.useQuery(
    { center: activeCenter, zoom: activeZoom, routePoints: [], markers: markerInput, size: mapSize },
    { enabled: authenticated && dimensions.width > 0, staleTime: 60000, retry: false },
  );

  const mapGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(Boolean(onMapPan))
      .maxPointers(1)
      .minDistance(7)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success || dimensions.width < 1) return;
        const nextCenter = centerAfterPan(
          event.translationX,
          event.translationY,
          dimensions.width,
          dimensions.height,
          activeCenter,
          activeZoom,
          mapSize.width,
          mapSize.height,
        );
        onMapPan?.(nextCenter);
      });

    const tap = Gesture.Tap()
      .enabled(Boolean(onMapTap))
      .maxDistance(7)
      .maxDuration(350)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success || !onMapTap || dimensions.width < 1) return;
        onMapTap(coordinateAtPoint(
          event.x,
          event.y,
          dimensions.width,
          dimensions.height,
          activeCenter,
          activeZoom,
          mapSize.width,
          mapSize.height,
        ));
      });

    const pinch = Gesture.Pinch()
      .enabled(Boolean(onZoomChange))
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success) return;
        const levels = Math.round(Math.log2(event.scale));
        if (!levels) return;
        onZoomChange?.(clampZoom(activeZoom + levels));
      });

    return Gesture.Simultaneous(Gesture.Exclusive(pan, tap), pinch);
  }, [activeCenter, activeZoom, dimensions.height, dimensions.width, mapSize.height, mapSize.width, onMapPan, onMapTap, onZoomChange]);

  const routeSets = (routeLines ?? [routePoints]).flatMap(splitRoute);
  const routeCoordinates = routeSets.map((line) => line.map((point) => {
    const position = screenPosition(point, activeCenter, activeZoom, dimensions.width, dimensions.height, mapSize);
    return `${position.x},${position.y}`;
  }).join(" ")).filter((points) => points.length > 0);

  const currentPosition = currentLocation && dimensions.width > 0
    ? screenPosition(currentLocation, activeCenter, activeZoom, dimensions.width, dimensions.height, mapSize)
    : null;
  const currentPositionVisible = currentPosition
    && currentPosition.x >= -64
    && currentPosition.x <= dimensions.width + 64
    && currentPosition.y >= -64
    && currentPosition.y <= dimensions.height + 64;
  const metersPerWorldPixel = currentLocation
    ? (EARTH_CIRCUMFERENCE_METERS * Math.cos(currentLocation.latitude * Math.PI / 180)) / (256 * 2 ** activeZoom)
    : 0;
  const accuracyRadius = currentLocationAccuracyMeters != null && metersPerWorldPixel > 0
    ? (currentLocationAccuracyMeters / metersPerWorldPixel) * (dimensions.width / mapSize.width)
    : 18;
  const locationHaloSize = Math.max(40, Math.min(128, accuracyRadius * 2));

  return (
    <GestureDetector gesture={mapGesture}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="地図。ドラッグで移動、二本指で拡大縮小。青い点は現在地です。"
        onLayout={(event) => setDimensions({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        style={{ height, borderRadius: 22, overflow: "hidden", backgroundColor: "#EAE8DF", borderWidth: 1, borderColor: brand.line }}
      >
        {mapQuery.data ? (
          <Image
            source={{ uri: `data:${mapQuery.data.mimeType};base64,${mapQuery.data.base64}` }}
            resizeMode="stretch"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <View pointerEvents="none" style={{ flex: 1, backgroundColor: "#EAE8DF", alignItems: "center", justifyContent: "center", padding: 22 }}>
            <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{mapQuery.isLoading ? "地図をひらいています" : "地図を表示できません"}</Text>
            <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, textAlign: "center", marginTop: 5 }}>
              {mapQuery.isError ? "通信状況を確認して再読み込みしてください" : "位置情報を許可すると歩いた道が見えてきます"}
            </Text>
          </View>
        )}
        {dimensions.width > 0 && routeCoordinates.length ? (
          <Svg pointerEvents="none" style={{ position: "absolute", inset: 0 }} width="100%" height="100%">
            {routeCoordinates.map((points, index) => <Polyline key={`route-${index}`} points={points} fill="none" stroke={brand.terracotta} strokeOpacity={Math.max(0.5, 0.9 - index * 0.04)} strokeWidth={routeWidth} strokeLinecap="round" strokeLinejoin="round" />)}
          </Svg>
        ) : null}
        {currentPositionVisible && currentPosition ? (
          <View
            pointerEvents="none"
            accessible
            accessibilityRole="image"
            accessibilityLabel={currentLocationAccuracyMeters == null ? "現在地" : `現在地、精度約${Math.round(currentLocationAccuracyMeters)}メートル`}
            style={{ position: "absolute", left: currentPosition.x - locationHaloSize / 2, top: currentPosition.y - locationHaloSize / 2, width: locationHaloSize, height: locationHaloSize, borderRadius: locationHaloSize / 2, backgroundColor: "rgba(37, 111, 214, 0.17)", borderWidth: 2, borderColor: "rgba(37, 111, 214, 0.35)", alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 21, height: 21, borderRadius: 11, backgroundColor: "#256FD6", borderWidth: 4, borderColor: "#FFFFFF", shadowColor: "#123B73", shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 5 }} />
          </View>
        ) : null}
        <View pointerEvents="none" style={{ position: "absolute", right: 10, bottom: 9, backgroundColor: "rgba(255,252,246,0.88)", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: brand.muted, fontSize: 9, fontFamily: typeface.medium }}>Google Maps</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

export { DEFAULT_CENTER };
