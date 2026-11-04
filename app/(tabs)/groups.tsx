import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LoginGate } from "@/components/login-gate";
import { AppButton, Card, EmptyNote, Heading, Metric, Page, SectionLabel, Tag, formatDistance, formatDuration } from "@/components/machiaru-ui";
import { StaticMap, DEFAULT_CENTER } from "@/components/map/static-map";
import { SpotPhoto } from "@/components/spot-photo";
import { useAuth } from "@/hooks/use-auth";
import { DemoGroupPreview } from "@/components/demo-group-preview";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";
import type { RoutePoint } from "@/drizzle/schema";

type ReportTarget = { targetType: "walk" | "spot" | "user"; targetId: number; title: string };
type ReportReason = "inappropriate" | "harassment" | "privacy" | "spam" | "other";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "inappropriate", label: "不適切" },
  { value: "harassment", label: "嫌がらせ" },
  { value: "privacy", label: "プライバシー" },
  { value: "spam", label: "スパム" },
  { value: "other", label: "その他" },
];
const fieldStyle = { minHeight: 46, borderWidth: 1, borderColor: brand.line, borderRadius: 13, paddingHorizontal: 13, color: brand.ink, fontFamily: typeface.regular, backgroundColor: brand.paperLight };

function reduceRoute(points: RoutePoint[], maximum = 150) {
  if (points.length <= maximum) return points;
  const stride = (points.length - 1) / (maximum - 1);
  const sampled = Array.from({ length: maximum }, (_, index) => points[Math.round(index * stride)]);
  const important = points.filter((point) => point.breakBefore);
  return [...new Map([...sampled, ...important].map((point) => [point.timestamp, point])).values()]
    .sort((a, b) => a.timestamp - b.timestamp);
}

function GroupsContent() {
  const utils = trpc.useUtils();
  const auth = useAuth();
  const groupQuery = trpc.groups.list.useQuery(undefined, { staleTime: 15000 });
  const groups = useMemo(() => groupQuery.data ?? [], [groupQuery.data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<{ userId: number; name: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedGroup = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null;
  const groupId = selectedGroup?.id ?? 0;
  const feedQuery = trpc.groups.feed.useQuery({ groupId }, { enabled: Boolean(selectedGroup), staleTime: 15000 });
  const membersQuery = trpc.groups.members.useQuery({ groupId }, { enabled: Boolean(selectedGroup), staleTime: 30000 });
  const owner = selectedGroup?.role === "owner";
  const pendingQuery = trpc.groups.pendingContent.useQuery({ groupId }, { enabled: Boolean(owner && selectedGroup), staleTime: 5000 });
  const reportsQuery = trpc.groups.openReports.useQuery({ groupId }, { enabled: Boolean(owner && selectedGroup), staleTime: 5000 });
  const createGroup = trpc.groups.create.useMutation();
  const joinGroup = trpc.groups.join.useMutation();
  const removeMember = trpc.groups.removeMember.useMutation();
  const blockMember = trpc.groups.blockMember.useMutation();
  const unblockMember = trpc.groups.unblockMember.useMutation();
  const reportContent = trpc.groups.reportContent.useMutation();
  const reviewContent = trpc.groups.reviewContent.useMutation();
  const resolveReport = trpc.groups.resolveReport.useMutation();
  const feed = feedQuery.data;
  const members = membersQuery.data ?? [];

  const refreshGroupSafetyData = async () => {
    await Promise.all([
      utils.groups.list.invalidate(),
      utils.groups.feed.invalidate({ groupId }),
      utils.groups.members.invalidate({ groupId }),
      utils.groups.pendingContent.invalidate({ groupId }),
      utils.groups.openReports.invalidate({ groupId }),
      utils.spots.list.invalidate(),
    ]);
  };

  const mapRoutes = useMemo(
    () => feed?.walks.slice(0, 10).map((walk) => reduceRoute(walk.routeData)).filter((points) => points.length > 1) ?? [],
    [feed?.walks],
  );
  const mapCoordinates = useMemo(
    () => [...mapRoutes.flat(), ...(feed?.spots ?? []).map(({ latitude, longitude }) => ({ latitude, longitude }))],
    [mapRoutes, feed?.spots],
  );
  const mapCenter = useMemo(() => {
    if (!mapCoordinates.length) return DEFAULT_CENTER;
    const latitudes = mapCoordinates.map((point) => point.latitude);
    const longitudes = mapCoordinates.map((point) => point.longitude);
    return {
      latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
      longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    };
  }, [mapCoordinates]);
  const mapZoom = useMemo(() => {
    if (!mapCoordinates.length) return 14;
    const latitudes = mapCoordinates.map((point) => point.latitude);
    const longitudes = mapCoordinates.map((point) => point.longitude);
    const span = Math.max(
      Math.max(...latitudes) - Math.min(...latitudes),
      (Math.max(...longitudes) - Math.min(...longitudes)) * Math.cos(mapCenter.latitude * Math.PI / 180),
      0.004,
    );
    return Math.max(4, Math.min(17, Math.floor(Math.log2(900 / span))));
  }, [mapCoordinates, mapCenter.latitude]);
  const mapMarkers = useMemo(() => (feed?.spots ?? []).map((spot) => ({ latitude: spot.latitude, longitude: spot.longitude })), [feed?.spots]);

  const onCreate = async () => {
    if (!groupName.trim()) return setMessage("グループ名を入力してください。");
    setBusy(true);
    setMessage("");
    try {
      const result = await createGroup.mutateAsync({ name: groupName.trim() });
      setGroupName("");
      setSelectedId(result.id);
      await utils.groups.list.invalidate();
      setMessage(`「${result.name}」を作りました。招待コードを友だちに共有できます。`);
    } catch {
      setMessage("グループを作れませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    if (!inviteCode.trim()) return setMessage("招待コードを入力してください。");
    setBusy(true);
    setMessage("");
    try {
      const result = await joinGroup.mutateAsync({ inviteCode: inviteCode.trim() });
      setInviteCode("");
      setSelectedId(result.id);
      await utils.groups.list.invalidate();
      setMessage(`「${result.name}」に参加しました。`);
    } catch {
      setMessage("招待コードを確認できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId: number) => {
    if (!selectedGroup) return;
    try {
      await removeMember.mutateAsync({ groupId: selectedGroup.id, userId });
      await refreshGroupSafetyData();
      setMessage("メンバーをグループから外しました。");
    } catch {
      setMessage("メンバーを更新できませんでした。");
    }
  };

  const onBlock = async (userId: number, isBlocking: boolean) => {
    if (!selectedGroup) return;
    try {
      if (isBlocking) await unblockMember.mutateAsync({ groupId: selectedGroup.id, userId });
      else await blockMember.mutateAsync({ groupId: selectedGroup.id, userId });
      await refreshGroupSafetyData();
      setMessage(isBlocking ? "ブロックを解除しました。" : "ブロックしました。互いの共有フィードと写真は表示されません。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ブロック設定を更新できませんでした。");
    }
  };

  const submitReport = async () => {
    if (!selectedGroup || !reportTarget) return;
    setBusy(true);
    try {
      await reportContent.mutateAsync({
        groupId: selectedGroup.id,
        ...reportTarget,
        reason: reportReason,
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
      });
      setReportTarget(null);
      setReportDetails("");
      setReportReason("inappropriate");
      await utils.groups.openReports.invalidate({ groupId: selectedGroup.id });
      setMessage("通報を受け付けました。グループ作成者が内容を確認します。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通報を送信できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const onReview = async (targetType: "walk" | "spot", targetId: number, decision: "approve" | "reject") => {
    if (!selectedGroup) return;
    try {
      await reviewContent.mutateAsync({ groupId: selectedGroup.id, targetType, targetId, decision });
      await refreshGroupSafetyData();
      setMessage(decision === "approve" ? "投稿を承認しました。グループメンバーに表示されます。" : "投稿を非公開にしました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "投稿を更新できませんでした。");
    }
  };

  const onResolveReport = async (reportId: number, decision: "dismiss" | "remove" | "block") => {
    if (!selectedGroup) return;
    try {
      await resolveReport.mutateAsync({ groupId: selectedGroup.id, reportId, decision });
      await refreshGroupSafetyData();
      setMessage(decision === "dismiss" ? "通報を確認済みにしました。" : decision === "remove" ? "共有投稿を非公開にしました。" : "対象利用者をブロックしました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通報への対応を保存できませんでした。");
    }
  };

  return (
    <Page>
      <Heading eyebrow="WALK TOGETHER" title="みんなの街歩き" subtitle="仲間とグループを作って、歩いた道や寄り道を共有。" />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>ルートと写真を試す</Text>
            <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>3人の架空メンバーによるサンプル共有フィード</Text>
          </View>
          <Tag tone="yellow">DEMO</Tag>
        </View>
        <AppButton label={showDemo ? "サンプルを閉じる" : "サンプルグループを表示"} variant="outline" small onPress={() => setShowDemo((value) => !value)} />
      </Card>
      {showDemo ? <DemoGroupPreview /> : null}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><Ionicons name="people-circle-outline" size={22} color={brand.terracotta} /><Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 15 }}>新しいグループ</Text></View>
        <TextInput value={groupName} onChangeText={setGroupName} placeholder="例：土曜の散歩部" placeholderTextColor="#A99A8C" style={fieldStyle} />
        <AppButton label="グループを作成" onPress={onCreate} loading={busy} small />
        <View style={{ height: 1, backgroundColor: brand.line, marginVertical: 2 }} />
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>招待コードで参加</Text>
        <View style={{ flexDirection: "row", gap: 9 }}>
          <TextInput value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" placeholder="コードを入力" placeholderTextColor="#A99A8C" style={[fieldStyle, { flex: 1 }]} />
          <AppButton label="参加" variant="soft" onPress={onJoin} loading={busy} small />
        </View>
      </Card>
      {message ? <Text accessibilityRole="alert" style={{ color: brand.sage, fontFamily: typeface.medium, fontSize: 12 }}>{message}</Text> : null}

      {groups.length ? (
        <View style={{ gap: 10 }}>
          <SectionLabel>あなたのグループ</SectionLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {groups.map((group) => (
              <Pressable key={group.id} onPress={() => setSelectedId(group.id)} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, backgroundColor: (selectedGroup?.id === group.id) ? brand.terracotta : brand.card, borderWidth: 1, borderColor: (selectedGroup?.id === group.id) ? brand.terracotta : brand.line }}>
                <Text style={{ color: (selectedGroup?.id === group.id) ? brand.white : brand.ink, fontFamily: typeface.bold, fontSize: 12 }}>{group.name}</Text>
              </Pressable>
            ))}
          </View>
          {selectedGroup ? <>
            <Card style={{ gap: 13 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}><Tag tone="yellow">GROUP JOURNAL</Tag><Text style={{ color: brand.ink, fontSize: 20, fontFamily: typeface.bold, marginTop: 8 }}>{selectedGroup.name}</Text></View>
                <Ionicons name="map-outline" size={24} color={brand.terracotta} />
              </View>
              <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>この招待コードを友だちに共有してください</Text>
              <Text selectable style={{ color: brand.terracottaDark, fontFamily: typeface.bold, fontSize: 20, letterSpacing: 2 }}>{selectedGroup.inviteCode}</Text>
              {feedQuery.isLoading ? <ActivityIndicator color={brand.terracotta} /> : feed ? <StaticMap center={mapCenter} zoom={mapZoom} routeLines={mapRoutes} markers={mapMarkers} height={220} /> : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Metric label="メンバー" value={members.length.toString()} unit="人" accent />
                <Metric label="共有の歩行" value={(feed?.walks.length ?? 0).toString()} unit="件" />
                <Metric label="寄り道" value={(feed?.spots.length ?? 0).toString()} unit="か所" />
              </View>
              <AppButton label="安全な共有ルール" variant="outline" small onPress={() => router.push("/legal/support" as never)} />
            </Card>

            <Card style={{ gap: 12 }}>
              <SectionLabel aside={<Tag tone="paper">メンバー管理</Tag>}>歩く仲間</SectionLabel>
              {members.map((member) => (
                <View key={member.userId} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
                  {member.avatarUrl ? <Image source={{ uri: member.avatarUrl }} style={{ width: 36, height: 36, borderRadius: 18 }} /> : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F5E3C8", alignItems: "center", justifyContent: "center" }}><Ionicons name="person-outline" size={17} color={brand.terracotta} /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>{member.displayName || member.name || "まちあるメンバー"}</Text>
                    <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>{member.role === "owner" ? "グループ作成者" : member.isBlockedByMember ? "相手からブロックされています" : member.isBlocking ? "ブロック中" : "メンバー"}</Text>
                  </View>
                  {member.userId !== auth.user?.id ? <>
                    <AppButton label="通報" variant="outline" small onPress={() => setReportTarget({ targetType: "user", targetId: member.userId, title: member.displayName || member.name || "利用者" })} />
                    <AppButton label={member.isBlocking ? "解除" : "ブロック"} variant="outline" small onPress={() => void onBlock(member.userId, member.isBlocking)} />
                    {owner && member.userId !== selectedGroup.ownerUserId ? <AppButton label="外す" variant="outline" small onPress={() => setMemberToRemove({ userId: member.userId, name: member.displayName || member.name || "このメンバー" })} /> : null}
                  </> : null}
                </View>
              ))}
            </Card>

            {owner ? <>
              <SectionLabel aside={<Tag tone="yellow">OWNER</Tag>}>投稿の確認</SectionLabel>
              {pendingQuery.isLoading ? <Card><ActivityIndicator color={brand.terracotta} /></Card> : null}
              {pendingQuery.data && pendingQuery.data.walks.length + pendingQuery.data.spots.length === 0 ? <Card><EmptyNote title="確認待ちの投稿はありません" body="グループ共有の記録やスポットは、承認するとメンバーに表示されます。" /></Card> : null}
              {pendingQuery.data?.walks.map((walk) => (
                <Card key={`pending-walk-${walk.id}`} style={{ gap: 9 }}>
                  <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>{walk.author}さんの歩行記録</Text>
                  <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{walk.title || "街歩きの記録"} · {formatDistance(walk.distanceMeters)} · {formatDuration(walk.durationSeconds)}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}><AppButton label="承認して共有" small onPress={() => void onReview("walk", walk.id, "approve")} /></View>
                    <View style={{ flex: 1 }}><AppButton label="非公開にする" variant="danger" small onPress={() => void onReview("walk", walk.id, "reject")} /></View>
                  </View>
                </Card>
              ))}
              {pendingQuery.data?.spots.map((spot) => (
                <Card key={`pending-spot-${spot.id}`} style={{ gap: 9 }}>
                  {spot.photos.length ? <ScrollView horizontal style={{ height: 70 }} contentContainerStyle={{ gap: 6 }} showsHorizontalScrollIndicator={false}>{spot.photos.map((photoId) => <SpotPhoto key={photoId} photoId={photoId} style={{ width: 66, height: 66, borderRadius: 13 }} />)}</ScrollView> : null}
                  <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>{spot.title} · {spot.author}さん</Text>
                  <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{spot.description || "メモはありません"}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}><AppButton label="承認して共有" small onPress={() => void onReview("spot", spot.id, "approve")} /></View>
                    <View style={{ flex: 1 }}><AppButton label="非公開にする" variant="danger" small onPress={() => void onReview("spot", spot.id, "reject")} /></View>
                  </View>
                </Card>
              ))}

              <SectionLabel aside={<Tag tone="paper">OWNER</Tag>}>通報の確認</SectionLabel>
              {reportsQuery.isLoading ? <Card><ActivityIndicator color={brand.terracotta} /></Card> : null}
              {reportsQuery.data && reportsQuery.data.length === 0 ? <Card><EmptyNote title="未対応の通報はありません" body="通報が届くとここに表示されます。" /></Card> : null}
              {reportsQuery.data?.map((report) => (
                <Card key={`report-${report.id}`} style={{ gap: 8 }}>
                  <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>{report.reporterName}さんからの通報 · {report.targetName}</Text>
                  <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>理由：{REPORT_REASONS.find((reason) => reason.value === report.reason)?.label ?? "その他"} · 対象：{report.targetType === "walk" ? "歩行記録" : report.targetType === "spot" ? "スポット" : "利用者"}</Text>
                  {report.details ? <Text style={{ color: brand.ink, fontFamily: typeface.regular, fontSize: 12 }}>{report.details}</Text> : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                    <AppButton label="確認済み" variant="outline" small onPress={() => void onResolveReport(report.id, "dismiss")} />
                    {report.targetType !== "user" ? <AppButton label="投稿を非公開" variant="danger" small onPress={() => void onResolveReport(report.id, "remove")} /> : null}
                    {report.targetUserId && report.targetUserId !== auth.user?.id ? <AppButton label="対象をブロック" variant="outline" small onPress={() => void onResolveReport(report.id, "block")} /> : null}
                  </View>
                </Card>
              ))}
            </> : null}

            <SectionLabel aside={<Tag tone="green">グループのみ</Tag>}>共有フィード</SectionLabel>
            {feedQuery.isError ? <Card><EmptyNote title="フィードを読み込めません" body="ネットワークを確認して、もう一度お試しください。" /></Card> : null}
            {feed && feed.walks.length === 0 && feed.spots.length === 0 ? <Card><EmptyNote title="ここから思い出が増えていきます" body="歩行を保存するときに、このグループを選ぶとみんなの地図に表示されます。" /></Card> : null}
            {feed?.walks.map((walk) => (
              <Card key={`walk-${walk.id}`} style={{ gap: 10 }}>
                <Pressable onPress={() => router.push({ pathname: "/walk/[id]", params: { id: String(walk.id) } })}>
                  <View style={{ gap: 9 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{walk.author}さんの歩行</Text><Tag tone="yellow">{new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(walk.startedAt))}</Tag></View>
                    <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12 }}>{walk.title || "街歩きの記録"}</Text>
                    <View style={{ flexDirection: "row", gap: 22 }}><Metric label="距離" value={formatDistance(walk.distanceMeters)} accent /><Metric label="時間" value={formatDuration(walk.durationSeconds)} /><Metric label="歩数" value={walk.stepCount.toLocaleString("ja-JP")} /></View>
                  </View>
                </Pressable>
                <AppButton label="この記録を通報" variant="outline" small onPress={() => setReportTarget({ targetType: "walk", targetId: walk.id, title: walk.title || "歩行記録" })} />
              </Card>
            ))}
            {feed?.spots.map((spot) => (
              <Card key={`spot-${spot.id}`} style={{ gap: 9 }}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  {spot.photos.length ? <ScrollView horizontal style={{ width: 122, height: 68 }} contentContainerStyle={{ gap: 6 }} showsHorizontalScrollIndicator={false}>{spot.photos.map((photoId) => <SpotPhoto key={photoId} photoId={photoId} style={{ width: 62, height: 62, borderRadius: 14 }} />)}</ScrollView> : <View style={{ width: 62, height: 62, borderRadius: 14, backgroundColor: "#F7E7CC", alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={24} color={brand.terracotta} /></View>}
                  <View style={{ flex: 1, gap: 4 }}><Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{spot.title}</Text><Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{spot.author}さんの寄り道 · {spot.description || "メモはまだありません"}</Text></View>
                </View>
                <AppButton label="このスポットを通報" variant="outline" small onPress={() => setReportTarget({ targetType: "spot", targetId: spot.id, title: spot.title })} />
              </Card>
            ))}
          </> : null}
        </View>
      ) : groupQuery.isLoading ? <ActivityIndicator color={brand.terracotta} /> : (
        <Card><EmptyNote title="仲間との地図をつくろう" body="グループを作成するか、友だちから受け取った招待コードで参加できます。" /></Card>
      )}

      <Modal transparent visible={Boolean(reportTarget)} animationType="fade" onRequestClose={() => setReportTarget(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(35, 28, 23, 0.48)", justifyContent: "center", padding: 20 }}>
          <Card style={{ gap: 12 }}>
            <Heading eyebrow="REPORT CONTENT" title="通報する" subtitle={`${reportTarget?.title ?? "対象"}をグループ作成者に知らせます。`} />
            <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 12 }}>理由を選んでください</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
              {REPORT_REASONS.map((reason) => <Pressable key={reason.value} accessibilityRole="button" onPress={() => setReportReason(reason.value)} style={{ paddingVertical: 8, paddingHorizontal: 11, borderRadius: 14, backgroundColor: reportReason === reason.value ? "#F8E2D5" : brand.paperLight, borderWidth: 1, borderColor: reportReason === reason.value ? brand.terracotta : brand.line }}><Text style={{ color: reportReason === reason.value ? brand.terracottaDark : brand.muted, fontFamily: typeface.bold, fontSize: 11 }}>{reason.label}</Text></Pressable>)}
            </View>
            <TextInput value={reportDetails} onChangeText={setReportDetails} maxLength={2000} multiline placeholder="補足（任意）" placeholderTextColor="#A99A8C" style={[fieldStyle, { minHeight: 84, paddingTop: 10, textAlignVertical: "top" }]} />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <View style={{ flex: 1 }}><AppButton label="キャンセル" variant="outline" onPress={() => setReportTarget(null)} /></View>
              <View style={{ flex: 1 }}><AppButton label="通報を送る" loading={busy} onPress={() => void submitReport()} /></View>
            </View>
          </Card>
        </View>
      </Modal>

      <Modal transparent visible={Boolean(memberToRemove)} animationType="fade" onRequestClose={() => setMemberToRemove(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(35, 28, 23, 0.42)", justifyContent: "center", padding: 24 }}>
          <Card style={{ gap: 14 }}>
            <Heading eyebrow="MEMBER SETTINGS" title="グループから外しますか？" subtitle={`${memberToRemove?.name ?? "メンバー"}は、このグループの共有記録を見られなくなります。`} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><AppButton label="キャンセル" variant="outline" onPress={() => setMemberToRemove(null)} /></View>
              <View style={{ flex: 1 }}><AppButton label="メンバーを外す" variant="danger" onPress={() => { if (memberToRemove) void onRemove(memberToRemove.userId); setMemberToRemove(null); }} /></View>
            </View>
          </Card>
        </View>
      </Modal>
    </Page>
  );
}

export default function GroupsScreen() {
  const { user, loading } = useAuth();
  if (loading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <LoginGate />;
  return <GroupsContent />;
}
