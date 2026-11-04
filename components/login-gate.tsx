import { useState } from "react";
import { Image, Platform, Pressable, Text, TextInput, View } from "react-native";
import { AppButton, Card, Page, Tag } from "@/components/machiaru-ui";
import { router } from "expo-router";
import { brand, typeface } from "@/lib/brand";
import * as Auth from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

type EmailMode = "login" | "register";

const inputStyle = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: brand.line,
  borderRadius: 14,
  paddingHorizontal: 13,
  backgroundColor: brand.paperLight,
  color: brand.ink,
  fontFamily: typeface.regular,
};

export function LoginGate() {
  const [emailMode, setEmailMode] = useState<EmailMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const emailLogin = trpc.auth.emailLogin.useMutation();
  const emailRegister = trpc.auth.emailRegister.useMutation();

  const signInWithEmail = async () => {
    setEmailLoading(true);
    setMessage("");
    try {
      if (password.length < 12 || password.length > 128) {
        throw new Error("パスワードは12〜128文字で入力してください。");
      }
      if (emailMode === "register" && password !== confirmPassword) {
        throw new Error("確認用パスワードが一致しません。");
      }
      const payload = {
        email: email.trim().toLowerCase(),
        password,
        clientType: Platform.OS === "web" ? "web" as const : "native" as const,
      };
      const result = emailMode === "register"
        ? await emailRegister.mutateAsync(payload)
        : await emailLogin.mutateAsync(payload);

      if (!result.sessionToken) throw new Error("ログイン情報を受け取れませんでした。");
      await Auth.setSessionToken(result.sessionToken);
      await Auth.setUserInfo(result.user);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインできませんでした。入力内容をご確認ください。");
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <Page>
      <View style={{ alignItems: "flex-start", gap: 15, paddingTop: 16 }}>
        <Image source={require("@/assets/images/icon.png")} style={{ width: 68, height: 68, borderRadius: 18 }} />
        <Tag tone="yellow">街歩きの記録ノート</Tag>
        <Text style={{ fontSize: 31, lineHeight: 40, color: brand.ink, fontFamily: typeface.bold }}>歩いたぶんだけ、{`\n`}町が近くなる。</Text>
        <Text style={{ fontSize: 14, lineHeight: 23, color: brand.muted, fontFamily: typeface.regular }}>
          いつもの道も、ふと見つけた景色も。歩いた道と町角の思い出を、ひとつの地図に残そう。
        </Text>
      </View>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <View style={{ backgroundColor: "#F8E7D2", minHeight: 155, padding: 20, justifyContent: "flex-end" }}>
          <View style={{ position: "absolute", width: 110, height: 110, borderRadius: 55, backgroundColor: "#F2C14E", opacity: 0.35, right: -10, top: -22 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: brand.terracotta }} />
            <View style={{ height: 2, width: 58, backgroundColor: brand.terracotta, transform: [{ rotate: "-17deg" }] }} />
            <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: brand.mustard, borderWidth: 2, borderColor: brand.card }} />
            <View style={{ height: 2, width: 42, backgroundColor: brand.terracotta, transform: [{ rotate: "14deg" }] }} />
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: brand.terracotta }} />
          </View>
          <Text style={{ marginTop: 18, color: brand.ink, fontFamily: typeface.bold, fontSize: 16 }}>軌跡も、歩数も、寄り道も。</Text>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12, marginTop: 2 }}>自分のペースで、友だちと共有。</Text>
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 16 }}>{emailMode === "register" ? "メールアカウントを作成" : "メールでログイン"}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => { setEmailMode("login"); setConfirmPassword(""); setMessage(""); }} style={{ flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: emailMode === "login" ? "#F8E2D5" : brand.paperLight }}>
            <Text style={{ color: emailMode === "login" ? brand.terracottaDark : brand.muted, fontFamily: typeface.bold, fontSize: 12 }}>ログイン</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setEmailMode("register"); setMessage(""); }} style={{ flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: emailMode === "register" ? "#F8E2D5" : brand.paperLight }}>
            <Text style={{ color: emailMode === "register" ? brand.terracottaDark : brand.muted, fontFamily: typeface.bold, fontSize: 12 }}>新規登録</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="メールアドレス"
          value={email}
          onChangeText={setEmail}
          placeholder="メールアドレス"
          placeholderTextColor="#A99A8C"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={320}
          style={inputStyle}
        />
        <TextInput
          accessibilityLabel="パスワード"
          value={password}
          onChangeText={setPassword}
          placeholder="パスワード（12〜128文字）"
          placeholderTextColor="#A99A8C"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={128}
          style={inputStyle}
        />
        {emailMode === "register" ? (
          <>
            <TextInput
              accessibilityLabel="確認用パスワード"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="パスワードをもう一度入力"
              placeholderTextColor="#A99A8C"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={128}
              style={inputStyle}
            />
            <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 17 }}>
              この登録ではメールアドレスを確認しません。パスワードを忘れた場合のメール再設定もありません。大切に保管してください。
            </Text>
          </>
        ) : null}
        <AppButton
          label={emailMode === "register" ? "メールでアカウントを作成" : "メールでログイン"}
          onPress={signInWithEmail}
          loading={emailLoading}
          disabled={!email.trim() || password.length < 12 || password.length > 128 || (emailMode === "register" && !confirmPassword)}
        />
      </Card>
      <Card style={{ gap: 7 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>以前からお使いの方へ</Text>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>
          Manusログインは終了しました。まだログイン状態の端末がある場合は、プロフィールでメールアドレスとパスワードを設定して同じ記録を引き継いでください。すでに全端末からログアウトし、メールログインも未設定の場合、アプリから自動でアカウントを復旧することはできません。
        </Text>
      </Card>
      {message ? <Text accessibilityRole="alert" style={{ color: brand.terracottaDark, fontFamily: typeface.regular, fontSize: 12 }}>{message}</Text> : null}
      <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, textAlign: "center", lineHeight: 17 }}>
        ログイン後、歩行記録や写真の公開先は「自分のみ」か、選んだグループから選べます。
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 18, paddingVertical: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => router.push("/legal/privacy" as never)}><Text style={{ color: brand.terracottaDark, fontFamily: typeface.bold, fontSize: 11 }}>プライバシーポリシー</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/legal/support" as never)}><Text style={{ color: brand.terracottaDark, fontFamily: typeface.bold, fontSize: 11 }}>お問い合わせ・ルール</Text></Pressable>
      </View>
    </Page>
  );
}
