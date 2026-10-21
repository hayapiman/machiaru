import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Location from "expo-location";
import { LoginGate } from "@/components/login-gate";
import { AppButton, Card, EmptyNote, Heading, Metric, Page, SectionLabel, Tag, formatDistance, formatDuration, formatPace } from "@/components/machiaru-ui";
import { StaticMap, DEFAULT_CENTER } from "@/components/map/static-map";
import { SpotPhoto } from "@/components/spot-photo";
import { useAuth } from "@/hooks/use-auth";
import { useWalkTracker } from "@/hooks/use-walk-tracker";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";
import type { RoutePoint } from "@/drizzle/schema";

type Coordinate = { latitude: number; longitude: number };
type PickedSpotPhoto = { uri: string; base64: string; mimeType: "image/jpeg" };
type PendingWalk = {
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distanceMeters: number;
  stepCount: number;
  routeData: RoutePoint[];
};

function SheetField({ label, value, onChangeText, multiline = false, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A99A8C"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{ minHeight: multiline ? 84 : 46, borderWidth: 1, borderColor: brand.line, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10, color: brand.ink, fontFamily: typeface.regular, backgroundColor: brand.paperLight }}
      />
    </View>
  );
}

function ChoiceChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ borderRadius: 18, borderWidth: 1, borderColor: active ? brand.terracotta : brand.line, backgroundColor: active ? "#F8E2D5" : brand.paperLight, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ color: active ? brand.terracottaDark : brand.muted, fontFamily: typeface.medium, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function MapHome({ userName }: { userName: string }) {
  const trpcUtils = trpc.useUtils();
  const tracker = useWalkTracker();
  const profileQuery = trpc.profile.me.useQuery(undefined, { staleTime: 30000 });
  const groupQuery = trpc.groups.list.useQuery(undefined, { staleTime: 30000 });
  const spotsQuery = trpc.spots.list.useQuery(undefined, { staleTime: 20000 });
  const walksQuery = trpc.walks.list.useQuery(undefined, { staleTime: 30000 });
  const createWalk = trpc.walks.create.useMutation();
  const createSpot = trpc.spots.create.useMutation();
  const uploadPhoto = trpc.photos.upload.useMutation();

  const [center, setCenter] = useState<Coordinate>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(15);
  const [manualCurrentLocation, setManualCurrentLocation] = useState<Coordinate | null>(null);
  const [manualCurrentLocationAccuracyMeters, setManualCurrentLocationAccuracyMeters] = useState<number | null>(null);
  const [addSpotMode, setAddSpotMode] = useState(false);
  const [spotCoordinates, setSpotCoordinates] = useState<Coordinate | null>(null);
  const [selectedSpotId, setSelectedSpotId] = useState<number | null>(null);
  const [spotTitle, setSpotTitle] = useState("");
  const [spotDescription, setSpotDescription] = useState("");
  const [spotVisibility, setSpotVisibility] = useState<"private" | "group">("private");
  const [spotGroupId, setSpotGroupId] = useState<number | null>(null);
  const [spotPhotos, setSpotPhotos] = useState<PickedSpotPhoto[]>([]);
  const [spotSaving, setSpotSaving] = useState(false);
  const [spotNotice, setSpotNotice] = useState("");
  const [pendingWalk, setPendingWalk] = useState<PendingWalk | null>(null);
  const [walkTitle, setWalkTitle] = useState("");
  const [walkVisibility, setWalkVisibility] = useState<"private" | "group">("private");
  const [walkGroupId, setWalkGroupId] = useState<number | null>(null);
  const [walkSaving, setWalkSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const lastRecenter = useRef<Coordinate | null>(null);

  const groups = groupQuery.data ?? [];
  const spots = useMemo(() => spotsQuery.data ?? [], [spotsQuery.data]);
  const selectedSpot = useMemo(() => spots.find((spot) => spot.id === selectedSpotId) ?? null, [selectedSpotId, spots]);
  const mapMarkers = useMemo(() => spots.map((spot) => ({ latitude: spot.latitude, longitude: spot.longitude })), [spots]);
  const currentLocation = tracker.currentLocation ?? manualCurrentLocation;
  const currentLocationAccuracyMeters = tracker.currentLocation ? tracker.currentLocationAccuracyMeters : manualCurrentLocationAccuracyMeters;
  const averageSpeedKmh = tracker.elapsedSeconds > 0 ? ((tracker.distanceMeters / tracker.elapsedSeconds) * 3.6).toFixed(1) : "0.0";
  const gpsAccuracyLabel = tracker.runState === "paused"
    ? "GPS一時停止"
    : tracker.gpsAccuracyMeters === null
      ? "GPS測位中"
      : `GPS ±${Math.round(tracker.gpsAccuracyMeters)}m`;
  const gpsAccuracyTone: "green" | "yellow" | "red" | "paper" = tracker.runState === "paused"
    ? "paper"
    : tracker.gpsAccuracyMeters === null || tracker.gpsAccuracyMeters > 30
      ? tracker.gpsAccuracyMeters !== null && tracker.gpsAccuracyMeters > 45 ? "red" : "yellow"
      : "green";
  const gpsHint = tracker.runState === "paused"
    ? "一時停止中は時間・距離・歩数を計測しません。"
    : tracker.gpsAccuracyMeters !== null && tracker.gpsAccuracyMeters > 45
      ? "精度が低いため、この位置は距離に加算していません。空の開けた場所で再測位してください。"
      : "精度の低い位置や急な飛び値は距離に加算しません。";

  useEffect(() => {
    const last = tracker.routeData.at(-1);
    if (!last || tracker.runState !== "tracking") return;
    const previous = lastRecenter.current;
    if (!previous) {
      lastRecenter.current = { latitude: last.latitude, longitude: last.longitude };
      setCenter(lastRecenter.current);
      return;
    }
    const latMeters = (last.latitude - previous.latitude) * 111000;
    const lonMeters = (last.longitude - previous.longitude) * 85000;
    if (Math.hypot(latMeters, lonMeters) > 120) {
      lastRecenter.current = { latitude: last.latitude, longitude: last.longitude };
      setCenter(lastRecenter.current);
    }
  }, [tracker.routeData, tracker.runState]);

  const centerOnMe = async () => {
    setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice("現在地の表示には位置情報の許可が必要です。");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCenter(next);
      setManualCurrentLocation(next);
      setManualCurrentLocationAccuracyMeters(position.coords.accuracy ?? null);
      lastRecenter.current = next;
    } catch {
      setNotice("現在地を取得できませんでした。屋外で再度お試しください。");
    }
  };

  const panMap = useCallback((next: Coordinate) => {
    setCenter(next);
    lastRecenter.current = next;
  }, []);

  const startOrResume = async () => {
    setNotice("");
    if (tracker.runState === "paused") {
      await tracker.resume();
      return;
    }
    setManualCurrentLocation(null);
    setManualCurrentLocationAccuracyMeters(null);
    await tracker.start();
  };

  const openWalkSave = () => {
    const result = tracker.finish();
    if (!result) return;
    const lastPoint = result.routeData.at(-1);
    if (lastPoint) setCenter({ latitude: lastPoint.latitude, longitude: lastPoint.longitude });
    setPendingWalk(result);
    setWalkTitle("");
    setWalkVisibility("private");
    setWalkGroupId(null);
    setNotice("");
  };

  const saveWalk = async () => {
    if (!pendingWalk) return;
    if (walkVisibility === "group" && !walkGroupId) {
      setNotice("共有するグループを選んでください。");
      return;
    }
    setWalkSaving(true);
    try {
      await createWalk.mutateAsync({
        title: walkTitle.trim() || undefined,
        startedAt: pendingWalk.startedAt,
        endedAt: pendingWalk.endedAt,
        durationSeconds: pendingWalk.durationSeconds,
        distanceMeters: pendingWalk.distanceMeters,
        stepCount: pendingWalk.stepCount,
        visibility: walkVisibility,
        groupId: walkVisibility === "group" ? walkGroupId : null,
        routeData: pendingWalk.routeData,
      });
      await trpcUtils.walks.list.invalidate();
      setPendingWalk(null);
      setNotice("今日の歩みを記録しました。");
    } catch {
      setNotice("歩行記録を保存できませんでした。通信を確認してください。");
    } finally {
      setWalkSaving(false);
    }
  };

  const pickSpotPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    if (result.canceled) return;
    try {
      const processed = await Promise.all(result.assets.slice(0, 5).map(async (asset) => {
        let context = ImageManipulator.manipulate(asset.uri);
        if (asset.width > 1600 || asset.height > 1600) context = context.resize({ width: 1600 });
        const rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.78, base64: true });
        if (!saved.base64) throw new Error("画像を変換できませんでした。");
        return { uri: saved.uri, base64: saved.base64, mimeType: "image/jpeg" as const };
      }));
      setSpotPhotos(processed);
      setSpotNotice("");
    } catch {
      setSpotNotice("写真を読み込めませんでした。別の画像を選んでください。");
    }
  };

  const openSpotSheet = (coordinate: Coordinate) => {
    setSpotCoordinates(coordinate);
    setSpotTitle("");
    setSpotDescription("");
    setSpotVisibility("private");
    setSpotGroupId(null);
    setSpotPhotos([]);
    setSpotNotice("");
    setAddSpotMode(false);
  };

  const saveSpot = async () => {
    if (!spotCoordinates || !spotTitle.trim()) {
      setSpotNotice("スポットの名前を入力してください。");
      return;
    }
    if (spotVisibility === "group" && !spotGroupId) {
      setSpotNotice("共有するグループを選んでください。");
      return;
    }
    setSpotSaving(true);
    try {
      const created = await createSpot.mutateAsync({
        title: spotTitle.trim(),
        description: spotDescription.trim() || undefined,
        latitude: spotCoordinates.latitude,
        longitude: spotCoordinates.longitude,
        visitedAt: Date.now(),
        visibility: spotVisibility,
        groupId: spotVisibility === "group" ? spotGroupId : null,
        sessionId: null,
      });
      let failedPhotos = 0;
      for (const photo of spotPhotos) {
        if (!photo.base64) {
          failedPhotos += 1;
          continue;
        }
        try {
          await uploadPhoto.mutateAsync({
            base64: photo.base64,
            mimeType: photo.mimeType,
            spotId: created.id,
          });
        } catch {
          failedPhotos += 1;
        }
      }
      await Promise.all([trpcUtils.spots.list.invalidate(), trpcUtils.groups.list.invalidate()]);
      setSpotCoordinates(null);
      setSpotNotice(failedPhotos ? `スポットを保存しました。写真${failedPhotos}枚はアップロードできませんでした。` : "スポットと写真を保存しました。");
    } catch {
      setSpotNotice("スポットを保存できませんでした。もう一度お試しください。");
    } finally {
      setSpotSaving(false);
    }
  };

  const walkedToday = (walksQuery.data ?? []).filter((walk) => new Date(walk.startedAt).toDateString() === new Date().toDateString());
  const latestWalk = walksQuery.data?.[0] ?? null;

  return (
    <Page>
      <Heading
        eyebrow="MACHIARU JOURNAL"
        title={`${profileQuery.data?.displayName || userName || "おかえりなさい"}さんの地図`}
        subtitle="歩いた道に、今日の発見を重ねていこう。"
        right={<View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "#F3DCCB", alignItems: "center", justifyContent: "center" }}><Ionicons name="walk-outline" size={22} color={brand.terracotta} /></View>}
      />

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Tag tone={tracker.runState === "tracking" ? "red" : "yellow"}>
            {tracker.runState === "tracking" ? "記録中" : tracker.runState === "paused" ? "一時停止中" : "今日のさんぽ"}
          </Tag>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable accessibilityLabel="地図を縮小" onPress={() => setZoom((value) => Math.max(3, value - 1))} style={mapControlStyle}><Ionicons name="remove" size={19} color={brand.ink} /></Pressable>
            <Pressable accessibilityLabel="地図を拡大" onPress={() => setZoom((value) => Math.min(19, value + 1))} style={mapControlStyle}><Ionicons name="add" size={19} color={brand.ink} /></Pressable>
            <Pressable accessibilityLabel="現在地へ移動して青い点を表示" onPress={centerOnMe} style={mapControlStyle}><Ionicons name="locate-outline" size={20} color="#256FD6" /></Pressable>
          </View>
        </View>
        <StaticMap
          center={center}
          zoom={zoom}
          markers={mapMarkers}
          routePoints={tracker.routeData}
          currentLocation={currentLocation}
          currentLocationAccuracyMeters={currentLocationAccuracyMeters}
          onMapPan={panMap}
          onZoomChange={setZoom}
          onMapTap={addSpotMode ? openSpotSheet : undefined}
        />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, flex: 1 }}>
            {addSpotMode ? "地図をタップして、場所を選んでください" : `${spots.length}か所の思い出 · ${walkedToday.length}回の歩行`}
          </Text>
          <AppButton label={addSpotMode ? "地図で場所を選択中" : "＋ スポット追加"} variant={addSpotMode ? "soft" : "outline"} onPress={() => setAddSpotMode((value) => !value)} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: "#256FD6", borderWidth: 2, borderColor: "#FFFFFF" }} />
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, flex: 1 }}>
            {currentLocation
              ? `青い点が現在地${currentLocationAccuracyMeters == null ? "" : ` · GPS ±${Math.round(currentLocationAccuracyMeters)}m`}`
              : "現在地ボタンを押すと、地図に青い点で表示します"}
          </Text>
          <Text style={{ color: brand.terracotta, fontFamily: typeface.medium, fontSize: 10 }}>線＝歩いた道</Text>
        </View>
        {latestWalk ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="最近の歩行ルートを大きな地図で見る"
            onPress={() => router.push({ pathname: "/walk/map", params: { walkId: String(latestWalk.id) } })}
            style={({ pressed }) => ({ minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, borderRadius: 17, backgroundColor: brand.card, borderWidth: 1, borderColor: brand.line, opacity: pressed ? 0.82 : 1 })}
          >
            <Ionicons name="map-outline" size={21} color={brand.terracotta} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>歩いた道を大きく見る</Text>
              <Text numberOfLines={1} style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>{latestWalk.title || "最近の街歩き"} · 地図を拡大して確認</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={brand.muted} />
          </Pressable>
        ) : null}
      </View>

      <Card style={{ gap: 15 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ color: brand.ink, fontSize: 16, fontFamily: typeface.bold }}>{tracker.runState === "idle" ? "歩く時間を、思い出に。" : tracker.runState === "paused" ? "ひと休み中" : "いいペースです"}</Text>
            <Text style={{ color: brand.muted, fontSize: 11, fontFamily: typeface.regular, marginTop: 3 }}>{tracker.runState === "idle" ? "記録ボタンでルート計測をはじめます" : tracker.estimatedSteps ? "歩数は移動距離からの目安です" : "時間・距離・歩数を記録しています"}</Text>
          </View>
          {tracker.runState !== "idle" ? <Tag tone={gpsAccuracyTone}>{gpsAccuracyLabel}</Tag> : null}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#EFE4D5", paddingVertical: 13 }}>
          <Metric label="時間" value={formatDuration(tracker.elapsedSeconds)} accent />
          <Metric label="距離" value={formatDistance(tracker.distanceMeters)} />
          <Metric label={tracker.estimatedSteps ? "歩数・推定" : "歩数"} value={tracker.stepCount.toLocaleString("ja-JP")} />
          <Metric label="速度" value={formatPace(tracker.currentSpeedMps)} unit="km/h" />
        </View>
        {tracker.runState !== "idle" ? <Text style={{ color: brand.muted, fontFamily: typeface.medium, fontSize: 11 }}>平均速度　{averageSpeedKmh} km/h</Text> : null}
        {tracker.runState !== "idle" ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Tag tone={tracker.estimatedSteps ? "yellow" : "green"}>{tracker.estimatedSteps ? "歩数は推定" : "端末歩数計"}</Tag>
            <Text style={{ flex: 1, color: brand.muted, fontFamily: typeface.regular, fontSize: 10, lineHeight: 16 }}>{gpsHint}</Text>
          </View>
        ) : null}
        {tracker.locationError ? <Text style={{ color: brand.terracottaDark, fontFamily: typeface.regular, fontSize: 12 }}>{tracker.locationError}</Text> : null}
        {notice ? <Text style={{ color: brand.sage, fontFamily: typeface.medium, fontSize: 12 }}>{notice}</Text> : null}
        {tracker.runState === "idle" ? (
          <AppButton label="歩行を記録する" onPress={startOrResume} />
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><AppButton label={tracker.runState === "paused" ? "記録を再開" : "一時停止"} onPress={tracker.runState === "paused" ? startOrResume : tracker.pause} variant="soft" /></View>
            <View style={{ flex: 1 }}><AppButton label="終了して保存" onPress={openWalkSave} /></View>
          </View>
        )}
      </Card>

      <SectionLabel aside={<Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{spots.length} SPOTS</Text>}>最近のスポット</SectionLabel>
      {spots.slice(0, 3).length ? (
        <View style={{ gap: 10 }}>
          {spots.slice(0, 3).map((spot) => (
            <Pressable key={spot.id} accessibilityRole="button" onPress={() => { setCenter({ latitude: spot.latitude, longitude: spot.longitude }); setSelectedSpotId(spot.id); }}>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 13 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#F7E7CC", alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={21} color={brand.terracotta} /></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{spot.title}</Text>
                  <Text numberOfLines={1} style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{spot.description || "この場所の思い出を残しました"}</Text>
                </View>
                {spot.photos.length ? <ScrollView horizontal style={{ width: 106, maxHeight: 48 }} contentContainerStyle={{ gap: 6 }} showsHorizontalScrollIndicator={false}>{spot.photos.map((photoId) => <SpotPhoto key={photoId} photoId={photoId} style={{ width: 44, height: 44, borderRadius: 12 }} />)}</ScrollView> : null}
              </Card>
            </Pressable>
          ))}
        </View>
      ) : (
        <Card><EmptyNote title="最初の寄り道を残そう" body="「スポット追加」から地図をタップすると、場所と写真を記録できます。" /></Card>
      )}

      <Modal transparent visible={Boolean(selectedSpot)} animationType="slide" onRequestClose={() => setSelectedSpotId(null)}>
        <View style={modalBackdrop}>
          <View style={sheetStyle}>
            <View style={sheetHandle} />
            {selectedSpot ? <>
              <Heading eyebrow="VISITED SPOT" title={selectedSpot.title} subtitle="地図に残した、まちの思い出。" />
              <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedSpot.visitedAt))}</Text>
              <Text style={{ color: brand.ink, fontFamily: typeface.regular, fontSize: 13, lineHeight: 21 }}>{selectedSpot.description || "この場所のメモはまだありません。"}</Text>
              <SectionLabel aside={<Tag tone="paper">{selectedSpot.photos.length}枚</Tag>}>写真</SectionLabel>
              {selectedSpot.photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>{selectedSpot.photos.map((photoId) => <SpotPhoto key={photoId} photoId={photoId} style={{ width: 88, height: 88, borderRadius: 16 }} />)}</ScrollView> : <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12 }}>写真はありません。</Text>}
              <AppButton label="閉じる" variant="soft" onPress={() => setSelectedSpotId(null)} />
            </> : null}
          </View>
        </View>
      </Modal>

      <Modal transparent visible={Boolean(spotCoordinates)} animationType="slide" onRequestClose={() => setSpotCoordinates(null)}>
        <View style={modalBackdrop}>
          <View style={sheetStyle}>
            <View style={sheetHandle} />
            <Heading eyebrow="VISITED SPOT" title="今日の寄り道を残す" subtitle="選んだ場所に名前と写真を添えましょう。" />
            <SheetField label="スポット名" value={spotTitle} onChangeText={setSpotTitle} placeholder="例：川沿いの小さな喫茶店" />
            <SheetField label="ひとことメモ" value={spotDescription} onChangeText={setSpotDescription} multiline placeholder="景色や気づいたことをメモ" />
            <View style={{ gap: 8 }}>
              <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 12 }}>公開先</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ChoiceChip label="自分のみ" active={spotVisibility === "private"} onPress={() => setSpotVisibility("private")} />
                {groups.map((group) => <ChoiceChip key={group.id} label={group.name} active={spotVisibility === "group" && spotGroupId === group.id} onPress={() => { setSpotVisibility("group"); setSpotGroupId(group.id); }} />)}
              </View>
            </View>
            <Pressable onPress={pickSpotPhotos} style={{ borderWidth: 1, borderStyle: "dashed", borderColor: brand.line, borderRadius: 15, minHeight: 52, justifyContent: "center", paddingHorizontal: 14 }}>
              <Text style={{ color: brand.terracotta, fontFamily: typeface.bold, fontSize: 13 }}>＋ 写真を選ぶ（最大5枚）</Text>
              <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10, marginTop: 3 }}>{spotPhotos.length ? `${spotPhotos.length}枚選択中` : "写真なしでも保存できます"}</Text>
            </Pressable>
            {spotPhotos.length ? <View style={{ flexDirection: "row", gap: 7 }}>{spotPhotos.map((photo, index) => <Image key={`${photo.uri}-${index}`} source={{ uri: photo.uri }} style={{ width: 54, height: 54, borderRadius: 12 }} />)}</View> : null}
            {spotNotice ? <Text style={{ color: brand.terracottaDark, fontFamily: typeface.regular, fontSize: 11 }}>{spotNotice}</Text> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><AppButton label="やめる" variant="outline" onPress={() => setSpotCoordinates(null)} /></View>
              <View style={{ flex: 1 }}><AppButton label="場所を保存" onPress={saveSpot} loading={spotSaving} /></View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={Boolean(pendingWalk)} animationType="slide" onRequestClose={() => setPendingWalk(null)}>
        <View style={modalBackdrop}>
          <View style={sheetStyle}>
            <View style={sheetHandle} />
            <Heading eyebrow="WALK COMPLETE" title="今日の歩みを保存" subtitle="記録に名前をつけ、共有先を選べます。" />
            {pendingWalk ? <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: "#F8F0E5", borderRadius: 15, padding: 13 }}>
              <Metric label="時間" value={formatDuration(pendingWalk.durationSeconds)} accent />
              <Metric label="距離" value={formatDistance(pendingWalk.distanceMeters)} />
              <Metric label="歩数" value={pendingWalk.stepCount.toLocaleString("ja-JP")} />
            </View> : null}
            <SheetField label="記録のタイトル（任意）" value={walkTitle} onChangeText={setWalkTitle} placeholder="例：朝の川沿いさんぽ" />
            <View style={{ gap: 8 }}>
              <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 12 }}>この記録を見られる人</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ChoiceChip label="自分のみ" active={walkVisibility === "private"} onPress={() => setWalkVisibility("private")} />
                {groups.map((group) => <ChoiceChip key={group.id} label={group.name} active={walkVisibility === "group" && walkGroupId === group.id} onPress={() => { setWalkVisibility("group"); setWalkGroupId(group.id); }} />)}
              </View>
            </View>
            {notice ? <Text style={{ color: brand.terracottaDark, fontFamily: typeface.regular, fontSize: 11 }}>{notice}</Text> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><AppButton label="保存せず閉じる" variant="outline" onPress={() => { setPendingWalk(null); setNotice("この歩行は未保存です。保存する場合はあらためて記録してください。"); }} /></View>
              <View style={{ flex: 1 }}><AppButton label="記録を保存" onPress={saveWalk} loading={walkSaving} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

const mapControlStyle = { width: 48, height: 48, borderRadius: 16, backgroundColor: brand.card, borderWidth: 1, borderColor: brand.line, alignItems: "center" as const, justifyContent: "center" as const };
const modalBackdrop = { flex: 1, backgroundColor: "rgba(35, 28, 23, 0.42)", justifyContent: "flex-end" as const };
const sheetStyle = { backgroundColor: brand.paperLight, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28, gap: 14, maxHeight: "92%" as const };
const sheetHandle = { width: 40, height: 4, borderRadius: 5, backgroundColor: brand.line, alignSelf: "center" as const, marginBottom: 1 };

export default function HomeScreen() {
  const { user, loading } = useAuth();
  if (loading) return <Page><ActivityIndicator color={brand.terracotta} /><Text style={{ textAlign: "center", color: brand.muted, fontFamily: typeface.regular }}>地図を準備しています</Text></Page>;
  if (!user) return <LoginGate />;
  return <MapHome userName={user.name || ""} />;
}
