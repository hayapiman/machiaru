# まちある（Machiaru）

GPSで街歩きのルートを記録し、距離・時間・速度・歩数を確認できるExpo / React Nativeアプリです。訪れた場所に写真やメモを残し、友人グループとルートやスポットを共有できます。

## 主な機能

- GPSルート、経過時間、速度、距離、歩数の記録と履歴表示
- 画面ロック中の位置記録に対応するバックグラウンド測位機能
- 訪問スポット、メモ、写真の登録
- グループ内の歩行記録・スポット共有、投稿承認、通報、ブロック
- メールアドレス＋パスワード認証、アカウント削除、プライバシー/サポートページ

バックグラウンド位置記録にはExpo Goではなくdevelopment buildが必要です。OSがアプリを強制終了した後の測位継続は保証しません。

## 技術構成

- モバイル: Expo SDK 58、Expo Router、React Native、TypeScript、NativeWind
- API: Express、tRPC
- データ: Drizzle ORM、MySQL
- 位置・地図: Expo Location、Expo TaskManager、Maps proxy
- デプロイ: API用Dockerfile (`Dockerfile`)

主なフォルダーは`app/`（画面）、`components/`（UI）、`hooks/`（歩行計測）、`server/`（API/認証/共有処理）、`drizzle/`（DB schema/migration）、`tests/`（unit tests）、`docs/`（運用・実機テスト資料）です。

## 開発

Node.js 22とpnpm 9.12.0を使用します。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

アプリとAPIの開発サーバーは`pnpm dev`で起動します。単体で起動する場合は`pnpm dev:metro`（Expo/Metro）または`pnpm dev:server`（API）を使います。

APIをローカルで起動するには、対応するManaged Servicesまたは自分で用意したサービスに対するサーバー側環境設定が必要です。`.env`、データベース接続文字列、署名鍵、API credentialはこのリポジトリに含めないでください。実ユーザーのManaged Databaseは開発/本番で共有されているため、ローカルテストから書き込み・削除を行わないでください。

`EXPO_PUBLIC_*`値はアプリbundleに含まれ、利用者から閲覧できます。公開API URLや公開連絡先など、公開して問題ない値だけを指定してください。`MANUS_JWT_SECRET`、`DATABASE_URL`、`BUILT_IN_FORGE_API_KEY`などのサーバーcredentialはクライアント設定へ渡さないでください。

## 現在の運用と配布

APIは[本番エンドポイント](https://machiaru-9ymngagw.manus.space/api/health)で稼働中です。プライバシーポリシーは[こちら](https://machiaru-9ymngagw.manus.space/api/legal/privacy)、サポートは[こちら](https://machiaru-9ymngagw.manus.space/api/legal/support)です。これらのAPI、Managed MySQL、写真Storage、Maps proxyはGitHub上のソースとは別に稼働し、GitHubへpushしても移転・停止・再デプロイされません。

現在の配布方針は[個人GitHubのソースリポジトリ](https://github.com/hayapiman/machiaru)での共有です（Private）。共有相手にはGitHubでCollaboratorとしてアクセスを付与してください。Managed Mobileの制約でGitHubをcanonical repositoryに切り替えられないため、GitHubは別コピーであり、Manus側の更新は自動同期されません。詳細は[GitHub共有・運用ガイド](docs/github-sharing.ja.md)を参照してください。

GitHubでコードを閲覧できることと、端末へアプリをインストールできることは別です。このリポジトリには配布用IPA/APKはありません。iOSのストア配布や署名済みbuild、Android向け直接配布には別途build・署名・配布設定が必要です。App Store公開は現在の目標ではありません。

## ライセンス

このリポジトリにはライセンスファイルがまだありません。公開設定にする場合、閲覧可能になることだけでは、第三者へ改変・再配布を許可するオープンソースライセンスの付与にはなりません。公開前に希望する利用条件を決めてください。
