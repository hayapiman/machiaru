import { useMemo, useState } from "react";
import { Image, PanResponder, Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import type { RoutePoint } from "@/drizzle/schema";
import { trpc } from "@/lib/trpc";
import { brand, typeface } from "@/lib/brand";

type Coordinate = { latitude: number; longitude: number };
const DEFAULT_CENTER = { latitude: 35.6812, longitude: 139.7671 };

type MapSize = { width: number; height: number };

function worldPosition(point: Coordinate, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const latitude = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180;
  const x = ((point.longitude + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * scale;
  return { x, y };
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

export function StaticMap({
  center = DEFAULT_CENTER,
  zoom = 15,
  routePoints = [],
  routeLines,
  markers = [],
  authenticated = true,
  onMapTap,
  onMapPan,
  height = 270,
}: {
  center?: Coordinate;
  zoom?: number;
  routePoints?: RoutePoint[];
  routeLines?: RoutePoint[][];
  markers?: Coordinate[];
  authenticated?: boolean;
  onMapTap?: (coordinate: Coordinate) => void;
  onMapPan?: (center: Coordinate) => void;
  height?: number;
}) {
  const [dimensions, setDimensions] = useState({ width: 0, height });
  const mapSize = useMemo(() => getMapSize(dimensions.width, dimensions.height), [dimensions.height, dimensions.width]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(onMapTap || onMapPan),
    onMoveShouldSetPanResponder: (_event, gesture) => Boolean(onMapPan && (Math.abs(gesture.dx) > 7 || Math.abs(gesture.dy) > 7)),
    onPanResponderRelease: (event, gesture) => {
      if (onMapPan && (Math.abs(gesture.dx) > 7 || Math.abs(gesture.dy) > 7)) {
        onMapPan(centerAfterPan(gesture.dx, gesture.dy, dimensions.width, dimensions.height, center, zoom, mapSize.width, mapSize.height));
      } else if (onMapTap && dimensions.width > 0) {
        const { locationX, locationY } = event.nativeEvent;
        onMapTap(coordinateAtPoint(locationX, locationY, dimensions.width, dimensions.height, center, zoom, mapSize.width, mapSize.height));
      }
    },
  }), [center, dimensions.height, dimensions.width, mapSize.height, mapSize.width, onMapPan, onMapTap, zoom]);
  const markerInput = useMemo(() => markers.slice(0, 200), [markers]);
  const mapQuery = trpc.map.image.useQuery(
    { center, zoom, routePoints: [], markers: markerInput, size: mapSize },
    { enabled: authenticated && dimensions.width > 0, staleTime: 60000, retry: false },
  );
  const centerWorld = worldPosition(center, zoom);
  const routeSets = (routeLines ?? [routePoints]).flatMap(splitRoute);
  const routeCoordinates = routeSets.map((line) => line.map((point) => {
    const world = worldPosition(point, zoom);
    const x = dimensions.width / 2 + (world.x - centerWorld.x) * (dimensions.width / mapSize.width);
    const y = dimensions.height / 2 + (world.y - centerWorld.y) * (dimensions.height / mapSize.height);
    return `${x},${y}`;
  }).join(" ")).filter((points) => points.length > 0);

  return (
    <View
      {...panResponder.panHandlers}
      accessible
      accessibilityLabel="地図。タップして訪問スポットを追加"
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
        <View style={{ flex: 1, backgroundColor: "#EAE8DF", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{mapQuery.isLoading ? "地図をひらいています" : "地図を表示できません"}</Text>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, textAlign: "center", marginTop: 5 }}>
            {mapQuery.isError ? "通信状況を確認して再読み込みしてください" : "位置情報を許可すると歩いた道が見えてきます"}
          </Text>
        </View>
      )}
      {dimensions.width > 0 && routeCoordinates.length ? (
        <Svg pointerEvents="none" style={{ position: "absolute", inset: 0 }} width="100%" height="100%">
          {routeCoordinates.map((points, index) => <Polyline key={`route-${index}`} points={points} fill="none" stroke={brand.terracotta} strokeOpacity={Math.max(0.5, 0.9 - index * 0.04)} strokeWidth={index === 0 ? 5 : 3.5} strokeLinecap="round" strokeLinejoin="round" />)}
        </Svg>
      ) : null}
      <View pointerEvents="none" style={{ position: "absolute", right: 10, bottom: 9, backgroundColor: "rgba(255,252,246,0.88)", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: brand.muted, fontSize: 9, fontFamily: typeface.medium }}>Google Maps</Text>
      </View>
    </View>
  );
}

export { DEFAULT_CENTER };
