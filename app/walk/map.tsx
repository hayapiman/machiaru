import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StaticMap, DEFAULT_CENTER } from "@/components/map/static-map";
import { AppButton, Card, EmptyNote, Metric, Page, formatDistance, formatDuration } from "@/components/machiaru-ui";
import type { RoutePoint } from "@/drizzle/schema";
import { useAuth } from "@/hooks/use-auth";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";

type Coordinate = { latitude: number; longitude: number };

function fitRoute(points: RoutePoint[]) {
  if (!points.length) return { center: DEFAULT_CENTER, zoom: 15 };
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const longitude = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const longitudeSpan = (Math.max(...longitudes) - Math.min(...longitudes)) * Math.cos(latitude * Math.PI / 180);
  const spread = Math.max(Math.max(...latitudes) - Math.min(...latitudes), longitudeSpan, 0.003);
  return {
    center: { latitude, longitude } as Coordinate,
    zoom: Math.max(9, Math.min(18, Math.floor(Math.log2(900 / spread)))),
  };
}

function ZoomButton({ label, icon, onPress }: { label: string; icon: "add" | "remove" | "locate-outline"; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: brand.card, borderWidth: 1, borderColor: brand.line, opacity: pressed ? 0.78 : 1 })}
    >
      <Ionicons name={icon} size={21} color={brand.terracotta} />
    </Pressable>
  );
}

export default function WalkMapScreen() {
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ walkId?: string | string[] }>();
  const rawId = Array.isArray(params.walkId) ? params.walkId[0] : params.walkId;
  const walkId = Number(rawId);
  const validWalkId = Number.isSafeInteger(walkId) && walkId > 0;
  const query = trpc.walks.detail.useQuery({ id: walkId }, { enabled: Boolean(user && validWalkId) });
  const walk = query.data;
  const routePoints = useMemo(() => walk?.routeData ?? [], [walk?.routeData]);
  const fittedRoute = useMemo(() => fitRoute(routePoints), [routePoints]);
  const [manualViewport, setManualViewport] = useState<{ walkId: number; center: Coordinate; zoom: number } | null>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  const viewport = manualViewport?.walkId === walkId ? manualViewport : null;
  const center = viewport?.center ?? fittedRoute.center;
  const zoom = viewport?.zoom ?? fittedRoute.zoom;
  const setViewportCenter = (nextCenter: Coordinate) => setManualViewport({ walkId, center: nextCenter, zoom });
  const setViewportZoom = (nextZoom: number) => setManualViewport({ walkId, center, zoom: nextZoom });

  const mapHeight = Math.max(320, availableHeight - 250);

  if (authLoading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <Page><EmptyNote title="ログインが必要です" body="歩行ルートの閲覧にはログインしてください。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;
  if (!validWalkId) return <Page><EmptyNote title="記録が見つかりません" body="歩行記録を選び直してください。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;
  if (query.isLoading) return <Page><ActivityIndicator color={brand.terracotta} /><Text style={{ color: brand.muted, textAlign: "center", fontFamily: typeface.regular }}>歩いた道をひらいています</Text></Page>;
  if (query.isError || !walk) return <Page><EmptyNote title="このルートを表示できません" body="削除されたか、閲覧できるグループに参加していない可能性があります。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;

  return (
    <SafeAreaView edges={["top", "bottom", "left", "right"]} style={{ flex: 1, backgroundColor: brand.paper }}>
      <View onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)} style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 9 }}>
        <View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="歩行詳細へ戻る"
            onPress={() => router.back()}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: brand.card, borderWidth: 1, borderColor: brand.line, opacity: pressed ? 0.78 : 1 })}
          >
            <Ionicons name="chevron-back" size={23} color={brand.terracotta} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: brand.terracotta, fontFamily: typeface.bold, fontSize: 10, letterSpacing: 1 }}>WALK ROUTE</Text>
            <Text numberOfLines={1} style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 17 }}>{walk.title || "街歩きのルート"}</Text>
            <Text numberOfLines={1} style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(walk.startedAt))}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, flex: 1 }}>ドラッグで移動・二本指で拡大縮小</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ZoomButton label="地図を縮小" icon="remove" onPress={() => setViewportZoom(Math.max(3, zoom - 1))} />
            <ZoomButton label="地図を拡大" icon="add" onPress={() => setViewportZoom(Math.min(19, zoom + 1))} />
            <ZoomButton label="ルート全体を表示" icon="locate-outline" onPress={() => setManualViewport(null)} />
          </View>
        </View>

        <StaticMap
          center={center}
          zoom={zoom}
          routePoints={routePoints}
          height={mapHeight}
          routeWidth={6}
          onMapPan={setViewportCenter}
          onZoomChange={setViewportZoom}
        />

        <Card style={{ paddingVertical: 12, gap: 9 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Metric label="距離" value={formatDistance(walk.distanceMeters)} accent />
            <Metric label="歩いた時間" value={formatDuration(walk.durationSeconds)} />
            <Metric label="歩数" value={walk.stepCount.toLocaleString("ja-JP")} />
          </View>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>テラコッタ色の線が、この日に歩いた道です。</Text>
        </Card>
      </View>
    </SafeAreaView>
  );
}
