import { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RoutePoint } from "@/drizzle/schema";
import { StaticMap } from "@/components/map/static-map";
import { Card, Metric, SectionLabel, Tag, formatDistance, formatDuration } from "@/components/machiaru-ui";
import { demoGroupFixture } from "@/lib/demo-group-fixtures";
import { brand, typeface } from "@/lib/brand";

const routeLines: RoutePoint[][] = demoGroupFixture.walks.map((walk) => walk.routeData);
const coordinates = [
  ...routeLines.flat(),
  ...demoGroupFixture.spots.map(({ latitude, longitude }) => ({ latitude, longitude })),
];
const latitudes = coordinates.map((point) => point.latitude);
const longitudes = coordinates.map((point) => point.longitude);
const center = {
  latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
};
const span = Math.max(
  Math.max(...latitudes) - Math.min(...latitudes),
  (Math.max(...longitudes) - Math.min(...longitudes)) * Math.cos(center.latitude * Math.PI / 180),
  0.004,
);
const zoom = Math.max(12, Math.min(17, Math.floor(Math.log2(900 / span))));
const markers = demoGroupFixture.spots.map(({ latitude, longitude }) => ({ latitude, longitude }));

function DemoPhoto({ source, label, credit }: { source: number; label: string; credit: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={{ width: 170, height: 118, borderRadius: 15, backgroundColor: "#F2E6D4", alignItems: "center", justifyContent: "center", gap: 5, padding: 10 }}>
        <Ionicons name="image-outline" size={22} color={brand.terracotta} />
        <Text style={{ color: brand.muted, fontFamily: typeface.medium, fontSize: 10, textAlign: "center" }}>{label}の写真を表示できません</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <Image source={source} accessibilityLabel={label} onError={() => setFailed(true)} resizeMode="cover" style={{ width: 170, height: 118, borderRadius: 15, backgroundColor: "#F2E6D4" }} />
      <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 9 }}>写真素材: {credit}</Text>
    </View>
  );
}

export function DemoGroupPreview() {
  return (
    <Card style={{ gap: 13, borderStyle: "dashed", borderColor: brand.terracotta }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 18 }}>{demoGroupFixture.name}</Text>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>さくら・ゆうと・みお · {demoGroupFixture.members.length}人</Text>
        </View>
        <Tag tone="yellow">{demoGroupFixture.label}</Tag>
      </View>
      <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 17 }}>
        架空の街歩きデータです。共有地図・ルート一覧・写真フィードを試すための表示で、実際の場所や投稿ではなく、データベースにも保存されません。
      </Text>
      <StaticMap center={center} zoom={zoom} routeLines={routeLines} markers={markers} height={215} />

      <SectionLabel aside={<Tag tone="green">グループのみ</Tag>}>みんなの歩行ルート</SectionLabel>
      {demoGroupFixture.walks.map((walk) => (
        <View key={walk.id} style={{ borderTopWidth: 1, borderTopColor: brand.line, paddingTop: 10, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13, flex: 1 }}>{walk.title}</Text>
            <Text style={{ color: brand.muted, fontFamily: typeface.medium, fontSize: 10 }}>{walk.author}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 7 }}>
            <Metric label="距離" value={formatDistance(walk.distanceMeters)} accent />
            <Metric label="時間" value={formatDuration(walk.durationSeconds)} />
            <Metric label="歩数" value={walk.stepCount.toLocaleString("ja-JP")} />
          </View>
        </View>
      ))}

      <SectionLabel aside={<Tag tone="paper">写真つきスポット</Tag>}>寄り道のアルバム</SectionLabel>
      {demoGroupFixture.spots.map((spot) => (
        <View key={spot.id} style={{ borderTopWidth: 1, borderTopColor: brand.line, paddingTop: 11, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13, flex: 1 }}>{spot.title}</Text>
            <Text style={{ color: brand.muted, fontFamily: typeface.medium, fontSize: 10 }}>{spot.author}</Text>
          </View>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{spot.description}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {spot.photos.map((photo) => <DemoPhoto key={photo.id} source={photo.source} label={spot.title} credit={photo.credit} />)}
          </ScrollView>
        </View>
      ))}
    </Card>
  );
}
