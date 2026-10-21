import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { AppButton, Card, EmptyNote, Heading, Metric, Page, Tag, formatDistance, formatDuration } from "@/components/machiaru-ui";
import { StaticMap, DEFAULT_CENTER } from "@/components/map/static-map";
import { useAuth } from "@/hooks/use-auth";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";

export default function WalkDetailScreen() {
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const walkId = Number(rawId);
  const query = trpc.walks.detail.useQuery({ id: walkId }, { enabled: Boolean(user && Number.isSafeInteger(walkId) && walkId > 0) });
  const walk = query.data;
  const routePoints = useMemo(() => walk?.routeData ?? [], [walk?.routeData]);

  const { center, zoom } = useMemo(() => {
    if (!routePoints.length) return { center: DEFAULT_CENTER, zoom: 15 };
    const latitudes = routePoints.map((point) => point.latitude);
    const longitudes = routePoints.map((point) => point.longitude);
    const latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
    const longitude = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
    const spread = Math.max(Math.max(...latitudes) - Math.min(...latitudes), (Math.max(...longitudes) - Math.min(...longitudes)) * Math.cos(latitude * Math.PI / 180), 0.004);
    const fittedZoom = Math.max(9, Math.min(18, Math.floor(Math.log2(900 / spread))));
    return { center: { latitude, longitude }, zoom: fittedZoom };
  }, [routePoints]);

  if (authLoading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <Page><Heading title="ログインが必要です" subtitle="記録の閲覧にはログインしてください。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;
  if (!Number.isSafeInteger(walkId) || walkId < 1) return <Page><EmptyNote title="記録が見つかりません" body="URLを確認してください。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;
  if (query.isLoading) return <Page><ActivityIndicator color={brand.terracotta} /><Text style={{ color: brand.muted, textAlign: "center", fontFamily: typeface.regular }}>歩行記録をひらいています</Text></Page>;
  if (query.isError || !walk) return <Page><Heading title="この記録を表示できません" subtitle="削除されたか、閲覧できるグループに参加していない可能性があります。" /><AppButton label="戻る" variant="outline" onPress={() => router.back()} /></Page>;

  return (
    <Page>
      <Pressable onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 3 }}><Ionicons name="chevron-back" size={18} color={brand.terracotta} /><Text style={{ color: brand.terracotta, fontFamily: typeface.bold, fontSize: 12 }}>戻る</Text></Pressable>
      <Heading eyebrow="WALK DETAIL" title={walk.title || "街歩き"} subtitle={new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeStyle: "short" }).format(new Date(walk.startedAt))} right={<Tag tone={walk.visibility === "group" ? "green" : "paper"}>{walk.visibility === "group" ? "グループ共有" : "自分のみ"}</Tag>} />
      <StaticMap center={center} zoom={zoom} routePoints={routePoints} height={300} />
      <Card style={{ gap: 16 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 15 }}>この日の歩み</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Metric label="距離" value={formatDistance(walk.distanceMeters)} accent />
          <Metric label="歩いた時間" value={formatDuration(walk.durationSeconds)} />
          <Metric label="歩数" value={walk.stepCount.toLocaleString("ja-JP")} />
        </View>
        <View style={{ height: 1, backgroundColor: brand.line }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="speedometer-outline" size={18} color={brand.terracotta} /><Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12 }}>平均速度　{(walk.averageSpeedMps * 3.6).toFixed(1)} km/h</Text></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="navigate-outline" size={18} color={brand.terracotta} /><Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12 }}>記録したルート　{routePoints.length} ポイント</Text></View>
      </Card>
    </Page>
  );
}
