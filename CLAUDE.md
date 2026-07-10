# 開発規約・メモ（EIGHTBASE）

## プロジェクト概要
EIGHTBASEはエイトデザイン株式会社の中川新社屋向けLINEミニアプリ。
コワーキングスペース利用者向けコミュニティプラットフォーム。

主な機能:
- **メンバー管理**: プロフィール登録（3ステップ: 基本情報→会社名/職種/業種→スキル/SNS）、メンバー一覧・検索
- **カレンダー/予約**: 施設予約・イベント管理
- **麻雀リーグ**: シーズン制リーグ戦（M1/M2/M3）、CS（チャンピオンシップ）、スコア申告、3Dピラミッド表示
- **管理画面**: ユーザー管理、シーズン管理、カレンダー管理
- **招待**: メール送信（Resend）+ ワンタイムパスワード方式
- **プレビューモード**: 認証不要で全画面閲覧可能（iPhoneフレーム表示）

技術スタック: Next.js / Firestore / LINE LIFF / Vercel

**注意: Square 決済は現在無効。** 有料施設（`requirePayment=true`）はportalからオンライン予約不可。`src/lib/square.ts` は将来用に残存。

## UI 規約

### カレンダー／日時入力は必ず自作コンポーネントを使う
ネイティブの `<input type="date">` / `<input type="time">` / `<input type="datetime-local">` は**使用禁止**。
OS依存のカレンダーUIになり、デザインがバラつくため。必ず以下の自作コンポーネントを使う:

- 日付: `src/components/ui/DatePicker.tsx` … `<DatePicker value onChange placeholder />`
- 時刻: `src/components/ui/TimePicker.tsx`
- 日時: `src/components/ui/DateTimePicker.tsx`

新規画面・既存画面の修正時もこの規約に従うこと。

## クライアントキャッシュ運用（portal 表示の高速化）

再訪時の「空白/スピナー」を減らすため、**表示の高速化に限定した**軽量クライアントキャッシュを使う。
鮮度・整合性の最終判断は必ずサーバーに残し、キャッシュは UX 改善のためだけに使うこと。

### 仕組み
- `src/lib/swrCache.ts` … sessionStorage ベースの stale-while-revalidate helper（保存時刻つき / キーごとTTL）。
- `src/hooks/useStaleWhileRevalidate.ts` … 「前回値を即表示 → 裏で再取得 → 差し替え」を行う React hook。
  - 初回（キャッシュ無し）だけ `isLoading`、裏更新中は `isValidating`（"更新中" 表示に使う）。
- `src/lib/timelineCache.ts` … 掲示板専用の軽量キャッシュ。
- 保存先は原則 **sessionStorage**（共有端末・アカウント切替で個人データが残らないよう、セッション終了で消える側を既定にする）。
- 全 API fetch は `cache: "no-store"`、対応する API も `Cache-Control: no-store` を返す（鮮度管理はクライアント側に一元化）。

### キャッシュしてよい対象（TTL）
- 施設一覧 `facilities`（10分）、メンバー一覧/プロフィール `members`（5分）、ニュース `news`・イベント `events`（3分）、掲示板 `timeline`（30秒）。

### ⚠️ 注意して扱う対象（短時間 + 「更新中」表示 + サーバー再検証前提）
- **空き状況** `avail:*`（30秒）… 古い表示はダブルブッキングの原因。前回表示を残しつつ常に裏で取り直し、古い可能性がある間は「更新中」を出す。**予約確定は `POST /api/reservations` が `checkAvailability` で必ず再検証**（409 ALREADY_BOOKED）するため、表示が多少古くても事故にはならない。この再検証を外さないこと。
- **自分の予約一覧**（`/my-reservations`）… 現状はキャッシュせず都度取得。もしキャッシュするなら短時間に限定し、予約作成/キャンセル後は必ず破棄すること。
- **マイページ** `mypage`（個人データ: 投稿数・予約数・スキル等）… `ttl:0` で毎回 revalidate（前回値は即表示しつつ常に最新を取得）。個人データなのでキャッシュしすぎない。

### ❌ キャッシュ禁止（常に都度取得 / サーバー判定）
- **認証状態**（`/api/auth/check` の authorized）
- **profileComplete**（プロフィール完了判定）
- **決済状態**（金額・残高・課金可否）
- **予約確定処理**（`POST /api/reservations` の空き再検証）

### ユーザー切替時のキャッシュ破棄
- ログイン/ログアウト等で認証状態が変わるときは `clearAuthCache()`（`src/components/AuthGuard.tsx`）が
  `clearAllCache()` + `clearPostsCache()` を呼び、全表示キャッシュを破棄する。
- さらに AuthGuard は `/api/auth/check` の `lineUserId` をキャッシュ所有者（`getCacheOwner`/`setCacheOwner`）と
  突き合わせ、**ユーザーIDが変わっていたら**前ユーザーの表示キャッシュを破棄する（明示ログアウトを経ない切替の保険）。
- 新しい画面でキャッシュを足すときも、これらの破棄経路（`clearAllCache` 対象 = `swr:` プレフィックス）に乗ること。

## ブランチ運用
- `develop` で作業 → 確認後 `main` に反映（fast-forward）。
- 本番は `main`（Vercel 本番デプロイ）。

## 麻雀リーグ（現行仕様の要点）
- シーズンは**種目別**（`Season.gameCategory`）。麻雀の処理は `getActiveSeason("mahjong")`。
- リーグ戦: 参加表明 → 参加費支払い → **GMがゲーム開始（＝受付締切）** → **GMが半荘ごとに卓を手動振り分け** → 各自スコア申告(ミニアプリ) → 通算アベレージで順位 → 月次でリーグ確定(M1/M2/M3)。
- スコアは利用者がミニアプリで申告。管理画面は確認・修正のみ。
- CS（チャンピオンシップ）: **誰でも参加可**。リーグ上位はシード権で有利になるだけ（出場制限なし）。
- 日程の種別は**リーグ戦のみ**（CSは麻雀CSタブで個別管理）。
- 利用者アプリのタブ: **リーグ / 参加 / 卓確認・申告 / CS / ルール・約款**。

### ゲームマスター（GM）運用 ← 当日フローの中心
- GM は `Season.gameMasterIds`（管理画面のシーズン編集で複数選択）。**空 = 従来どおりの自動進行**（後方互換）。
- **⚠️ 本番のアクティブな麻雀シーズンには GM を1名以上設定すること。** 未設定だと受付が締まらず、流会もできない。
- 当日の流れ:
  1. GM が「ゲーム開始（受付を締め切る）」→ `mahjongDayState.entryClosedAt` を打刻。**押した瞬間が締切**で、以降は参加表明も参加費の支払いも不可（`POST /api/mahjong/day/start`）。支払い済み4名未満は開始できない。
  2. GM が半荘ごとに卓を手動振り分け（`POST /api/mahjong/day/assign`）。**卓はちょうど4名**、余りは待機（抜け番）。
  3. 確定すると振り分けUIは畳まれ、**二重確定はサーバーが409で拒否**。両卓の申告が揃うと round+1・`awaitingAssignment=true` に戻り、UIが自動復帰する。
  4. 人数不足・雨天等は GM が「この開催日を中止（流会）」（`POST /api/mahjong/day/cancel` → `cancelDay`）。人数の下限なし。**卓が立っていたら409**（成績が壊れるため）。
- **廃止済み**: `Season.mahjongStartTime`（時刻による支払い締切）／`cron/mahjong-forfeit`（人数不足の自動中止）／参加タブの卓確認（`day/snapshot` API）。

**GM実装で踏んだ罠（壊さないこと）**
- 対象の半荘は**サーバーの `dayState.round` が唯一の真実**。クライアントから `round` を受け取らない。
- `advanceDayIfRoundComplete` の `tx.set(dayRef, …)` は**既存フィールドを引き継ぐ**（`entryClosedAt` を落とすと半荘ごとに「ゲーム開始」へ戻る）。
- `awaitingAssignment=true` の間に残る卓は自動進行時代の**残骸**。ロックにも下書きにも使わない（`isAssignmentLocked`（`src/lib/mahjongAssign.ts`）を GET/POST で共有する）。
- 卓振り分けUIは **Pointer Events**（`MahjongGmAssignPanel.tsx`）。HTML5 の drag はタッチで発火せず、LINEミニアプリでは動かない。`Chip`/`DropZone` はトップレベルで `memo` 化し、指の座標は ref + `requestAnimationFrame` で `transform` を直接書く（state に入れると毎フレーム再マウントしてカクつく）。

### ルール・約款
- `Season.rulesMarkdown` / `Season.termsMarkdown`（Markdown）。シーズンは種目別なので「種目ごと × シーズンごと」になる。
- 管理画面のシーズン編集で入力（`TermsEditor` を再利用）。利用者は「ルール/約款」タブで**閲覧のみ**（同意フローなし）。取得は `GET /api/games/rules?gameCategory=`（ログイン必須）。
- Markdown は `react-markdown` + **`remark-gfm`**（表・取消線・自動リンク）。`remark-gfm` を外すと表が素の `|` で出る。
- 全角記号に挟まれた `**太字**` は CommonMark の仕様で強調にならない（前後に半角スペースを入れて回避）。
- 配色（TILES案・現行）: M1 `#a2125a` / M2 `#1172a5` / M3 `#b48f13`（深いジュエル調。3Dピラミッドと順位リストで一致）。CSメダルは 金`#d8a526` 銀`#b9c0c6` 銅`#c97b3c`。CSS変数 `--eb-league-m1/m2/m3`（globals.css）。
  - ※ 旧表示色（マゼンタ#E4007F / シアン#00A0E9 / イエロー#F5B400）から TILES案DS色へ変更済み。

### 麻雀UI（TILES案・デザインハンドオフ反映）
- **リーグ**: `LeaguePyramid3D.tsx`（Three.js の四角錐スタック・確定版／左固定ゴールドラベル[Noto Serif JP]／自分のアバター浮遊＋「あなた」／spin・sway・off／reduced-motion・WebGL非対応フォールバック／アンマウントでGPU資源dispose）を `LeaguePyramid.tsx` のアイボリー帯ヒーローに配置。直下に M1/M2/M3 順位リスト（YOU強調・順位/戦数/1位/連対率/AVG）。
- **参加/当日の卓/スコア申告**: `MahjongLeagueView.tsx`。参加=日付カード＋参加する/参加中（**卓の中身は見せない**。確定済みはバッジのみ）。当日の卓=緑フェルトボード＋席(東南西北は卓内並び順から付与)・自席強調・持ち点/着順・n/4申告。申告=持ち点＋1〜4着のダイアログ。アクセントはフェルト緑 `#2f7d57`。GM には同じタブに `MahjongGmAssignPanel` が出る。
- **CS**: `MahjongCsView.tsx`。決勝卓の確定結果から金銀銅の表彰台（王冠・持ち点）＋トーナメント表（`MahjongCsEntrant.seed` でSEED、勝ち上がりを緑強調、決勝はゴールド）。
- いずれも**リーグ仕様・API（standings/entries/tables/report/cs）は不変。UIのみ差し替え**。タブ/シェルも不変。
- アバターは `/api/avatar` プロキシ経由（WebGLのCanvasタイント回避にcrossOrigin必須）。
- 既知の簡略化: 順位リストのアベレージ推移スパークライン（履歴データ無し→省略）／当日の卓のB卓・見学者（`tables?mine=1`は自分の卓のみ→省略）／席順は卓内並び順から割当。


## トレーラー予約時の決済について
- Squareの決済URLをボタンで配置（Portal）。
  -　トレーラー選択→日付選択で「決済する」ボタンが表示
  - 指定したSquareの決済URLへ遷移
  - Squareにて決済完了→リダイレクトURLで予約完了画面へ遷移。
- 金額は2万円

### トレーラー / SwitchBot の状況（2026-07-07時点）
- 現地の Hub Mini・ロックは**取付・クラウド接続済み**（アプリからの遠隔施解錠OK）。
- ⚠️ **ブロッカー: SwitchBot OpenAPI `GET /v1.1/devices` が空（0件）**。認証は成功(statusCode 100)・トークンは所有アカウント一致・アプリは遠隔操作可、にもかかわらず deviceList が空。ログアウト/再ログイン・トークン再取得でも改善せず。→ **アカウント登録リージョン(データセンター)と OpenAPI エンドポイントの不一致**が濃厚。
- **担当（SwitchBotサポート/社内）からの連絡待ち**。依頼内容: 「OpenAPI で deviceList が空。アカウントのDCを OpenAPI 対応リージョンへ移行してほしい」。
- 切り分けCLI: `node scripts/switchbot-devices.mjs`（`.env.local` の SWITCHBOT_TOKEN/SECRET を使用。`createkey/deletekey` で実機テストも可）。
- **暫定運用は実装済み**（下記「SwitchBot未連携時の暫定運用」）。連絡後の再開タスク:
  - deviceId が取得できたら、管理画面のトレーラー施設に `switchBotDeviceId` を登録するだけで自動発行が有効化（アプリ側コード変更不要）。
  - 実機で「予約→決済→時限パスコード発行→解錠→時間外無効→取消で失効→再発行」を通しテスト。

### SwitchBot未連携時の暫定運用（実装済み・2026-07-07）
- `reservations/complete`: 要解錠施設（`paymentAmount>0`＝トレーラー）は SwitchBot 未連携(`switchBotDeviceId`未設定)/発行失敗でも**予約は確定**。
  - 未連携→ `switchBotStatus="manual"`＋管理者通知 `switchbot_manual`（手動解錠対応）＋監査 `unlock.manual`。
  - 失敗→ `switchBotStatus="failed"`＋通知 `switchbot_failed`＋監査 `unlock.failed`。
  - 利用者画面（完了/マイ予約）は「解錠コードは準備が整い次第、管理者からご連絡します」。
- 監査ログ: `reservationAuditLogs`（`src/lib/reservationAudit.ts`。token/secret/署名は記録しない）。

## サーバー実装の規約

### 本番は TZ=UTC。日付文字列から曜日を出すときは `getDay()` 禁止
Vercel のサーバーは UTC で動く。`new Date("2026-07-11T00:00:00+09:00").getDay()` は**前日の曜日**を返す（土曜→金曜）。
ローカルは JST なので再現せず、本番だけ壊れる。実際にサウナ（土曜のみ営業）が本番で予約不能になった。
- 曜日は `dayOfWeek()`（`src/lib/date.ts`＝UTC正午基準の `getUTCDay()`）を使う。同方式: `isSaturdayMahjongDate`。
- サーバーコードで日付文字列に `getDay()` / `getMonth()` / `getDate()` を使わない。
- **テストは `TZ=UTC` で走らせる**（`package.json` の test スクリプトで固定済み）。JSTで流すと壊れた実装でも通る。
  jest 内で `process.env.TZ` を代入してもTZは変わらない（プロセス起動時に決まる）。

### Firestore の読み取りを浪費しない
麻雀のクエリは `where("seasonId","==",…).where("eventDate","==",…)` で**当日分に絞る**（等値2条件なので複合インデックス不要）。
シーズン全件スキャンは開催を重ねるほど重くなり、実際に demo で日次無料枠5万件を焼き切って全APIが `RESOURCE_EXHAUSTED` で落ちた。
ポーリングを足すときは必ず先に絞ること。※`api/mahjong/day/route.ts`・`lib/mahjongDay.ts` などに未対応の全件スキャンが残っている。

## 実装状況サマリ（主要機能の現行仕様）

### API 認可（`src/lib/auth.ts`）
- `requireActiveUser(req)`: セッション＋`authorizedUsers.active=true` を確認。**閲覧系**API（一覧・詳細・GET）で使う。
- `requireProfileComplete(req)`: 上記＋`profileComplete=true`。**操作系**（投稿作成/いいね/コメント/予約POST/麻雀の参加表明・申告）で使う。
- 例外（プロフィール登録前に必要）: `/api/auth/liff-login` `/api/auth/invite` `/api/auth/profile` `/api/auth/check`。
- プレビューモードは GET のみ仮ユーザーを返す（読み取り専用）。
- `active=false` は API 直叩きでも拒否、`profileComplete=false` は操作系が 401。

### 予約の二重予約防止（`src/lib/reservations.ts` / `src/app/api/reservations/route.ts`）
- `validateReservationSlot()` を **availability系APIと予約POSTで共用**（過去日・曜日・営業時間・固定枠/最低利用時間・`requireTerms`→`termsAgreed`）。
- 予約POSTは Firestore transaction 内で `facilityId+date` の `reservationLocks` を読み、`intervalsOverlap()` で**時間帯の重なりを判定して拒否**（完全一致キーだけに依存しない）。Google Calendar `checkAvailability` は補助。
- 空き状況の鮮度はクライアント側 `avail:*`（30秒・「更新中」表示）。最終判定はサーバー。

### 決済（現状すべて無効）
- `/api/payments`・`/api/payments/config` は先頭で `501 PAYMENT_DISABLED` を返す。
- 予約APIは `paymentId` を受け付けず、`requirePayment=true` 施設はオンライン予約不可。
- `src/lib/square.ts` は将来用に残置（未使用）。※トレーラー決済は上記「Square決済URLをボタン配置」の別方式で別途検討。

### LINE 認証フロー（`/` と `/login`）
- 共通処理 `runLiffServerLogin()`（`src/lib/liff.ts`）を両画面で使用。
- 環境判定 `detectEnv()`: `?env` 優先、無ければホスト名（localhost→dev / *.vercel.app→review / その他→prod）。**prodで dev LIFF ID にフォールバックしない**。
- 連携成功時は `clearAuthCache()`＋`profileComplete` で分岐（未完了は `/setup-profile` 直行で往復を防止）。
- 招待は**メール+ワンタイムパスワード方式**。未連携でも OTP は自動表示せず、`/` は「招待が必要」案内、OTP入力は `/login` の明示導線のみ。
- ログアウト: `initLiff()` 後 `liff.logout()`＋フラグで `/` の自動再ログインを抑止（「ログアウトしました」画面＋明示ログイン）。ログアウトは `/api/auth/logout` に一本化。
- AuthGuard の認証キャッシュは 60 秒（表示キャッシュとは別扱い。最終判定はサーバー）。

### メンバー一覧・掲示板（デザインハンドオフ準拠）
- 共通UI: `src/components/ui/Sheet.tsx`（BottomSheet/CenterModal）、`src/components/ui/LineContact.tsx`（Avatar/LineGlyph/SNSグリフ/SheetButton 等）。
- メンバー: プロフィールカバー型カード＋スキルチップ絞り込み、タップで詳細ボトムシート（bio/スキル/リンク欄[会社URL・SNS]）。
- 掲示板: 下線タブ＋カード（状態Badge・いいね）、タップで詳細シート、FABから新規投稿シート（種別＋本文＋タグ最大5）。**コメント機能は無し**。
- どちらも詳細は**ボトムシート**（`/members/[id]`・`/timeline/[id]` ルートはディープリンク用に残置）。

### 「LINEで連絡」= 友だち追加URL方式（botは使わない）
- 各メンバーが **LINE友だち追加URL**（`memberProfile.lineUrl`）を登録（初回プロフィール=任意、マイページ→スキル・サービス設定でも編集可）。`profileComplete` の必須項目にはしない。
- 「LINEで連絡」は**相手の友だち追加URLを開く**（`openExternalUrl()`＝LIFF `openWindow(external)` / `window.open`）→ B が A を直接追加して個別トーク。**メッセージ送信・bot中継はしない**。
- 未登録の相手はボタン無効＋案内表示（＝登録した人だけ直接つながる方針）。
- 掲示板の「LINEで連絡」は `/api/posts` が投稿者の `lineUrl` を一括取得し `authorLineUrl` として配信。

### プロフィール項目（`memberProfile` / `authorizedUsers.profile`）
- 公開系: `companyName` / `jobTitle` / `industry` / `skills` / `catchphrase` / `bio` / `companyUrl` / `socialLinks{instagram,x,facebook,other}` / `lineUrl`。
- 旧 `occupation` は廃止方針（後方互換で `companyName` にフォールバック）。

### 管理画面ユーザー詳細（`/admin/users`）
- `/api/admin/users` は `authorizedUsers.profile` に加え `users.memberProfile` も返す。
- 詳細パネルで全項目表示（基本情報＝会社名/職種/業種、別途「プロフィール・スキル」節＝キャッチコピー/スキル/自己紹介/会社URL/SNS/LINE連絡先）。

### games API
- `/api/games/ranking`・`/api/games/cs`・`/api/games/rules` はログイン必須（未ログイン取得不可）。ランキングのシーズンは `gameCategory` 対応。応答から不要な `lineUserId` は除去。

### 詳細ページ
- `news`/`events`/`games` は個別GET（`/api/news/[id]` `/api/events/[eventId]` `/api/games/[gameId]`）で取得し、一覧の `limit` に依存しない。