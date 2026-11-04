import Constants from "expo-constants";
import { Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { AppButton, Card, Heading, Page } from "@/components/machiaru-ui";
import { brand, typeface } from "@/lib/brand";

type PublicAppInfo = {
  operatorName?: string;
  supportEmail?: string;
  privacyPolicyUrl?: string;
};

const publicInfo = (Constants.expoConfig?.extra ?? {}) as PublicAppInfo;
const operatorName = publicInfo.operatorName?.trim() ?? "";
const supportEmail = publicInfo.supportEmail?.trim() ?? "";
const privacyPolicyUrl = publicInfo.privacyPolicyUrl?.trim() ?? "";

function PolicySection({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 14 }}>{title}</Text>
      <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 12, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  return (
    <Page>
      <Heading
        eyebrow="YOUR PRIVACY"
        title="プライバシーポリシー"
        subtitle="まちあるが、街歩きの記録とアカウント情報をどのように扱うかをご案内します。"
      />

      {!operatorName || !supportEmail || !privacyPolicyUrl ? (
        <Card style={{ gap: 8, borderColor: brand.mustard, borderWidth: 1 }}>
          <Text style={{ color: brand.ink, fontFamily: typeface.bold, fontSize: 13 }}>公開前に運営者情報の設定が必要です</Text>
          <Text style={{ color: brand.muted, fontFamily: typeface.regular, fontSize: 11, lineHeight: 18 }}>
            運営者名、問い合わせメール、App Store Connectに登録する安定したプライバシーポリシーURLのうち未設定のものがあります。実在する公開連絡先やURLを確認するまで、仮の値は掲載しません。
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: 18 }}>
        <PolicySection title="運営者・お問い合わせ">
          {`運営者：${operatorName || "未設定（公開前に設定が必要です）"}\n問い合わせ先：${supportEmail || "未設定（公開前に設定が必要です）"}`}
        </PolicySection>
        <PolicySection title="取得・保存する情報">
          メールアドレスと、ログイン用パスワードを安全なハッシュ形式にした認証情報を扱います。プロフィールの表示名と写真、歩行中の位置・時刻・ルート、歩行時間・速度・移動距離・歩数、地図上に登録したスポット名・説明・位置・訪問時刻・写真、選択したグループと共有状態を扱います。歩数は端末センサーが利用できない場合などに距離から推定されることがあり、医療目的の計測値ではありません。歩行中の未保存ドラフトは、復帰のため端末内にも一時保存されます。
        </PolicySection>
        <PolicySection title="利用目的">
          アカウントの作成・ログイン、歩行ルートと健康指標の記録、地図表示、スポットや写真の保存、選択されたグループ内での共有、通報・ブロック等の安全確保、問い合わせ対応とサービス運営のために情報を扱います。位置情報の記録は、利用者が歩行計測を開始した間に行います。
        </PolicySection>
        <PolicySection title="共有範囲と外部サービス">
          歩行・スポットは利用者が選んだ公開範囲に従います。グループ共有の新しい記録やスポットは、グループ作成者が確認して承認するまで他のメンバーには表示されません。承認後はそのグループのメンバーが閲覧できます。地図画像を作成する際は、地図の中心・表示範囲・表示対象のルート座標やスポット座標を、Manusの地図プロキシを通じてGoogle Mapsの地図サービスへ送信します。アカウント、記録、写真はManusが提供するAPI・データベース・オブジェクトストレージ基盤で処理・保管します。
        </PolicySection>
        <PolicySection title="保存期間と削除">
          保存済みのアカウント情報、歩行記録、スポット、写真は、利用者が削除するかアカウントを削除するまで保管します。アプリ内でアカウント削除を開始すると、アカウントと関連するデータベース上の記録は削除されます。アップロード済み画像は、アプリ内から直ちに参照できなくなりますが、現行の保存基盤にはアプリから物理削除する機能がないため、アカウント削除またはプロフィール写真差し替えで不要になったファイルを運営者が削除するまで処理待ちとして扱います。ファイルがない場合は処理待ちになりません。旧セッションから削除済みアカウントが復活するのを防ぐため、内部セッション識別子のHMAC fingerprintを最大1年間保持し、期限切れの認証要求処理で削除します。通報記録は安全対応に必要な範囲で保持し、アカウント削除時には通報の自由記述を消去して投稿者情報を切り離します。端末内の歩行ドラフトはサーバー上のアカウント削除では他の端末から消せないため、端末側でもアプリデータを削除してください。
        </PolicySection>
        <PolicySection title="ログインとアカウント">
          現在のログイン方法はメールアドレスとパスワードです。メールアドレス確認とメールによるパスワード再設定は提供していません。パスワードを忘れないよう安全な場所に保管してください。
        </PolicySection>
        <PolicySection title="ポリシーの変更">
          機能や情報の取り扱いに変更がある場合は、この画面の説明を更新します。App Store Connectに登録する公開URLは、運営者が用意した安定したHTTPSのページを設定後に案内します。
        </PolicySection>
      </Card>

      {privacyPolicyUrl ? (
        <AppButton label="公開版のプライバシーポリシーを開く" variant="outline" onPress={() => void Linking.openURL(privacyPolicyUrl)} />
      ) : null}
      <AppButton label="お問い合わせ・コミュニティルール" variant="soft" onPress={() => router.push("/legal/support" as never)} />
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ paddingVertical: 8 }}>
        <Text style={{ color: brand.terracottaDark, textAlign: "center", fontFamily: typeface.bold, fontSize: 12 }}>戻る</Text>
      </Pressable>
    </Page>
  );
}
