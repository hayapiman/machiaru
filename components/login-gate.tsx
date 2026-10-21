import { useState } from "react";
import { Image, Text, View } from "react-native";
import { AppButton, Card, Page, Tag } from "@/components/machiaru-ui";
import { brand, typeface } from "@/lib/brand";
import { startOAuthLogin } from "@/constants/oauth";

export function LoginGate() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const signIn = async () => {
    setLoading(true);
    setMessage("");
    try {
      await startOAuthLogin();
    } catch {
      setMessage("ログイン画面を開けませんでした。少し待ってからもう一度お試しください。");
    } finally {
      setLoading(false);
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
      <AppButton label="Manusアカウントでログイン" onPress={signIn} loading={loading} />
      {message ? <Text style={{ color: brand.terracottaDark, fontFamily: typeface.regular, fontSize: 12 }}>{message}</Text> : null}
      <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, textAlign: "center", lineHeight: 17 }}>
        ログイン後、歩行記録や写真の公開先は「自分のみ」か、選んだグループから選べます。
      </Text>
    </Page>
  );
}
