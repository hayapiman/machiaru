import type { Express } from "express";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPublicContact() {
  const operatorName = (process.env.MACHIARU_OPERATOR_NAME ?? process.env.EXPO_PUBLIC_OPERATOR_NAME ?? "").trim();
  const supportEmail = (process.env.MACHIARU_SUPPORT_EMAIL ?? process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "").trim();
  return operatorName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)
    ? { operatorName: escapeHtml(operatorName), supportEmail: escapeHtml(supportEmail) }
    : null;
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="index,follow"><title>${title} | まちある</title>
<style>body{margin:0;background:#fbf7f0;color:#352a23;font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;line-height:1.8}main{max-width:760px;margin:0 auto;padding:32px 22px 64px}h1,h2{line-height:1.35}section{background:#fff;border:1px solid #e8ddd0;border-radius:16px;padding:16px 18px;margin:14px 0}a{color:#93452d}</style></head>
<body><main>${content}</main></body></html>`;
}

function unavailablePage(): string {
  return page("公開準備中", "<h1>公開準備中</h1><p>運営者名と問い合わせ先が設定されていないため、このページはまだ公開できません。</p>");
}

export function registerLegalRoutes(app: Express) {
  app.get("/api/legal/privacy", (_req, res) => {
    const contact = getPublicContact();
    if (!contact) {
      res.status(503).set("Cache-Control", "no-store").type("html").send(unavailablePage());
      return;
    }

    const { operatorName, supportEmail } = contact;
    const content = `<h1>プライバシーポリシー</h1><p>「まちある」は、街歩きのルート、歩行指標、訪問スポットを記録・共有するアプリです。</p>
<section><h2>運営者・お問い合わせ</h2><p>運営者：${operatorName}<br>お問い合わせ：<a href="mailto:${supportEmail}">${supportEmail}</a></p></section>
<section><h2>取得・保存する情報</h2><p>メールアドレスとパスワードのハッシュ、表示名・プロフィール写真、歩行中の位置・時刻・ルート、歩行時間・速度・距離・歩数、スポット名・説明・位置・訪問時刻・写真、グループと共有状態を扱います。パスワードそのものは保存しません。歩数は端末センサーが利用できない場合などに距離から推定される場合があり、医療目的ではありません。未保存の歩行ドラフトは復帰のため端末内にも一時保存されます。</p></section>
<section><h2>利用目的</h2><p>アカウント運用、歩行・スポットの記録、地図表示、選択されたグループでの共有、通報・ブロック等の安全確保、問い合わせ対応、サービスの運営に利用します。位置情報の記録は、利用者が歩行計測を開始している間に行います。</p></section>
<section><h2>共有と外部サービス</h2><p>歩行・スポットの公開範囲は利用者の選択に従います。グループ共有の新しい投稿はグループ作成者が承認するまで他のメンバーには表示されず、承認後は当該グループのメンバーが閲覧できます。地図表示のため、地図の中心・範囲・ルートやスポットの座標をManusの地図プロキシ経由でGoogle Mapsの地図サービスへ送信します。アカウント・記録・画像はManusが提供するAPI、データベース、オブジェクトストレージ基盤で処理・保管されます。</p></section>
<section><h2>保存期間と削除</h2><p>保存済みデータは利用者が削除するかアカウントを削除するまで保管します。アプリ内でアカウント削除を開始すると、アカウントと関連するデータベース記録を削除します。アップロード済み画像はアプリ内から直ちに参照できなくなりますが、アカウント削除またはプロフィール写真差し替えで不要になったストレージ上のファイルは、運営者が物理削除するまで処理待ちになる場合があります。旧セッションから削除済みアカウントが復活するのを防ぐため、内部セッション識別子のHMAC fingerprintを最大1年間保持し、期限切れの認証要求処理で削除します。通報記録は安全対応に必要な範囲で保持し、アカウント削除時には通報の自由記述を消去して投稿者情報を切り離します。端末内ドラフトはサーバー上のアカウント削除では他の端末から消せないため、各端末のアプリデータも削除してください。</p></section>
<section><h2>ログイン</h2><p>ログイン方法はメールアドレスとパスワードのみです。メールアドレス確認とメールによるパスワード再設定は提供していません。</p></section>
<section><h2>ポリシーの変更</h2><p>機能や情報の取り扱いに変更がある場合は、このページを更新します。お問い合わせは <a href="mailto:${supportEmail}">${supportEmail}</a> までご連絡ください。</p></section>
<footer><p>運営者：${operatorName} · <a href="mailto:${supportEmail}">お問い合わせ</a></p></footer>`;
    res.status(200).set("Cache-Control", "no-store").type("html").send(page("プライバシーポリシー", content));
  });

  app.get("/api/legal/support", (_req, res) => {
    const contact = getPublicContact();
    if (!contact) {
      res.status(503).set("Cache-Control", "no-store").type("html").send(unavailablePage());
      return;
    }

    const { operatorName, supportEmail } = contact;
    const content = `<h1>お問い合わせ・サポート</h1><p>「まちある」をご利用いただきありがとうございます。</p>
<section><h2>お問い合わせ先</h2><p>運営者：${operatorName}<br>メール：<a href="mailto:${supportEmail}?subject=%E3%81%BE%E3%81%A1%E3%81%82%E3%82%8B%E3%81%B8%E3%81%AE%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B">${supportEmail}</a></p><p>アカウント、位置情報、写真の削除、アプリの不具合についてご連絡いただけます。</p></section>
<section><h2>グループ共有と安全</h2><p>グループの新しい歩行記録やスポットは、グループ作成者が承認するまでメンバーへ表示されません。投稿や利用者の通報はアプリ内から送信でき、グループ作成者が確認して共有投稿を非公開にするなどの対応を行います。メンバー一覧から相手をブロックすると、互いの共有フィード、記録詳細、投稿写真、プロフィール写真が表示されなくなります。</p></section>
<section><h2>コミュニティルール</h2><p>本人の同意のない写真や個人情報、自宅など生活拠点を特定できる位置情報、嫌がらせ、差別、脅迫、性的・違法な画像、スパムを投稿しないでください。ルートやスポットを共有する前に、地図上の公開範囲を確認してください。</p></section>
<section><h2>プライバシー</h2><p>取得する位置情報、歩数、写真、グループ共有とアカウント削除については、<a href="/api/legal/privacy">プライバシーポリシー</a>をご覧ください。</p></section>
<footer><p>運営者：${operatorName} · <a href="mailto:${supportEmail}">メールでお問い合わせ</a></p></footer>`;
    res.status(200).set("Cache-Control", "no-store").type("html").send(page("お問い合わせ・サポート", content));
  });
}
