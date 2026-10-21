import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LoginGate } from "@/components/login-gate";
import { AppButton, Card, EmptyNote, Heading, Metric, Page, Tag, formatDistance, formatDuration } from "@/components/machiaru-ui";
import { useAuth } from "@/hooks/use-auth";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(date));
}

function RecordsList() {
  const query = trpc.walks.list.useQuery(undefined, { staleTime: 20000 });
  const walks = query.data ?? [];
  const totalDistance = walks.reduce((sum, walk) => sum + walk.distanceMeters, 0);
  const totalSteps = walks.reduce((sum, walk) => sum + walk.stepCount, 0);
  return (
    <Page>
      <Heading eyebrow="MY JOURNAL" title="歩いた記録" subtitle="ルートも数字も、あとからゆっくり振り返ろう。" />
      <Card style={{ backgroundColor: "#F9EFD9", gap: 12 }}>
        <Text style={{ color: brand.muted, fontSize: 11, fontFamily: typeface.medium }}>これまでのさんぽ</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Metric label="記録" value={walks.length.toString()} unit="回" accent />
          <Metric label="合計距離" value={formatDistance(totalDistance)} />
          <Metric label="合計歩数" value={totalSteps.toLocaleString("ja-JP")} />
        </View>
      </Card>
      {query.isLoading ? <ActivityIndicator color={brand.terracotta} /> : query.isError ? (
        <Card><EmptyNote title="記録を読み込めません" body="ネットワークを確認して、もう一度開いてください。" /><AppButton label="再読み込み" variant="soft" onPress={() => query.refetch()} /></Card>
      ) : walks.length ? (
        <View style={{ gap: 12 }}>
          {walks.map((walk) => (
            <Pressable
              key={walk.id}
              onPress={() => router.push({ pathname: "/walk/[id]", params: { id: String(walk.id) } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.86 : 1 })}
            >
              <Card style={{ gap: 13, padding: 15 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 15 }}>{walk.title || "街歩き"}</Text>
                  <Tag tone={walk.visibility === "group" ? "green" : "paper"}>{walk.visibility === "group" ? "グループ共有" : "自分のみ"}</Tag>
                </View>
                <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{formatDate(walk.startedAt)}</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderColor: "#EFE4D5" }}>
                  <Metric label="距離" value={formatDistance(walk.distanceMeters)} accent />
                  <Metric label="時間" value={formatDuration(walk.durationSeconds)} />
                  <Metric label="歩数" value={walk.stepCount.toLocaleString("ja-JP")} />
                  <View style={{ justifyContent: "center" }}><Ionicons name="chevron-forward" size={18} color={brand.muted} /></View>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : (
        <Card><EmptyNote title="まだ歩行記録はありません" body="地図タブで「歩行を記録する」を押して、最初のさんぽを残してみましょう。" /></Card>
      )}
    </Page>
  );
}

export default function RecordsScreen() {
  const { user, loading } = useAuth();
  if (loading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <LoginGate />;
  return <RecordsList />;
}
