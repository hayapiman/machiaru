# まちある — GitHub共有向け実装計画

## プロダクト

「まちある」は、GPSによる街歩きの軌跡と健康指標を記録し、訪問スポットに写真やメモを残し、個人または友人グループで共有する縦持ちモバイルアプリ。既存の旅の手帖コラージュのデザインと安全機能を維持し、現在の配布方針はApp Storeではなく個人GitHubでのソース共有とする。GitHub共有はアプリのインストール配布やバックエンド移行とは別である。

## 実装方式

- **アプリ基盤**: 初期化済みのManaged Mobile Expo Router / React Native / TypeScriptを維持する。APIは同スターターのExpress + tRPC、永続化はDrizzle + Managed MySQL。固定ポート8081/3000とMobileのManus管理canonicalリポジトリを維持し、個人GitHubはソース共有用の別リポジトリとする。GitHubへの同期は自動ではなく、Managed Mobileのnative buildはGitHub-canonicalに対応しない。
- **認証**: アプリから選べるログイン方式をメールアドレス＋パスワードだけにする。登録・ログインは既存のscryptパスワードハッシュを使い、メール確認とメールでのパスワード再設定は提供しない。Manus OAuthのログインUI、コールバック画面、ログイン用APIルート、クライアント設定値は削除する。既存の有効なセッションとユーザーIDは壊さず、ログイン中の旧利用者がプロフィールからメール＋パスワードを設定して移行できるようにする。既存利用者が設定前にログアウト／アプリ削除した場合の復旧手段がない制約をログイン画面で案内する。Webでは`webdev_app_session` HttpOnly Cookieとタブ単位のBearer fallback、ネイティブではSecureStoreのBearer tokenを使う。HTTPS Previewでは`SameSite=None; Secure`を維持する。プラットフォーム署名secretはセッション検証用にサーバーだけで用い、ユーザー向けログイン方式とは混同しない。
- **アカウント削除**: プロフィールに削除導線と明示確認を追加し、サーバー側でメール資格情報、プロフィール、歩行ルート/指標、スポット/ノート、グループ所属を削除する。所有グループは最古の残存メンバーへ所有権を移し、残存メンバーがいない場合だけグループを削除する。利用者がアップロードした写真、プロフィール画像、プロフィール写真の差替で孤立する旧Storage keyを削除待ち台帳へ記録し、通常APIから即時に参照・取得できなくする。削除時には内部session IDをcookie signing secretでHMAC化したtombstoneを最大1年間持ち、別端末の有効な旧sessionからユーザー行が再生成されるのを防ぎ、期限切れ記録は認証要求処理で整理する。Managed Storageのランタイム契約には物理削除APIがないため、実ファイルはプロジェクト運営者がStorage管理面で削除するまで「削除処理中」とし、完了済みと誤表示しない。管理者は物理削除の後でのみ受付を完了にできる。
  削除transactionと既存session upsertは同一users rowを最初に`FOR UPDATE`でロックして直列化する。競合する実データを使ったDB stress testは行わない。
- **プライバシーと問い合わせ**: ログイン前から見られる日本語のプライバシー説明と問い合わせページをアプリ内に設け、公開HTTPS endpoint `GET /api/legal/privacy` と`GET /api/legal/support`を稼働させる。メールアドレス、プロフィール、歩行の精密位置/日時/距離/速度/歩数、スポット名/ノート/位置/写真、グループ共有範囲、保存先、共有相手、保持・削除方法、旧session再生成防止に使うHMAC fingerprintの期限付き保持を実動作に合わせて説明する。2026年11月6日時点で本番API URL、運営者名、公開用連絡先は登録済みで、health/privacy/supportが200を返すことを確認済み。公開値の実値はGitへ記載しない。
- **グループ内コンテンツ安全策**: グループ共有の歩行記録とスポット（添付写真を含む）は`pending`で保存し、グループ作成者の確認後にのみフィードへ表示する。作成者は承認または却下でき、却下された内容は共有されない。メンバーは共有記録/スポットや利用者を理由付きで通報でき、グループ作成者は報告を確認し、投稿を却下し、必要ならメンバーを除外できる。利用者のブロックを永続化し、ブロック関係にある利用者同士の共有内容を通常フィード/詳細、作成者向け承認待ちキュー、投稿写真/プロフィール写真の署名URL発行から相互に除外する。タイトルやノートの入力はサーバー側でも検証し、コミュニティルールと問い合わせ先をアプリ内で示す。
- **地図・歩行計測**: Google Maps Static Maps APIをプラットフォームMapsプロキシ経由でサーバー側取得する。APIキーはサーバーだけで使い、画面には歩行ルートをSVG線、訪問場所を最大200件のピンとして重ねる。Reanimatedで地図画像・軌跡・現在地を同時に即時移動/拡縮し、ドラッグ/ピンチは画像取得中も受け付け、操作が落ち着いて160ms後に最新viewportだけを要求する。GPS品質フィルター、速度平滑化、実測/推定歩数の区別、詳細地図ページを維持する。
- **バックグラウンド位置記録**: `expo-task-manager`のmodule-scope Location taskをroot layoutから登録し、歩行中にAlways/background権限が許可された場合だけ位置更新を使う。Androidではforeground-service通知を表示する。画面ロック/他アプリ使用中の位置イベントは端末内へ一時保留し、復帰時に既存のGPS品質フィルターを通す。OSがアプリを終了/強制停止した後の計測は保証しない。実機確認は物理端末の利用者が日本語手順書に沿って行う。
- **実行/配布設定**: Express APIはNode/pnpmを固定したroot `Dockerfile`でcontainer化し、無認証`/api/health`をdeployment readiness pathとして公開済み。運営者名・公開連絡先とprivacy/supportページもproduction設定済み。API、Managed MySQL、Storage、Maps proxyは個人GitHubに移管されず、既存のManus環境で稼働する。`eas.json`には従来のストアbuild profileが残るが、App Store build/Submitは現時点の目標ではない。GitHubにソースを置いてもiOS/Androidインストール用アプリは生成されない。サーバー秘密鍵をExpo公開extraやGitへ含めない。
- **不要な権限**: アプリで録音/動画再生を使っていないことをソース検索で確認し、未使用のaudio/video依存、マイク・バックグラウンド再生/PiP権限を外す。写真、位置、歩数に必要な目的文は日本語で正確に保つ。

- **GitHubソース共有**: 個人GitHubへのソース共有用リポジトリを新規作成し、秘密情報を除いた`main`とREADME/日本語ガイドをpushする。初期公開範囲はPrivateとし、Publicへの変更は所有者の明示判断がある場合だけ行う。ライセンスは所有者が選ぶまで追加しない。

## デザイン — 旅の手帖コラージュ

- **デザインムーブメント**: 紙地図、切符、写真シールを重ねた旅の手帖のコラージュ。地図と歩行計測は読みやすく、思い出の記録は温かく見せる。
- **コア原則**: 1) 歩行中の数値は一目で読める、2) 記録とスポット保存は片手で完結、3) 写真を街歩きの記憶として扱う、4) 個人/グループの公開範囲を操作時に明確にする。
- **色彩哲学**: 生成りの紙色を広い面に使い、テラコッタを操作とルートの主役色、マスタードを発見・達成の小さな印に使う。濃いインク色で可読性を保つ。
- **レイアウト**: 地図を主役にした縦スクロールと、親指で押せる記録アクション。グループ承認、通報、削除の確認は同じ紙片状カード/ボトムシートで、状態と取り消せない処理を文面で明確にする。
- **シグネチャー要素**: 1) 切符の切り欠きを思わせる活動カード、2) テラコッタ色の経路と丸い地点ピン、3) 横スクロールできる写真シール。
- **インタラクション**: 記録開始は片手で押せる大ボタン。一時停止/再開/終了は状態が色・文言で変わる。スポット作成と公開先選択を短いシートで行う。承認待ち共有は投稿者に状態を表示し、ブロック/削除は二段階で確認する。
- **アニメーション**: 地図のドラッグ/ピンチは指に即応し、取得済み地図画像と軌跡を同一の短い変形で動かす。保存時は短いチェック表示を使い、削除/通報確認では動きを控えめにする。
- **タイポグラフィ**: 見出しと本文はZen Maru Gothic、数値ラベルは端末の読みやすいサンセリフ数字を使う。大きな数値を中太、補助情報は小さくしつつコントラストを維持する。
- **ブランドエッセンス**: 「歩いた軌跡と町角の記憶を、ひとつの地図に残す。」— 温かい、好奇心のある、気軽。
- **ブランドボイス**: 見出しとCTAは親しみやすく具体的に。「歩いたぶんだけ、町が近くなる。」「今日の寄り道も、ちゃんと記録。」安全/削除では短く正確な日本語を使う。
- **ワードマーク/ロゴ**: 丸みのある「まちある」の文字に、足あとを思わせる点線とピンを添える。既存のアイコンを維持する。
- **シグネチャーカラー**: テラコッタ `#D05A3A`。

## プロジェクト構成

```text
app/
  (tabs)/index.tsx        地図、記録コントロール、スポット登録/詳細
  (tabs)/records.tsx      個人の歩行履歴
  (tabs)/groups.tsx       グループ作成/参加、共有地図、承認、通報/ブロック
  (tabs)/profile.tsx      表示名、写真、メール/パスワード設定、削除/Storage処理
  legal/privacy.tsx       ログイン前から閲覧できるプライバシー説明
  legal/support.tsx       問い合わせ/コミュニティルール
  walk/[id].tsx           保存済み歩行の詳細地図と指標
  walk/map.tsx            保存済み歩行の全画面ルート地図
components/
  login-gate.tsx          メール/パスワードのみのログインと新規登録
  map/static-map.tsx      Maps画像、SVGルート、パン/ピンチ、現在地
  spot-photo.tsx          認可済み署名URLから写真を表示
  demo-group-preview.tsx  DB書き込みのない読み取り専用デモ
hooks/
  use-walk-tracker.ts     前景/背景位置、歩数、ローカル下書き
constants/runtime.ts     API base URLと公開Legal情報
lib/_core/auth.ts        Web/native session token保存とログアウト
lib/background-walk.ts   TaskManager背景Location taskと端末内位置キュー
server/
  routers.ts              メール認証、削除、共有、承認、通報、ブロックAPI
  email-auth.ts           scrypt、メール資格情報照合、セッション発行
  account-deletion.ts     削除、共有グループ引継ぎ、Storage削除待ち台帳
  moderation.ts           相互ブロック判定のサーバー補助関数
  storage.ts              既存Managed Storage upload/署名URLアダプター
  _core/auth.ts           Cookie/Bearer sessionとWeb Preview bridge
  _core/account-session.ts HMAC化された削除session識別子
  _core/legal.ts          公開privacy/supportページ
  drizzle/schema.ts       既存テーブルと審査/通報/ブロック/削除要求/tombstone
  drizzle/0003_app_store_safety.sql, 0004_*  追加的なManaged MySQL migrations
tests/
  auth.logout.test.ts     email session logout/cookie test
  legal.test.ts           公開Legal route設定とescape test
  moderation.test.ts      相互ブロックの認可test
  account-session.test.ts 削除session fingerprintのHMAC test
docs/
  background-location-device-test.ja.md  実機の背景位置テストとOS制約
assets/images/             アプリアイコン、スプラッシュ、Androidアイコン
eas.json                   development/production build profiles
```

## データと画面の接続

- `use-walk-tracker`が前景の高精度GPSとPedometerを購読し、background taskが保留した位置点も復帰時に同じノイズ/飛び値フィルターで処理する。累積時間・距離・速度・歩数・精度をホーム画面に渡し、終了時に歩行点を活動レコードとして保存する。
- 写真はログイン済みtRPCアップロードからManaged Storageへ送り、DBに内部Storage参照を保持する。写真IDを受け取ったサーバーは本人所有またはグループ現メンバーであることとブロック状態を確認してから署名URLを返す。
- グループ共有の新規歩行とスポットは承認待ち状態で保存し、作成者が承認したデータだけフィードと共有地図へ返す。報告は永続化し、グループ作成者が対応する。ブロックは通常一覧・詳細・承認待ちキュー・投稿写真・プロフィール画像取得のすべてで有効にする。
- アカウント削除はMySQLのトランザクションで資格情報、プロフィール、個人記録、スポット、グループ参加を整理する。所有グループは残存メンバーへ引き継ぎ、アップロード済みStorageキーはアカウント削除・プロフィール画像差替の両方で削除待ち台帳に保持する。別端末の旧sessionによるユーザー再生成を止めるHMAC tombstoneは最大1年で期限切れとし、認証要求処理で整理する。物理Storage削除を確認した後にのみ待ち台帳を完了にできる。
- メール登録時はアドレスを正規化し、ユニークな資格情報行とアプリユーザーをトランザクションで作る。旧利用者は既存の有効なセッションを使ってメール/パスワードを設定できる。WebのHttpOnly CookieとBearer fallback、ネイティブのSecureStore、共通の`/api/auth/me`とログアウト処理を維持する。
- `/api/legal/privacy`と`/api/legal/support`はアプリ内画面からも参照される公開向け情報ページ。運営者名と連絡先が未設定の場合は、誤った連絡先を返さず503にする。

## 前提と制約

- Managed Mobileの固定Expoスターター、8081/3000、Manus管理リポジトリを維持する。Manusはアプリ画面のログインプロバイダーから外すが、Managed backend、Storage、Maps、署名済みセッション、Preview/cronのプラットフォーム基盤は残す。
- Managed Databaseは開発/本番で共有される。migrationは追記型にし、テスト中に実ユーザーの記録/写真/アカウントを削除しない。共有データの削除動作はモック/単体テストで検証する。
- Managed Storageの通常ランタイムAPIには物理削除がない。削除を「完了」と表示する前に運営者がオブジェクトを消す必要があり、その運用を公開前に整える。
- プライバシーポリシーの運営者表記、公開問い合わせメール、安定HTTPS URL、本番API URLはproduction環境に設定済み。公開値の実値をGitへ記録しない。
- iOS実機でのバックグラウンド計測は、開発ビルドの署名/端末登録と物理端末での利用者確認が必要。アプリ終了/強制停止後の計測は保証しない。
- iOS native release buildはManaged Mobile Dashboardを使う。現在はApp Store build/Submitを実施せず、ユーザーから再依頼があるまでストア公開を保留する。ユーザーの明示的な依頼なしにApp Store提出、公開、資格情報の失効/置換を行わない。プロジェクトの自動公開は無効。
- 地図APIキー、DB資格情報、署名情報、Expo tokenはサーバー/保護環境に限り、端末/ブラウザーへ秘密鍵を含めない。
- 歩数は環境によって距離由来の推定値となり、GPS精度や歩幅には個体差があるため医療用途の正確性を保証しない。
