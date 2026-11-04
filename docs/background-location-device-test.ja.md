# Machiaru 実機バックグラウンド計測テスト（Expo SDK 58）

## 目的と対応範囲

この手順では、画面をロックしたり別アプリへ切り替えたりしている間に歩行位置を端末内へ一時保存し、Machiaruへ戻ったときに軌跡へ反映できるか確認します。バックグラウンド中に地図画面へ線を描き続けるのではなく、復帰後に保留点を読み込んでルートと距離を更新します。

背景測位はExpo Goでは検証できません。SDK 58のExpo Goは前景機能の確認用に限り、背景測位には`expo-dev-client`を含むdevelopment buildが必要です。OSがユーザーによるアプリ終了・強制停止を検知した後は位置更新が止まるため、その間の歩行は記録されません。OSの制約により、常時の記録や再起動後の自動継続は保証しません。

## 現在の準備状況

- MachiaruはEAS projectへリンク済みです。`eas.json`にはdevelopmentとproductionのprofileがあります。**`eas init`を再実行する必要はありません。**
- iOS development buildはまだ作成されていません。Managed MobileではSandboxのEAS CLIではなく、Manus DashboardのMachiaruプロジェクトにあるMobile Build機能を使います。
- Apple Developer Programの有効なメンバーシップと、テストするiPhoneが必要です。
- `DistributionCertificate.p12`を持っていなくても、EASに新しい証明書とprovisioning profileを作成・管理させられます。証明書を手動登録する画面になった場合は、既存証明書を持ち込む経路ではなくEASの自動管理/作成を選びます。既存証明書の失効や置換の確認が表示され、その影響が分からない場合は停止してください。Appleのパスワード、2段階認証コード、証明書ファイルをチャットで共有しないでください。

## iPhone（推奨）

### 1. iOS development buildを作成する

1. Manus DashboardでMachiaruプロジェクトのMobile Build機能を開きます。
2. platformをiOS、build profileを`development`にしてbuildを開始します。App Store用の`production` profileではありません。
3. EASの案内に従ってApple Developerアカウントを接続し、EASが管理する署名資格情報を作成・利用します。手持ちの`DistributionCertificate.p12`がない場合、ファイルを探したり手動でアップロードしたりしないでください。
4. EASからiPhoneのUDID登録が求められたら、画面の指示に沿ってテスト端末を登録し、provisioning profileを更新してbuildを完了します。
5. build完了後、表示されるinstall linkをiPhoneで開き、Machiaru development buildをインストールします。

### 2. Development buildをMetroへ接続する

1. MachiaruプロジェクトのExpo/Metro development serverが起動していることを確認します（Previewは通常ポート8081を使います）。
2. iPhoneでインストールしたMachiaruを開き、Development Buildの画面から表示されているQRコードを読み取るか、現在のDashboard/Previewが示す接続方法を使います。固定URLを手入力したり、Preview URLをメモして公開したりしないでください。
3. Metroへの接続後、Machiaru画面が表示されることを確認します。接続できない場合は、端末と開発環境が同じネットワークで到達可能か、Metroが停止していないかを確認します。Expo Goを起動してしまった場合は、インストールしたMachiaru development buildへ戻ってください。

### 3. 背景位置を確認する

1. iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「まちある」で位置情報を「常に」にし、「正確な位置情報」を有効にします。初回起動時は前景の許可を行い、その後に背景の許可を設定します。選択肢が出ない場合は設定アプリから変更します。
2. 既にManusログイン中のアカウントを使う場合は、ログアウトする前にプロフィールでメールアドレスとパスワードを設定してください。現在のアプリはメールアドレス＋パスワードのみでログインします。移行前にすべての端末でログアウトすると、アプリ内の復旧手段がありません。
3. 屋外でアプリを開き、ログインして公開範囲を「自分のみ」に設定し、「歩く」を開始します。GPS精度表示が安定し、現在地マーカーが表示されてから短い経路を歩きます。
4. 計測中に画面をロックするか、別アプリへ切り替えて2〜3分歩きます。Machiaruへ戻り、位置点が読み込まれてルート線と距離が更新されること、背景記録状態が表示されることを確認します。
5. 一時停止し、画面をロックして同様に待ちます。停止中の移動が追加されないことを確認します。再開して少し歩き、終了・保存後に履歴詳細と全画面のルート地図を確認します。
6. 背景中に歩数を取得できない場合は、距離からの推定値へ切り替わること、推定値と実測値のラベルが区別されることを確認します。

## Android（任意）

iOSと同じくManus DashboardのMobile BuildからplatformをAndroid、profileを`development`にして作成します。EASの案内に従ってdevelopment buildをAPKとしてインストールし、端末の位置情報を前景・背景の両方で許可してください。バックグラウンド記録に必要な位置情報通知を許可します。メーカー固有の電池最適化で停止する場合は、そのアプリのバックグラウンド実行を許可して再確認します。

## Expo Goで前景機能だけを確認する場合

Manus DashboardのPreview/Connect Expo機能から、現在のExpo Go接続用QRコードを表示して使用します。Expo GoではSDK 58の前景画面、地図操作、記録中のGPS確認はできますが、画面ロック中の背景測位はテストできません。Expo Go用Metroとdevelopment-client用Metroは同じ8081ポートを使うため、同時には起動しないでください。

## 確認結果と注意

- 背景許可後の計測では、復帰時に背景中の位置点がルート線と距離へ反映される。
- 一時停止中はルートが延びず、再開後に新しい位置点が追加される。
- 保存後、履歴詳細と大きな地図ページで同じ経路を確認できる。
- 画面ロック中の動作と、ユーザーがアプリを強制終了した後の動作を区別する。強制終了後の計測は保証されない。
- 実データを保存する際は自分のアカウントと短いテスト経路だけを使い、公開範囲は「自分のみ」にする。共有Managed Databaseにある実記録をテストのために削除しない。
- 失敗時はbuild種別、OS/iOS version、位置情報permission、画面ロック/復帰時刻、画面に表示されたエラーを記録します。アカウント情報、`EXPO_TOKEN`、正確な座標はログやスクリーンショットで共有しないでください。

## 公式資料

- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [EAS Build internal distribution](https://docs.expo.dev/build/internal-distribution/)
- [Expo Location SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/location/)
- [Expo TaskManager SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/task-manager/)
