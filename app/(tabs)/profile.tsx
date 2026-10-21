import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { LoginGate } from "@/components/login-gate";
import { AppButton, Card, Heading, Metric, Page, SectionLabel, Tag, formatDistance } from "@/components/machiaru-ui";
import { useAuth } from "@/hooks/use-auth";
import { brand, typeface } from "@/lib/brand";
import { trpc } from "@/lib/trpc";

const fieldStyle = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: brand.line,
  borderRadius: 14,
  paddingHorizontal: 13,
  backgroundColor: brand.paperLight,
  color: brand.ink,
  fontFamily: typeface.regular,
};

function ProfileContent() {
  const utils = trpc.useUtils();
  const auth = useAuth();
  const profileQuery = trpc.profile.me.useQuery(undefined, { staleTime: 15000 });
  const walksQuery = trpc.walks.list.useQuery(undefined, { staleTime: 30000 });
  const updateProfile = trpc.profile.update.useMutation();
  const setEmailPassword = trpc.profile.setEmailPassword.useMutation();
  const uploadPhoto = trpc.photos.upload.useMutation();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const walks = walksQuery.data ?? [];
  const totalSteps = walks.reduce((total, walk) => total + walk.stepCount, 0);
  const totalDistance = walks.reduce((total, walk) => total + walk.distanceMeters, 0);
  const totalMinutes = Math.round(walks.reduce((total, walk) => total + walk.durationSeconds, 0) / 60);

  const displayNameValue = displayName ?? profileQuery.data?.displayName ?? auth.user?.name ?? "";
  const emailLoginEnabled = profileQuery.data?.emailLoginEnabled ?? false;

  const saveProfile = async () => {
    if (!displayNameValue.trim()) {
      setMessage("表示名を入力してください。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await updateProfile.mutateAsync({ displayName: displayNameValue.trim() });
      await utils.profile.me.invalidate();
      setDisplayName(null);
      setMessage("プロフィールを更新しました。");
    } catch {
      setMessage("プロフィールを保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async () => {
    const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1] });
    if (selection.canceled) return;
    const asset = selection.assets?.[0];
    if (!asset) return;
    setBusy(true);
    setMessage("");
    try {
      const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: 512 }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!saved.base64) throw new Error("画像を変換できませんでした。");
      await uploadPhoto.mutateAsync({ base64: saved.base64, mimeType: "image/jpeg" });
      await utils.profile.me.invalidate();
      setMessage("プロフィール写真を更新しました。");
    } catch {
      setMessage("プロフィール写真を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const saveEmailPassword = async () => {
    if (!profileQuery.data?.email) {
      setAccountMessage("Manusアカウントにメールアドレスが登録されていません。");
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setAccountMessage("パスワードは12〜128文字で入力してください。");
      return;
    }
    if (emailLoginEnabled && !currentPassword) {
      setAccountMessage("現在のパスワードを入力してください。");
      return;
    }
    setAccountBusy(true);
    setAccountMessage("");
    try {
      await setEmailPassword.mutateAsync({
        newPassword,
        ...(currentPassword ? { currentPassword } : {}),
      });
      await utils.profile.me.invalidate();
      setCurrentPassword("");
      setNewPassword("");
      setAccountMessage(emailLoginEnabled ? "メールログインのパスワードを変更しました。" : "このManusアカウントにメールログインを設定しました。");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "メールログインを設定できませんでした。");
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <Page>
      <Heading eyebrow="YOUR WALK JOURNAL" title="プロフィール" subtitle="あなたの名前と、歩いてきた時間。" />
      <Card style={{ alignItems: "center", gap: 13, paddingVertical: 22 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="プロフィール写真を変更" onPress={changeAvatar} style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: "#F6DFCA", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 3, borderColor: brand.paper }}>
          {profileQuery.data?.avatarUrl ? <Image source={{ uri: profileQuery.data.avatarUrl }} style={{ width: 92, height: 92 }} /> : <Ionicons name="person-outline" size={38} color={brand.terracotta} />}
        </Pressable>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 18 }}>{profileQuery.data?.displayName || auth.user?.name || "まちあるメンバー"}</Text>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{profileQuery.data?.email || "プロフィール写真をタップして変更"}</Text>
        <Tag tone="yellow">写真をタップして変更</Tag>
      </Card>

      <Card style={{ gap: 11 }}>
        <SectionLabel>プロフィールを整える</SectionLabel>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>グループの仲間には、この表示名とプロフィール写真が表示されます。</Text>
        <TextInput value={displayNameValue} onChangeText={setDisplayName} maxLength={80} placeholder="表示名" placeholderTextColor="#A99A8C" style={fieldStyle} />
        {message ? <Text style={{ color: brand.sage, fontFamily: typeface.medium, fontSize: 12 }}>{message}</Text> : null}
        <AppButton label="プロフィールを保存" onPress={saveProfile} loading={busy} />
      </Card>

      <Card style={{ gap: 11 }}>
        <SectionLabel>メールアドレス＋パスワード</SectionLabel>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 17 }}>
          Manusアカウントと同じプロフィールを使います。メールアドレス確認や、メールでのパスワード再設定はありません。
        </Text>
        <Text style={{ color: brand.ink, fontFamily: typeface.medium, fontSize: 12 }}>{profileQuery.data?.email ?? "Manusアカウントにメールアドレスがありません"}</Text>
        {emailLoginEnabled ? (
          <TextInput accessibilityLabel="現在のパスワード" value={currentPassword} onChangeText={setCurrentPassword} placeholder="現在のパスワード" placeholderTextColor="#A99A8C" secureTextEntry maxLength={128} style={fieldStyle} />
        ) : null}
        <TextInput
          accessibilityLabel={emailLoginEnabled ? "新しいパスワード" : "パスワード"}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder={emailLoginEnabled ? "新しいパスワード（12文字以上）" : "パスワードを設定（12文字以上）"}
          placeholderTextColor="#A99A8C"
          secureTextEntry
          autoCapitalize="none"
          maxLength={128}
          style={fieldStyle}
        />
        {accountMessage ? <Text accessibilityRole="alert" style={{ color: brand.sage, fontFamily: typeface.medium, fontSize: 12 }}>{accountMessage}</Text> : null}
        <AppButton
          label={emailLoginEnabled ? "パスワードを変更" : "メールログインを設定"}
          onPress={saveEmailPassword}
          loading={accountBusy}
          disabled={!profileQuery.data?.email || !newPassword}
        />
      </Card>

      <SectionLabel>歩いてきた合計</SectionLabel>
      <Card style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Metric label="歩行回数" value={walks.length.toString()} unit="回" accent />
        <Metric label="歩いた距離" value={formatDistance(totalDistance)} />
        <Metric label="歩数" value={totalSteps.toLocaleString("ja-JP")} />
      </Card>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: "#F7E7CC", alignItems: "center", justifyContent: "center" }}><Ionicons name="time-outline" size={20} color={brand.terracotta} /></View>
        <View style={{ flex: 1 }}><Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>一緒に歩いた時間</Text><Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>これまで合計 {totalMinutes} 分</Text></View>
      </Card>
      <View style={{ height: 1, backgroundColor: brand.line, marginVertical: 3 }} />
      <AppButton label="ログアウト" variant="outline" onPress={auth.logout} />
      <Text style={{ color: brand.muted, textAlign: "center", fontFamily: typeface.regular, fontSize: 10, lineHeight: 16 }}>歩行記録は自分のみ、または共有先に選んだグループだけに表示されます。</Text>
    </Page>
  );
}

export default function ProfileScreen() {
  const { user, loading } = useAuth();
  if (loading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <LoginGate />;
  return <ProfileContent />;
}
