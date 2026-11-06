# GitHub共有・運用ガイド

**更新日：2026年11月6日**

## いまの方針

App Storeの有料配布は現在の目標から外し、個人GitHubでソースを共有する方針です。2026年11月6日に [hayapiman/machiaru](https://github.com/hayapiman/machiaru) をPrivate（非公開）で作成し、検査済みの`main`を初回pushしました。共有相手にはGitHubでCollaboratorとしてアクセスを付与してください。Publicに変更する場合は、ソースを一般公開してよいことを確認してから行います。

### GitHubで共有できるもの

GitHubにはアプリ/APIのソースコード、ドキュメント、migration、テストを保存できます。Privateのままなら、指定した相手をCollaboratorとして追加できます。誰でも見られるようにするにはPublicへ変更しますが、このプロジェクトには第三者利用や再配布を許可する`LICENSE`がまだありません。公開するだけではオープンソースライセンスは付与されないため、公開前に希望する利用条件を決めてください。

### GitHubでは移らないもの

GitHubへのpushは、インストール用のiOS/Androidアプリを作成したり、既存のAPIやデータベースをGitHubへ移したりしません。APIは現在`https://machiaru-9ymngagw.manus.space`で稼働しており、Managed MySQL、写真Storage、Maps proxyも別のManus運用環境にあります。そこで利用者が追加した歩行ルート、写真、アカウント情報はGitリポジトリには含まれませんが、APIは公開利用者データを扱う本番サービスです。動作確認目的で本番データを変更・削除しないでください。

このプロジェクトはManaged Mobileです。native buildがGitHub-canonicalを受け付けないため、GitHubはManusのcanonical repositoryに代わるものではなく、独立したソース共有用コピーです。Manus側で今後変更したコードがGitHubへ自動同期されることはありません。GitHubで直接行った変更も、Manus側のアプリ/APIへ自動反映されません。

## 他の人にアプリを試してもらう

GitHubリンクを送ると共有できるのはソースコードです。スマートフォンにインストールできるアプリの配布ではありません。手元でソースを動かすにはNode.js、pnpm、Expo、API用の環境設定が必要です。サーバー秘密鍵やデータベース資格情報はリポジトリに含めず、Managed backendを使う場合もproduction databaseへの不用意な書き込みを避けてください。

Expo Goは画面確認などの開発プレビュー用です。バックグラウンド位置記録を検証するには、位置情報権限を含む署名済みdevelopment buildを用意し、実機へインストールする必要があります。iOSで署名済みアプリを他人へ配布することや、App Storeで配布することはGitHubだけではできません。`eas.json`には以前のbuild設定がありますが、development buildの署名、実機検証、iOS配布はまだ完了していません。

また、EAS Updateは互換性のあるアプリ本体が端末へ既に入っている場合のJavaScript更新手段であり、初回インストール用アプリやネイティブ機能変更時のbuildの代わりにはなりません。このプロジェクトではEAS Updateの配布設定も完了していません。

## 秘密情報の扱い

`.env`と`.env.*`はGitから除外し、例示用の`.env.example`だけを追加できる設定にしています。公開API URLや公開連絡先などの`EXPO_PUBLIC_*`値はアプリbundleに含まれるため、秘密として使ってはいけません。`MANUS_JWT_SECRET`、`DATABASE_URL`、`BUILT_IN_FORGE_API_KEY`、Expo token、署名ファイル・passwordなどをGitHubへcommitしないでください。

今回の確認では、pushしたGit履歴全体を対象に、追跡された`.env`/証明書ファイルと一般的な秘密鍵・GitHub/API credential形式がないことを検査しました。この自動検査は全種類の秘密情報を保証するものではないため、Public設定へ変える前にも新規変更を確認してください。誤って秘密をcommitした場合、ファイルを削除しても履歴に残るので、該当credentialを失効・更新してください。

## App Store資料

以前作成したApp Store公開手順書は旧資料としてプロジェクト外に保管しています。現在はApp Store build、App Review、公開を進めていません。再開する場合は、Apple Developer登録、署名、production build、プライバシー情報などを改めて確認してください。
