import { useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router } from "expo-router";
import { LoginGate } from "@/components/login-gate";
import { AppButton, Card, Heading, Metric, Page, SectionLabel, Tag, formatDistance } from "@/components/machiaru-ui";
import { useAuth } from "@/hooks/use-auth";
import { useWalkTracker } from "@/hooks/use-walk-tracker";
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
  const queryClient = useQueryClient();
  const auth = useAuth();
  const tracker = useWalkTracker();
  const profileQuery = trpc.profile.me.useQuery(undefined, { staleTime: 15000 });
  const walksQuery = trpc.walks.list.useQuery(undefined, { staleTime: 30000 });
  const pendingStorageQuery = trpc.profile.pendingStorageDeletions.useQuery(undefined, {
    enabled: profileQuery.data?.role === "admin",
    staleTime: 10000,
  });
  const updateProfile = trpc.profile.update.useMutation();
  const setEmailPassword = trpc.profile.setEmailPassword.useMutation();
  const uploadPhoto = trpc.photos.upload.useMutation();
  const deleteAccount = trpc.profile.deleteAccount.useMutation();
  const completeStorageDeletion = trpc.profile.completeStorageDeletion.useMutation();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [emailForLogin, setEmailForLogin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const walks = walksQuery.data ?? [];
  const totalSteps = walks.reduce((total, walk) => total + walk.stepCount, 0);
  const totalDistance = walks.reduce((total, walk) => total + walk.distanceMeters, 0);
  const totalMinutes = Math.round(walks.reduce((total, walk) => total + walk.durationSeconds, 0) / 60);
  const displayNameValue = displayName ?? profileQuery.data?.displayName ?? auth.user?.name ?? "";
  const emailLoginEnabled = profileQuery.data?.emailLoginEnabled ?? false;
  const emailForLoginValue = emailForLogin ?? profileQuery.data?.email ?? "";

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
    if (!emailForLoginValue.trim()) {
      setAccountMessage("ログインに使うメールアドレスを入力してください。");
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
        email: emailForLoginValue.trim(),
        newPassword,
        ...(currentPassword ? { currentPassword } : {}),
      });
      await utils.profile.me.invalidate();
      await auth.refresh();
      setEmailForLogin(null);
      setCurrentPassword("");
      setNewPassword("");
      setAccountMessage(emailLoginEnabled ? "メールログイン情報を更新しました。" : "メールとパスワードを登録しました。同じアカウントを引き継いでいます。");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "メールログインを設定できませんでした。");
    } finally {
      setAccountBusy(false);
    }
  };

  const requestAccountDeletion = async () => {
    if (deleteConfirmation !== "削除") {
      setDeleteError("確認のため「削除」と入力してください。");
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      await tracker.stopForAccountRemoval();
      const result = await deleteAccount.mutateAsync();
      let localDraftCleanupFailed = false;
      try {
        await tracker.discardCurrentAccountDraft();
      } catch {
        localDraftCleanupFailed = true;
      }
      setShowDeleteModal(false);
      setDeleteConfirmation("");
      const storageMessage = result.status === "pending_storage_purge"
        ? `アカウントと記録を削除しました。アップロード済み画像 ${result.photoObjectsPending} 件は運営側の物理削除待ちです。受付番号：${result.requestCode}`
        : "アカウントと関連する記録を削除しました。端末内の未保存歩行データも削除しました。";
      await auth.logout();
      queryClient.clear();
      const completionMessage = `${storageMessage}${localDraftCleanupFailed ? " 端末内ドラフトの自動消去に失敗したため、この端末のアプリデータも削除してください。" : ""}`;
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.alert(completionMessage);
      } else {
        Alert.alert("アカウントを削除しました", completionMessage);
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "アカウントを削除できませんでした。もう一度お試しください。");
      setDeleting(false);
    }
  };

  const markStoragePurged = async (requestCode: string) => {
    try {
      await completeStorageDeletion.mutateAsync({ requestCode });
      await pendingStorageQuery.refetch();
      setMessage("Storage削除の完了を記録しました。");
    } catch {
      setMessage("削除完了を記録できませんでした。");
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
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>{profileQuery.data?.email || "メールログインを設定してください"}</Text>
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
          現在のログイン方法はメールアドレスとパスワードのみです。まだログイン中の旧アカウントは、この画面でメールとパスワードを登録してデータを引き継げます。メール確認とメールでのパスワード再設定はありません。
        </Text>
        <TextInput
          accessibilityLabel="ログイン用メールアドレス"
          value={emailForLoginValue}
          onChangeText={setEmailForLogin}
          placeholder="ログイン用メールアドレス"
          placeholderTextColor="#A99A8C"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={320}
          style={fieldStyle}
        />
        {emailLoginEnabled ? <TextInput accessibilityLabel="現在のパスワード" value={currentPassword} onChangeText={setCurrentPassword} placeholder="現在のパスワード" placeholderTextColor="#A99A8C" secureTextEntry maxLength={128} style={fieldStyle} /> : null}
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
          label={emailLoginEnabled ? "メール・パスワードを更新" : "メールログインを設定"}
          onPress={saveEmailPassword}
          loading={accountBusy}
          disabled={!emailForLoginValue.trim() || newPassword.length < 12}
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

      {profileQuery.data?.role === "admin" ? (
        <Card style={{ gap: 10 }}>
          <SectionLabel aside={<Tag tone="yellow">ADMIN</Tag>}>Storageの物理削除待ち</SectionLabel>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 17 }}>
            下記のStorage object keyを運営者がストレージ管理画面で物理削除した後に限り、完了ボタンを押してください。この操作はオブジェクト自体を削除しません。
          </Text>
          {pendingStorageQuery.isLoading ? <ActivityIndicator color={brand.terracotta} /> : null}
          {pendingStorageQuery.data?.length ? pendingStorageQuery.data.map((request) => (
            <View key={request.requestCode} style={{ borderTopWidth: 1, borderColor: brand.line, paddingTop: 10, gap: 7 }}>
              <Text selectable style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 11 }}>受付番号 {request.requestCode}</Text>
              <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>{request.requestType === "replaced_profile_photo" ? "プロフィール写真の差し替え" : "アカウント削除"}</Text>
              {request.storageKeys.map((key) => <Text key={key} selectable style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10 }}>{key}</Text>)}
              <AppButton label="物理削除済みとして完了" variant="outline" small loading={completeStorageDeletion.isPending} onPress={() => void markStoragePurged(request.requestCode)} />
            </View>
          )) : !pendingStorageQuery.isLoading ? <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11 }}>処理待ちの画像はありません。</Text> : null}
        </Card>
      ) : null}

      <Card style={{ gap: 10 }}>
        <SectionLabel>情報とサポート</SectionLabel>
        <AppButton label="プライバシーポリシー" variant="outline" onPress={() => router.push("/legal/privacy" as never)} />
        <AppButton label="お問い合わせ・コミュニティルール" variant="soft" onPress={() => router.push("/legal/support" as never)} />
      </Card>

      <View style={{ height: 1, backgroundColor: brand.line, marginVertical: 3 }} />
      <AppButton label="ログアウト" variant="outline" onPress={auth.logout} />
      <Card style={{ gap: 8, borderColor: "#E7B7A5", borderWidth: 1 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>アカウントを削除</Text>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>
          プロフィール、認証情報、保存した歩行記録、スポット、グループ参加情報を削除します。作成者のグループは最も早く参加したメンバーへ引き継ぎます。アップロード画像はストレージから別途物理削除が必要な場合があります。
        </Text>
        <AppButton label="アカウント削除へ進む" variant="danger" onPress={() => { setDeleteError(""); setDeleteConfirmation(""); setShowDeleteModal(true); }} />
      </Card>
      <Text style={{ color: brand.muted, textAlign: "center", fontFamily: typeface.regular, fontSize: 10, lineHeight: 16 }}>歩行記録は自分のみ、または共有先に選んだグループだけに表示されます。</Text>

      <Modal transparent visible={showDeleteModal} animationType="fade" onRequestClose={() => { if (!deleting) setShowDeleteModal(false); }}>
        <View style={{ flex: 1, backgroundColor: "rgba(35, 28, 23, 0.5)", justifyContent: "center", padding: 22 }}>
          <Card style={{ gap: 13 }}>
            <Heading eyebrow="DELETE ACCOUNT" title="アカウントを削除しますか？" subtitle="この操作は取り消せません。歩行中なら計測を止め、未保存の端末内ドラフトも削除します。" />
            <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>
              アカウントとデータベース上の個人記録は削除されます。グループの作成者で、他のメンバーがいる場合は最も早い参加者へ作成者権限を移します。アップロード済みの写真ファイルは運営側による物理削除が完了するまで処理待ちになることがあります。
            </Text>
            <TextInput
              accessibilityLabel="削除確認"
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              placeholder="確認のため「削除」と入力"
              placeholderTextColor="#A99A8C"
              autoCapitalize="none"
              style={fieldStyle}
            />
            {deleteError ? <Text accessibilityRole="alert" style={{ color: brand.terracottaDark, fontFamily: typeface.medium, fontSize: 12 }}>{deleteError}</Text> : null}
            <View style={{ flexDirection: "row", gap: 9 }}>
              <View style={{ flex: 1 }}><AppButton label="キャンセル" variant="outline" disabled={deleting} onPress={() => setShowDeleteModal(false)} /></View>
              <View style={{ flex: 1 }}><AppButton label="完全に削除" variant="danger" loading={deleting} disabled={deleteConfirmation !== "削除"} onPress={() => void requestAccountDeletion()} /></View>
            </View>
          </Card>
        </View>
      </Modal>
    </Page>
  );
}

export default function ProfileScreen() {
  const { user, loading } = useAuth();
  if (loading) return <Page><ActivityIndicator color={brand.terracotta} /></Page>;
  if (!user) return <LoginGate />;
  return <ProfileContent />;
}
