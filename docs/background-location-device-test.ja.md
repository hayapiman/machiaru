# Machiaru 実機バックグラウンド計測テスト（Expo SDK 58）

## 目的と対応範囲

この手順は、画面をロックしたり別アプリへ切り替えたりした間に歩行位置を端末内へ保留し、Machiaruへ戻ったときに軌跡へ反映できるかを確認します。位置の線はバックグラウンド中に地図上へ描き続けるのではなく、アプリ復帰後に保留点を読み込んで更新されます。

背景測位はExpo Goでは利用できません。SDK 58のExpo Goは前景機能の確認用に限り、背景測位には`expo-dev-client`を含むdevelopment buildが必要です。OSがユーザーによるアプリ終了・強制停止を検知した後は位置更新が止まるため、強制終了中の歩行は記録されません。OSの制約により、常時の記録や再起動後の自動継続を保証しません。

## 事前準備

1. EASアカウントへログインできることを確認します。EASプロジェクトIDはまだこのリポジトリに紐付けられていません。初回のプロジェクト作成/リンクは、ユーザーが明示承認した後に`npx --yes eas-cli@latest init`で行います。EAS Cloud Buildの起動やプロジェクトリンクはアカウント操作とbuild quotaを伴うため、明示承認後に行います。
2. iPhoneの実機配布にはApple Developer Programの署名設定と、internal/ad hoc配布に登録済みの端末が必要です。EASが端末登録やApple資格情報の操作を求めた場合は、内容を確認してから続行してください。Androidはdevelopment profileからインストール用APKを作成します。
3. 歩行記録を保存すると共有Managed Databaseへ実データが書き込まれます。自分のアカウントで短いテストを行い、公開範囲は「自分のみ」にしてください。テスト用のアカウントや位置記録を作らないでください。保存した記録の削除も共有データへ影響するため、確認なく削除しないでください。
4. 背景位置permissionとiOS/Android native設定は`app.config.ts`に含まれています。これらのnative設定を変更した後は新しいdevelopment buildが必要です。Metroの再起動だけでは端末バイナリへ反映されません。

## iPhone（推奨）

1. 承認後、必要ならEASへログインして、EAS projectのリンクを完了します。iOS development buildは次のprofileで作成します。

   ```bash
   npx --yes eas-cli@latest build --platform ios --profile development
   ```

2. EASが求めた場合は、iPhoneのUDIDをinternal/ad hoc profileへ登録し、Apple署名設定を完了します。buildが完了したらEASのinstall linkからdevelopment buildをiPhoneへインストールします。
3. 開発マシンでMetroを起動します。

   ```bash
   pnpm dev:metro:dev-client
   ```

   インストールしたMachiaru development buildを開き、MetroのQRをdevelopment build内から読み取ります。Expo Goではなく、インストールしたMachiaruアプリを使ってください。
4. iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「まちある」で、位置情報を「常に」にし、「正確な位置情報」を有効にします。アプリ初回起動時は前景の許可を行い、続いて背景の許可が求められたら許可します。選択肢が表示されない場合は設定アプリから変更します。
5. 屋外でアプリを開き、ログインして「歩く」を開始します。GPSの精度表示が安定し、現在地マーカーが表示されてから、短い経路を歩きます。
6. 計測中に画面をロックするか、別アプリへ切り替えて2〜3分歩きます。Machiaruへ戻り、位置点が読み込まれてルート線と距離が更新されることを確認します。バックグラウンド記録の状態表示も確認します。
7. いったん一時停止し、画面をロックして同様に待ちます。停止中の移動が歩行ルートへ追加されないことを確認します。再開して少し歩き、終了・保存後に履歴の詳細と大きなルート地図を確認します。
8. 歩数が背景中に取得できない場合は、距離からの推定値へ切り替わることを確認します。推定と実測のラベルを区別してください。

## Android（必要な場合）

```bash
  npx --yes eas-cli@latest build --platform android --profile development
```

EASから取得したAPKをAndroid端末へインストールし、Metroは`pnpm dev:metro:dev-client`で起動します。アプリの位置情報を前景・背景の両方で許可し、バックグラウンド記録の継続に必要な位置情報通知も許可します。Androidのメーカー固有の電池最適化で停止する場合は、該当アプリのバックグラウンド実行を許可して再確認してください。

## Expo Goで前景機能だけを確認する場合

```bash
pnpm dev:metro:go
```

Expo GoはSDK 58で前景の画面、地図操作、記録開始中のGPS確認に使えますが、画面ロック中の背景測位テストには使えません。通常のMetroとdevelopment-client Metroは同じ8081ポートを使うため、同時には起動しないでください。

## 確認する結果と注意

- 背景許可後の計測では、復帰時に背景中の位置点が地図のルート線と距離へ反映されること。
- 一時停止中はルートが延びないこと。再開後は新しい位置点が追加されること。
- 保存後、履歴詳細と大きな地図ページで同じ経路を確認できること。
- 起動し直した場合は保存済みのローカル下書きが復元され、一時停止状態から再開できること。強制終了後の区間は復元できないこと。
- 失敗時は、build種別（Expo Goかdevelopment buildか）、OS、位置情報permission、画面ロック/復帰時刻、画面に表示されたエラーを記録します。アカウント情報、EXPO_TOKEN、正確な座標をログやスクリーンショットで共有しないでください。

## 公式資料

- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [EAS Build internal distribution](https://docs.expo.dev/build/internal-distribution/)
- [Expo Location SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/location/)
- [Expo TaskManager SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/task-manager/)
