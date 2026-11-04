import Constants from "expo-constants";
import { Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { AppButton, Card, Heading, Page } from "@/components/machiaru-ui";
import { brand, typeface } from "@/lib/brand";

type PublicAppInfo = { operatorName?: string; supportEmail?: string; supportUrl?: string };
const publicInfo = (Constants.expoConfig?.extra ?? {}) as PublicAppInfo;
const operatorName = publicInfo.operatorName?.trim() ?? "";
const supportEmail = publicInfo.supportEmail?.trim() ?? "";
const supportUrl = publicInfo.supportUrl?.trim() ?? "";

function Rule({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 11 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F8E2D5", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: brand.terracottaDark, fontFamily: typeface.bold, fontSize: 12 }}>{number}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>{title}</Text>
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>{body}</Text>
      </View>
    </View>
  );
}

export default function CommunitySupportScreen() {
  const contact = async () => {
    if (!supportEmail) return;
    try {
      await Linking.openURL(`mailto:${supportEmail}?subject=${encodeURIComponent("まちあるへのお問い合わせ")}`);
    } catch {
      // The address remains visible and can be copied if no mail app is configured.
    }
  };

  return (
    <Page>
      <Heading eyebrow="COMMUNITY CARE" title="お問い合わせ・コミュニティルール" subtitle="安心して街歩きを共有するための約束と、困ったときの連絡方法です。" />
      {!operatorName || !supportEmail ? (
        <Card style={{ gap: 8, borderColor: brand.mustard, borderWidth: 1 }}>
          <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>公開問い合わせ先が未設定です</Text>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>
            運営者名と実際に利用できる公開メールアドレスを設定するまで、問い合わせ先は公開できません。運営者名や連絡先を推測して掲載することはありません。
          </Text>
        </Card>
      ) : null}
      <Card style={{ gap: 16 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 15 }}>共有するときのルール</Text>
        <Rule number="1" title="同意のある写真・情報を共有する" body="写真に写る人の許可を得てください。他人の個人情報、顔写真、車のナンバー、連絡先などを本人の同意なく投稿しないでください。" />
        <Rule number="2" title="自宅などの正確な位置に注意する" body="自宅、勤務先、学校など生活拠点が特定されるルートやスポットを共有しないでください。共有先を選ぶ前に、地図と記録の公開範囲を確認してください。" />
        <Rule number="3" title="嫌がらせ・差別・脅迫・露骨な内容を投稿しない" body="他の人を傷つける内容、脅迫、差別的な表現、性的または違法な画像、スパムを投稿・共有しないでください。" />
        <Rule number="4" title="不適切な投稿や利用者は通報する" body="グループのフィードで投稿または利用者の「通報」を選び、理由を送ってください。新しい共有投稿はグループ作成者の確認が終わるまでメンバーに表示されません。グループ作成者は報告を確認し、投稿を非公開にしたり、利用者をグループから外したりできます。" />
        <Rule number="5" title="必要なときはブロックする" body="グループのメンバー一覧から利用者をブロックできます。ブロック関係にある利用者同士には、共有フィード、記録詳細、投稿写真、プロフィール写真が表示されません。ブロックを解除する場合は同じ一覧から操作してください。" />
      </Card>
      <Card style={{ gap: 9 }}>
        <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>運営者・お問い合わせ</Text>
        <Text selectable style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12, lineHeight: 19 }}>運営者：{operatorName || "未設定"}{"\n"}メール：{supportEmail || "未設定"}</Text>
        {supportEmail ? <AppButton label="メールで問い合わせる" variant="outline" onPress={() => void contact()} /> : null}
        {supportUrl ? <AppButton label="公開サポートページを開く" variant="outline" onPress={() => void Linking.openURL(supportUrl)} /> : null}
        <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 10, lineHeight: 16 }}>
          投稿の通報は、まず該当グループの作成者が確認します。アカウント削除や個人情報に関する問い合わせは、上記の運営者メールをご利用ください。
        </Text>
      </Card>
      <AppButton label="プライバシーポリシー" variant="soft" onPress={() => router.push("/legal/privacy" as never)} />
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ paddingVertical: 8 }}>
        <Text style={{ color: brand.terracottaDark, textAlign: "center", fontFamily: typeface.bold, fontSize: 12 }}>戻る</Text>
      </Pressable>
    </Page>
  );
}
