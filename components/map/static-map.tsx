import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import Svg, { Polyline } from "react-native-svg";
import type { RoutePoint } from "@/drizzle/schema";
import { trpc } from "@/lib/trpc";
import { brand, typeface } from "@/lib/brand";

type Coordinate = { latitude: number; longitude: number };
type MapSize = { width: number; height: number };
type StaticMapProps = {
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
};

const DEFAULT_CENTER = { latitude: 35.6812, longitude: 139.7671 };
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const MAX_RENDERED_POINTS_PER_SEGMENT = 900;
const EARTH_CIRCUMFERENCE_METERS = 40_075_017;

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

function sampleRouteForDisplay(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= MAX_RENDERED_POINTS_PER_SEGMENT) return points;
  const sampled: RoutePoint[] = [];
  const stride = (points.length - 1) / (MAX_RENDERED_POINTS_PER_SEGMENT - 1);
  for (let index = 0; index < MAX_RENDERED_POINTS_PER_SEGMENT; index += 1) {
    sampled.push(points[Math.round(index * stride)]);
  }
  return sampled;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function matchesViewport(
  viewport: { center: Coordinate; zoom: number; size: MapSize } | undefined,
  center: Coordinate,
  zoom: number,
  size: MapSize,
): boolean {
  if (!viewport) return false;
  return viewport.center.latitude === center.latitude
    && viewport.center.longitude === center.longitude
    && viewport.zoom === zoom
    && viewport.size.width === size.width
    && viewport.size.height === size.height;
}

export const StaticMap = memo(function StaticMap({
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
}: StaticMapProps) {
  const [dimensions, setDimensions] = useState({ width: 0, height });
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const pinchScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const panCommitted = useSharedValue(false);
  const pinchCommitted = useSharedValue(false);
  const activeGestureCountRef = useRef(0);
  const pendingViewportRef = useRef(false);
  const [mapTransformSettled, setMapTransformSettled] = useState(true);
  const [gestureRevision, setGestureRevision] = useState(0);
  const activeCenter = center;
  const activeZoom = zoom;
  const mapSize = useMemo(() => getMapSize(dimensions.width, dimensions.height), [dimensions.height, dimensions.width]);
  const [queryViewport, setQueryViewport] = useState({ center: activeCenter, zoom: activeZoom, size: mapSize });
  useEffect(() => {
    const timer = setTimeout(() => setQueryViewport({ center: activeCenter, zoom: activeZoom, size: mapSize }), 160);
    return () => clearTimeout(timer);
  }, [activeCenter, activeZoom, mapSize]);
  const markerInput = useMemo(() => markers.slice(0, 200), [markers]);
  const queryInput = useMemo(
    () => ({ center: queryViewport.center, zoom: queryViewport.zoom, routePoints: [], markers: markerInput, size: queryViewport.size }),
    [markerInput, queryViewport],
  );
  const mapQuery = trpc.map.image.useQuery(queryInput, {
    enabled: authenticated && dimensions.width > 0,
    staleTime: 300_000,
    gcTime: 900_000,
    placeholderData: (previousData) => previousData,
    retry: false,
  });
  const displayCenter = mapQuery.data?.center ?? queryViewport.center;
  const displayZoom = mapQuery.data?.zoom ?? queryViewport.zoom;
  const displayMapSize = mapQuery.data?.size ?? queryViewport.size;
  const viewportIsSettled = !mapQuery.isFetching && matchesViewport(mapQuery.data, activeCenter, activeZoom, mapSize);

  const commitPan = useCallback((dx: number, dy: number) => {
    if (!onMapPan || dimensions.width < 1) return;
    const nextCenter = centerAfterPan(
      dx,
      dy,
      dimensions.width,
      dimensions.height,
      activeCenter,
      activeZoom,
      mapSize.width,
      mapSize.height,
    );
    if (Math.abs(nextCenter.latitude - activeCenter.latitude) < 1e-10
      && Math.abs(nextCenter.longitude - activeCenter.longitude) < 1e-10) return;
    pendingViewportRef.current = true;
    setMapTransformSettled(false);
    onMapPan(nextCenter);
  }, [activeCenter, activeZoom, dimensions.height, dimensions.width, mapSize.height, mapSize.width, onMapPan]);

  const commitZoom = useCallback((nextZoom: number) => {
    const boundedZoom = clampZoom(nextZoom);
    if (!onZoomChange || boundedZoom === activeZoom) return;
    pendingViewportRef.current = true;
    setMapTransformSettled(false);
    onZoomChange(boundedZoom);
  }, [activeZoom, onZoomChange]);

  const beginGesture = useCallback(() => {
    activeGestureCountRef.current += 1;
  }, []);

  const finishGesture = useCallback((committed: boolean) => {
    activeGestureCountRef.current = Math.max(0, activeGestureCountRef.current - 1);
    setGestureRevision((revision) => revision + 1);
    if (activeGestureCountRef.current > 0 || committed || pendingViewportRef.current) return;
    if (!matchesViewport(mapQuery.data, activeCenter, activeZoom, mapSize)) return;
    setMapTransformSettled(true);
  }, [activeCenter, activeZoom, mapQuery.data, mapSize]);

  const mapGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(Boolean(onMapPan))
      .maxPointers(1)
      .minDistance(4)
      .onBegin(() => {
        "worklet";
        panStartX.value = panX.value;
        panStartY.value = panY.value;
        panCommitted.value = false;
        runOnJS(beginGesture)();
      })
      .onUpdate((event) => {
        "worklet";
        panX.value = panStartX.value + event.translationX;
        panY.value = panStartY.value + event.translationY;
      })
      .onEnd((event, success) => {
        "worklet";
        if (!success || dimensions.width < 1) {
          panX.value = panStartX.value;
          panY.value = panStartY.value;
          return;
        }
        panCommitted.value = true;
        runOnJS(commitPan)(event.translationX, event.translationY);
      })
      .onFinalize(() => {
        "worklet";
        runOnJS(finishGesture)(panCommitted.value);
      });

    const tap = Gesture.Tap()
      .enabled(Boolean(onMapTap) && viewportIsSettled && mapTransformSettled)
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
          displayCenter,
          displayZoom,
          displayMapSize.width,
          displayMapSize.height,
        ));
      });

    const pinch = Gesture.Pinch()
      .enabled(Boolean(onZoomChange))
      .onBegin(() => {
        "worklet";
        pinchStartScale.value = pinchScale.value;
        pinchCommitted.value = false;
        runOnJS(beginGesture)();
      })
      .onUpdate((event) => {
        "worklet";
        pinchScale.value = pinchStartScale.value * event.scale;
      })
      .onEnd((event, success) => {
        "worklet";
        if (!success) {
          pinchScale.value = pinchStartScale.value;
          return;
        }
        const levels = Math.round(Math.log2(event.scale));
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, activeZoom + levels));
        if (!levels || nextZoom === activeZoom) {
          pinchScale.value = pinchStartScale.value;
          return;
        }
        pinchCommitted.value = true;
        runOnJS(commitZoom)(nextZoom);
      })
      .onFinalize(() => {
        "worklet";
        runOnJS(finishGesture)(pinchCommitted.value);
      });

    return Gesture.Simultaneous(Gesture.Exclusive(pan, tap), pinch);
  }, [
    activeZoom,
    beginGesture,
    commitPan,
    commitZoom,
    dimensions.height,
    dimensions.width,
    displayCenter,
    displayMapSize.height,
    displayMapSize.width,
    displayZoom,
    finishGesture,
    mapTransformSettled,
    onMapPan,
    onMapTap,
    onZoomChange,
    panCommitted,
    panStartX,
    panStartY,
    panX,
    panY,
    pinchCommitted,
    pinchScale,
    pinchStartScale,
    viewportIsSettled,
  ]);

  const animatedMapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { scale: pinchScale.value },
    ],
  }));

  useEffect(() => {
    const loadedViewport = mapQuery.data;
    if (activeGestureCountRef.current > 0 || !matchesViewport(loadedViewport, activeCenter, activeZoom, mapSize)) return;
    pendingViewportRef.current = false;
    panX.value = 0;
    panY.value = 0;
    pinchScale.value = 1;
    setMapTransformSettled(true);
  }, [activeCenter, activeZoom, gestureRevision, mapQuery.data, mapSize, panX, panY, pinchScale]);

  const routeSets = useMemo(
    () => (routeLines ?? [routePoints]).flatMap(splitRoute).map(sampleRouteForDisplay),
    [routeLines, routePoints],
  );
  const routeCoordinates = useMemo(
    () => routeSets.map((line) => line.map((point) => {
      const position = screenPosition(point, displayCenter, displayZoom, dimensions.width, dimensions.height, displayMapSize);
      return `${position.x},${position.y}`;
    }).join(" ")).filter((points) => points.length > 0),
    [dimensions.height, dimensions.width, displayCenter, displayMapSize, displayZoom, routeSets],
  );

  const currentPosition = currentLocation && dimensions.width > 0
    ? screenPosition(currentLocation, displayCenter, displayZoom, dimensions.width, dimensions.height, displayMapSize)
    : null;
  const currentPositionVisible = currentPosition
    && currentPosition.x >= -64
    && currentPosition.x <= dimensions.width + 64
    && currentPosition.y >= -64
    && currentPosition.y <= dimensions.height + 64;
  const metersPerWorldPixel = currentLocation
    ? (EARTH_CIRCUMFERENCE_METERS * Math.cos(currentLocation.latitude * Math.PI / 180)) / (256 * 2 ** displayZoom)
    : 0;
  const accuracyRadius = currentLocationAccuracyMeters != null && metersPerWorldPixel > 0
    ? (currentLocationAccuracyMeters / metersPerWorldPixel) * (dimensions.width / displayMapSize.width)
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
        <Animated.View style={[{ width: "100%", height: "100%" }, animatedMapStyle]}>
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
        </Animated.View>
        {mapQuery.isFetching && mapQuery.data ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,252,246,0.94)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 }}>
            <ActivityIndicator size="small" color={brand.terracotta} />
            <Text style={{ color: brand.ink, fontFamily: typeface.medium, fontSize: 10 }}>地図を更新中</Text>
          </View>
        ) : null}
        {mapQuery.isError && mapQuery.data ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 10, top: 10, backgroundColor: "rgba(255,252,246,0.94)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 }}>
            <Text style={{ color: brand.terracottaDark, fontFamily: typeface.medium, fontSize: 10 }}>地図を更新できません</Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={{ position: "absolute", right: 10, bottom: 9, backgroundColor: "rgba(255,252,246,0.88)", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: brand.muted, fontSize: 9, fontFamily: typeface.medium }}>Google Maps</Text>
        </View>
      </View>
    </GestureDetector>
  );
});

export { DEFAULT_CENTER };
