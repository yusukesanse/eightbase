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
- 利用者アプリのタブ: **リーグ / 参加 / 対戦記録 / CS / ルール・約款**（タブ名は4種目で統一）。
  「対戦記録」タブは**その開催日の参加者にだけ**中身を出す。それ以外は共通の
  `DayTabPlaceholder`（「参加当日に表示されます」）を出す＝4種目で同一。
  ⚠️ 判定は **`if (!day || !day.iAmParticipant)`** と書くこと。`day &&` で条件づけると
  シーズン未作成・APIエラーで day が null のときに進行UI（GM選出ボタン等）が
  非参加者に見えてしまう（実際に本番で発生）。

### 参加費 Square 決済の戻り先 ← ロールで壊れるので注意（2026-08-03 本番障害）
**戻り先は必ず `/games`（全ロールが入れる唯一の共通導線）。会員専用ルートにしないこと。**
定義は `src/lib/gamePaymentReturn.ts` の1箇所だけ。pay ルート・`GamesHub`・`/info` はここを参照する。

- 起きたこと: ゲストが参加費を払ったのに当日「未払い」で参加できなかった（**ゲストのみ**）。
- 原因: 戻り先が `/info?dartspay=<entryId>` だった。`/info` は会員専用なので
  `AuthGuard` が role=guest を弾き `router.replace("/games")` → **クエリごと消える** →
  `?dartspay=` を読む確定処理が動かず `/api/{game}/entries/complete` が呼ばれない →
  エントリーは `paymentStatus: "pending"` のまま＝当日名簿で未払い。
  会員は `/info` に入れるため転送が成功し、**ゲストだけ**が壊れた。
- 直したこと:
  1. 戻り先を `/games` に変更（`gamePaymentReturnPath()`）。ロールで壊れない構造にする。
  2. `AuthGuard` がゲーム限定ロールを送り返すとき、**決済パラメータを引き継ぐ**
     （`gamesOnlyRedirectTarget()`）。発行済みで未確定の古い `/info` 戻りリンクの救済。
  3. パラメータ↔種目の対応が pay ルート4本・`GamesHub`・`/info` に散っていたのを1箇所に集約。
     散っていたせいで「どのロールがどのパスに入れるか」と噛み合っているか誰も検証できなかった。
- ⚠️ `isGuestAllowedPath()`（AuthGuard）と `GAME_PAYMENT_RETURN_BASE` は**必ず一致させる**。
  片方だけ変えると同じ障害が再発する。回帰テスト `__tests__/unit/lib/gamePaymentReturn.test.ts`
  が「戻り先がゲスト許可パス配下か」を検証している。
- ⚠️ 仮押さえTTLは15分（`PENDING_TTL_MIN`）。確定が走らないまま15分過ぎると
  `complete` は 410 を返し**返金**へ回る＝**利用者側の操作では二度と支払い済みにできない**。

#### 取りこぼしの復旧（管理画面「参加費・返金」タブ → 入金確認待ち）
課金は成立しているのに未払いのまま残ったエントリーを、管理者が支払い済みに戻せる。
上記障害の復旧用に作ったが、通常運用の取りこぼしの受け皿でもある。
- 実体は `src/lib/gameEntryPayment.ts`（4種目共通）。API は `/api/admin/games/payments`
  （GET=候補一覧 / POST=確定）。**種目別に4本コピーしない**（同じ処理の分散が今回の事故の温床）。
- ⚠️ **必ず `verifySquareOrderPayment()` で入金を照合してから paid にする。**
  ここを外すと管理操作だけで未払いを支払い済みにできてしまう。未入金なら 402 で弾く。
- ⚠️ `squareOrders/{orderId}` に `refundPending` / `expiredRefund` が記録済みの注文は
  **支払い済みにしない**（返金と参加の二重取りになる）。返金タブ側で処理する。
- 当日名簿（`{game}DayState.participants`）の `paid` にも反映する（complete と同じ）。
  ここを忘れると「支払い済みなのに進行に入れない」が残る。
- 監査ログ `payment.markedPaid` に実行者・注文ID・決済IDを残す。
- 回帰テスト: `__tests__/unit/lib/gameEntryPayment.test.ts`（未入金は paid にしない／
  返金済み注文は拒否／当日名簿へ反映／冪等）。

### 「参加は同じ月に1回まで」と、その解除（管理者が特定ユーザーだけ免除）
- 制限の実体は各種目の `POST /api/{game}/entries` と月ロック `{game}MonthlyLocks/{seasonId}_{userId}_{YYYY-MM}`。
  ロックが指す**別日の entry が実在するときだけ** 409（`monthlyLimit: true`）＝stale ロックは自己回復する。
- 免除は `authorizedUsers.monthlyEntryExempt`（boolean）。**4種目共通の1フラグ**（`src/lib/monthlyEntryExempt.ts`）。
  管理画面 → ユーザー詳細 → 「ゲーム参加の月1回制限」で ON/OFF（`PATCH /api/admin/users` に
  `{ id, monthlyEntryExempt }`。boolean 以外は無視する）。
- ⚠️ 免除するのは**月1回だけ**。定員・受付締切・参加費・支払い要否は免除しない。
- ⚠️ **免除ユーザーでも月ロックは今までどおり書く。** 書かないと、免除を後から外したときに
  その月が無制限のまま残る。ロックは「最後に参加した日」を指すだけで判定には実在確認が入るため壊れない。
- 判定は必ずサーバー。`GET /api/{game}/entries?mine=1` が返す `monthlyExempt` は
  **UIの出し分け専用**（麻雀は `mahjongJoinCalendar` の `canJoinDate`／他3種目は案内文のみ）。
- 回帰テスト: `__tests__/unit/api/gameEntryMonthlyExempt.test.ts`（同月2日目が通る／定員は免除しない／
  免除を外すと戻る）・`__tests__/unit/lib/monthlyEntryExempt.test.ts`。

### 参加受付の締切 ← 種目で違うので注意
- **麻雀**: 従来どおり **GMが「ゲーム開始」を押した瞬間が締切**（`entryClosedAt`）。
  日程の開始/終了時刻は**設定できるが締切には効かない**（表示・目安）。
- **ダーツ / ビリヤード / ポーカー**: **開催日の開始時刻(JST)が締切**（`src/lib/entryDeadline.ts`）。
  GMを参加者の中から選ぶため、「締切しないとGMを決められない／GMがいないと締切できない」循環を避ける。
  - 締切までに**参加表明した人（未払い含む）＝その日の参加者**。締切後は新規の参加表明のみ不可。
  - **未払いの人は名簿に出るが進行には参加しない**（申告・順位計算の母数から外れる＝`{game}DayMember.paid`。
    旧データは `paid !== false` で支払い済み扱い）。当日その場で支払えば `paid=true` になり参加できる
    （支払い完了APIが当日名簿にも反映する）。**GM/ディーラーは支払い済みの人から選ぶ**。
    開始可否の人数判定も支払い済みで数える。
  - 来ない人・払わない人は**GMが参加剥奪**できる（`DELETE /api/{darts,billiards}/day/participant`）。
    **ポーカーは参加剥奪を作らない**（ディーラー主導のため）。来ない人の分は**ディーラーが代理入力**して確定する
    （`PokerGameTab` の未申告者入力欄）。未払いの人はそもそもプレイヤー一覧に出ないので確定を妨げない。
    ただし**確定済みが出た後は不可**（ダーツの順位ptは参加者全体の相対順位で毎回再計算されるため、
    後から人数を変えると確定済み種目の他の人のptまで動く）。ビリヤードは記録済みの試合がある人は不可。
  - **未払いの人も締切後に支払える**（当日その場で支払う運用）。本日終了後は不可。
  - **締切後は参加表明も取消もできない**（「締切までに表明した人＝参加者」なので抜けられると名簿が崩れる）。
    来られなくなった人は当日GMが参加者から外す。
  - 「ゲーム開始」は受付締切ではなく**進行開始**。開始時刻を過ぎるまで押せない。
  - 開始時刻は日程doc `{game}Schedule.startTime`。既定値はシーズン編集の「開催の既定時刻」
    （`Season.defaultStartTime/defaultEndTime`）、イレギュラーは日程カレンダーで日付ごとに上書き。
  - ⚠️ 本番は TZ=UTC。締切判定は `+09:00` を明示して組み立てる（`isPastEntryDeadline`）。
    テスト `__tests__/unit/lib/entryDeadline.test.ts` で境界値を固定。
  - ※ 流会時の返金対象は従来どおり `deriveStatus === "paid"` で絞る（参加者の定義とは別）。

### 過去の開催日の対戦結果を遡る（参加タブのカレンダー・4種目共通）
参加タブのカレンダーで**過去の開催日を選ぶと、その日の順位（当日成績）が出る**。
サーバー（`GET /api/{game}/standings/day`）も表示側も以前から対応していたが、
`MonthCalendar` が**当月より前へ戻れなかった**ため当月内の過去日しか辿れなかった（2026-08-10 修正）。
- 遡れる下限は `MonthCalendar` の `minMonth`（"YYYY-MM"）。判定は `src/lib/gameCalendarRange.ts` に集約
  （`calendarMinMonth()` / 案内文の出し分けは `canBrowsePastMonths()`）。**種目ごとにコピーしない。**
- 下限の材料は「クライアントが持っている開催日データの最も古い月」＝ 開催日集合（`{game}Schedule`）＋
  自分の参加日。麻雀だけ**アクティブシーズンの開始日**も渡す（日程未登録＝毎週土曜フォールバックのシーズンでも遡れるように）。
- ⚠️ **下限をこれ以上ゆるめない（「無制限に遡れる」にしない）。** 日程APIも当日成績APIも
  **アクティブシーズン基準**なので、前シーズンまで戻せると「全日グレーで選べない月」か
  「成績はまだありません」の誤表示になる。過去シーズンはリーグタブのシーズン切替で見る。
- `minMonth` 未指定の呼び出し（施設予約・管理の日程カレンダー）は**従来どおり当月止まり**。
- 回帰テスト: `__tests__/unit/lib/gameCalendarRange.test.ts`。

### ゲームマスター（GM）運用 ← 当日フローの中心
- **シーズン固定GM（`Season.gameMasterIds`）を使うのは麻雀だけ。** 管理画面のシーズン編集でも
  GM欄は麻雀を選んだときしか出ない（`GM_DAY_FLOW_GAMES`）。
  - ダーツ / ビリヤード … **開催日ごとに参加者が「GMをやる」で自己選出**（`src/lib/dayGameMaster.ts`）。
    保存先は `{game}DayState.gmUserId` / `gmDisplayName`。進行系APIの認可は `isDayGm()` に一本化。
    **交代可**（担当が帰ると当日フローが詰むため）。UIは `DayGmBanner`（当日タブの先頭）。
    ⚠️ `startDartsDay` / `startBilliardsDay` は当日stateを `tx.set` で**全上書き**するので、
    新stateを組むとき `gmUserId`/`gmDisplayName` を必ず引き継ぐこと（落とすと開始直後にGM不在＝全操作403）。
    回帰テスト: `__tests__/unit/lib/dayGameMasterTx.test.ts`。
  - ポーカー … 試合ごとにディーラーを自己選出（GMの概念なし）。
- 以下は**麻雀の**GM仕様。GM は `Season.gameMasterIds`（管理画面のシーズン編集で複数選択）。**空 = 従来どおりの自動進行**（後方互換）。
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

#### 管理者が対戦結果を手入力する（紙運用・障害時の後入力）
アプリを通さず紙で付けた結果を、管理画面から**1日ぶんまとめて**入れられる。
2026-08-01 はゲストが参加できない不具合（`gamePaymentReturn` 参照）で申告できず紙運用になった。
- 場所: 管理 → シーズン（麻雀）→ **卓一覧タブ → 「＋ 過去の対戦結果を入力」**。
- 入力は現場の順序に合わせる: **① その日の参加者を選ぶ → ② 実施した卓数（半荘数）→ ③ 卓ごとに1〜4位の持ち点**。
  席の候補は①で選んだ人だけに絞る（4人×N卓ぶん毎回全利用者から検索させない）。
  ②はアベレージの母数になるので明示的に入れさせる。空のまま残した卓は送らない。
- API は `POST /api/admin/mahjong/tables`（`{ seasonId, eventDate, tables: [{ members }] }`）。
  **複数卓を1リクエストで受ける**（1卓ずつ投げると途中で失敗して半端に残る）。batch で一括コミットし、
  形が不正な卓があれば「2卓目: …」と何卓目かを示して 400＝**1件も保存しない**。
  `round` は既存卓の最大値の続きから振る（第n半荘の重複表示を避ける）。
- **参加者はアプリ利用者なら誰でも選べる**（参加表明の有無を問わない・ゲスト含む）。
  候補は `GET /api/admin/games/participants`（`authorizedUsers` の active かつ LINE 連携済み）。
  ⚠️ ここで**ゲストを除外しないこと**（ゲスト救済がこの機能の目的）。`/api/members` は使わない。
- 検証は利用者申告と同じ `validateTableReports`（合計100,000点・順位1〜4が1人ずつ）。
  通らない卓は **`reporting`＝集計対象外**で保存（通算順位を汚さない）。UIで合計と過不足を常時表示する。
- 表示名・アイコンは**サーバーが `authorizedUsers`/`users` から解決**する（クライアント値を信用しない）。
- `createdBy` は `admin:<メール>`。監査ログ `table.adminCreated` に残る。
- ⚠️ 麻雀の通算順位は `scores` ではなく **`mahjongTables`** から計算する（`computeStandings`）。
  ダーツ/ビリヤード/ポーカーは `scores` 集計なので、同じ手入力を作るなら別実装になる（未実装）。
- 卓が0件の日でも開催日セレクタと入力フォームを出す（以前は0件だと何も出ず入力できなかった）。
- ⚠️ **着順は入力させず持ち点から決める**（`deriveRanksFromPoints`）。`validateTableReports` の最後に
  「点数が多いのに順位が下はNG」の整合性チェックがあるため、行順＝着順にすると
  点数順に並べ替えて入れない限り落ちる。実際に 2026-08-01 の5卓が全て「申告待ち」になった
  （合計100,000点・順位1〜4は満たしていたのに、点数と着順が逆転していた）。
- 申告待ちの卓には**「確定」ボタン**を出す（`PATCH .../tables/[tableId]` に `{ action: "confirm" }`）。
  持ち点から着順を振り直してから検証するので、着順を付け間違えた卓を救済できる。
  検証に通らない卓は申告待ちのまま理由を返す（通算順位を壊さない）。
- 回帰テスト: `__tests__/unit/api/adminMahjongTableCreate.test.ts` /
  `__tests__/unit/lib/mahjongDeriveRanks.test.ts`（2026-08-01 の実データで再現）。

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

### ポーカーCS（2026-07-28 実装）
- 方式: **卓分け → 勝ち上がり → 決勝卓**（ダーツCSの読み替え。`src/lib/pokerCs.ts` は純関数）。
  3〜4名の卓に分け、各卓の**終了時チップ1位**が勝ち上がる。リーグ上位4名は予選免除シード。
  残り4名以下で決勝卓 → 1位=金/2位=銀/3位=銅。
- 申告は**卓の全員が自分の終了時チップを自己申告** → 全員そろったら自動確定 → 次ラウンド自動生成（GMなし）。
  **CSはディーラーを固定しない**（卓の中で交代しながら回す運用）＝リーグと違い全員がプレイして申告する。
- 同点は「追加ハンド」（`tiebreakChips`）で決着。通常ラウンドは1位の同点のみ、決勝は金銀銅まで解消する。
- API: `GET /api/poker/cs`（締切日到来で遅延生成）・`POST/DELETE /api/poker/cs/entry`・`PATCH /api/poker/cs/report`、
  管理は `GET/POST /api/admin/poker/cs` と `/admin/games/seasons/[seasonId]/poker-cs`。
  コレクションは `pokerCsEvents`。テスト `__tests__/unit/lib/pokerCs.test.ts`（20件）。
- いずれも**リーグ仕様・API（standings/entries/tables/report/cs）は不変。UIのみ差し替え**。タブ/シェルも不変。
- アバターは `/api/avatar` プロキシ経由（WebGLのCanvasタイント回避にcrossOrigin必須）。
- 既知の簡略化: 順位リストのアベレージ推移スパークライン（履歴データ無し→省略）／当日の卓のB卓・見学者（`tables?mine=1`は自分の卓のみ→省略）／席順は卓内並び順から割当。


## トレーラー予約時の決済について

### 施設ごとのSquare設定（2026-07-24・管理画面）
- 管理画面の施設編集は「予約時にSquare決済を必須にする」チェックに一元化: ON → 決済額（必須）＋Squareアクセストークン/ロケーションID/環境（本番・サンドボックス）を設定。OFF保存で `paymentAmount=0`（決済フロー無効）。旧 `hourlyRate`（時間単価）はUI廃止。
- **Square認証情報は超機密**。`facilitySecrets/{facilityId}`（サーバー専用コレクション）に AES-256-GCM で暗号化保存（鍵は環境変数 `FACILITY_SECRETS_KEY`＝32バイト・base64/hex。未設定だと保存不可の明示エラー）。facilities ドキュメント・APIレスポンス・ログには絶対に出さない（管理画面の表示はロケーションID下4桁のみ・空欄=変更しない・削除は明示チェック）。
- 決済リンク生成/照合（`reservations/pending`・`complete`）は `getFacilitySquareCredentials()` の施設別認証情報を優先し、未登録なら従来の環境変数 `SQUARE_*` にフォールバック。
- 公開 `/api/facilities` は calendarId に加え `switchBotDeviceId` も除外して返す。
- Squareの決済URLをボタンで配置（Portal）。
  -　トレーラー選択→日付選択で「決済する」ボタンが表示
  - 指定したSquareの決済URLへ遷移
  - Squareにて決済完了→リダイレクトURLで予約完了画面へ遷移。
- 金額は2万円

### トレーラー / SwitchBot の状況（2026-07-30 実機検証済み）
- 現地の Hub Mini・ロックは**取付・クラウド接続済み**（アプリからの遠隔施解錠OK）。
- ✅ **ブロッカー解消**。`GET /v1.1/devices` が空だった原因は~~リージョン不一致~~ではなく、**トークン発行者がホームの「参加メンバー」でデバイス所有者（ホームオーナー）が別アカウント**だったこと（OpenAPI はオーナーのデバイスしか返さない）。所有者からトークン/シークレットを受領して解決。
  - ⚠️ 現状は**所有者個人アカウントのトークンに依存**している。恒久運用ではホーム所有権を会社管理アカウントへ移譲するのが望ましい。
- **取得済み deviceId**（`node scripts/switchbot-devices.mjs`）:
  - `CED6749F1F5A` … Keypad「キーパッド」← **施設の `switchBotDeviceId` に登録するのはこれ**
  - `C1F07F213D14` … Smart Lock「ロック」（`lockDeviceId` でキーパッドと紐づく。登録しても動くが API 1回分の解決コストがかかる）
  - `EE9A3CCCA686` … Hub Mini「エイトトレーラーハブ」（上2台の hub）
- 切り分けCLI: `node scripts/switchbot-devices.mjs`（`.env.local` の SWITCHBOT_TOKEN/SECRET を使用。
  `keys <id>` で登録パスコード一覧（削除用 id はここでしか取れない）、`createkey <id>` / `deletekey <id> <keyId>` で実機テスト。
  **実機に本物の時限パスコードを書き込む**。permanent には触れない）。

#### ⚠️ 実機で判明した API 実仕様（2026-07-30。以前の実装は**4点すべて**誤っていた。壊さないこと）
ドキュメントだけでは分からず、**実機に通すまで気づけなかった**。`src/lib/switchbot.ts` の冒頭コメントと対で維持する。
**4点すべてが揃わないと解錠できない**（1つでも欠けると「作成は成功するのに開かない」になり、原因が非常に分かりにくい）。
1. **`createKey`/`deleteKey` は Keypad のコマンド。Smart Lock に送ると `160 unknown command`。**
   旧実装はロックへ送っていたため**発行が全て失敗していた**。`resolveKeypad()` が `lockDeviceId` を辿って
   キーパッドへ読み替えるので、施設設定にどちらのIDが入っていても動く。
2. **`startTime`/`endTime` は Unix epoch「秒」（10桁）。** ms を渡すと数万年後の有効期間として登録され、
   **作成は成功するのにパスコードは永久に使えない**（実機で `status` が `normal` のまま＝失効しないことで判別できる。
   正しく秒で入れた場合は期間経過後に `expired` になる）。変換は `toEpochSeconds()`。
3. **`createKey` の応答は空 `{}` で keyId を返さない**（結果は webhook で非同期通知）。
   `deleteKey` に必要な id は `GET /v1.1/devices` の Keypad `keyList` から **`name` で引く**（`name` は端末内で一意が必須）。
   反映に**約5秒**かかるので `KEY_LOOKUP_DELAYS_MS`（累積~13秒）で待つ。短くすると keyId を取り逃がす。
   - 取り逃がした場合も**パスコード自体は有効なので発行は成功扱い**にし、`switchBotKeyId` を書かずに管理者へ通知する
     （＝自動失効できない状態。SwitchBot アプリで手動削除）。予約は確定させる方を優先する。
   - **失効は必ず `deletePasscodeByName(deviceId, 予約ID)` で行う**（`switchBotKeyId` 前提にすると取り逃がし時に
     コードが生き残る）。再発行は「name で削除 → 作成」の順。**同名キーがあると作成せず既存を返す**ので、
     消し漏れると「新コードを保存したのに端末は旧コードのまま」になる。
   - `permanent`（管理者用の常時有効パスコード。現地に id 11/12）は**絶対に削除しない**。
4. **有効期間の前後にグレースが必要**（`PASSCODE_GRACE_MINUTES` = 10分）。**これが「発行できない」の直接原因だった。**
   キーパッドの時計がクラウドより数分遅れているため、`startTime = 予約開始ちょうど` の窓は
   端末視点で「まだ開始前」になり**解錠できない**。作成・クラウド登録・アプリ表示はすべて成功し
   `status` も `normal` なので、実機で試すまで気づけない。
   - 実測: ±24時間の窓→解錠OK / **±5分の窓→解錠OK**（ずれは5分未満）/ 開始=現在・終了=+5,20,60分→**全滅**
   - +9時間シフトした窓は解錠できなかった＝**TZずれではない**（epoch はそのまま解釈される）
   - 受け入れ確認: 「利用中の予約」の窓→解錠OK / 「3時間後の予約」の窓→**解錠されない**
     （窓が実質「常時有効」になっていないことの確認。グレースを触るときは必ずこの陰性テストもやる）
   - ⚠️ グレースは**予約時間外に解錠できる時間そのもの**。安全側に広げすぎないこと。
     利用者に見せる有効期限（`switchBotPasscodeExpiresAt`）は**予約終了そのまま**にし、
     グレースは端末に書く窓だけに適用する（案内・課金との整合を崩さない）。
- 回帰テスト: `__tests__/unit/lib/switchbot.test.ts`（fetch をモックして上記4点を固定）。
- 実機の切り分け手順（また開かなくなったとき用）:
  1. `keys <id>` で登録状況と `status` を見る（`normal` なのに開かないなら窓かグレースを疑う）
  2. permanent が開くか試す → 開けばキーパッド↔ロック連携と入力方法は正常
  3. `createkey <id> 60` のような短窓と、前後に広い窓の両方を試して切り分ける
  4. **テスト後はテストキーを必ず削除する**（未来の窓のコードを残すとその時刻に開いてしまう）
  5. ⚠️ **掃除するときは「permanent 以外を全削除」にしないこと。** キーの `name` は**予約ID**（Firestore の
     自動ID＝20文字前後の英数字）なので、それは**実運用中の予約のパスコード**。消すと利用者が現地で入れない。
     消してよいのは自分が付けたテスト名（`test-` / `accept-` / `margin-` 等）だけ。
     実際に検証中の掃除で利用者の予約のパスコードを消す事故を起こした（2026-07-30）。
- 時限パスコードは**窓を過ぎると `status` が `expired` になり、その後 keyList から消える**。
  「発行から数分で消える」ような独自の期限は無い。一覧から消えていたら、窓が終わったか誰かが消したかのどちらか。

#### 残タスク（実機での単体確認は完了。demo 通しテストと本番設定のみ）
0. ✅ **実機確認済み（2026-07-30）**: 修正後の `src/lib/switchbot.ts` 本体をコンパイルして実機に通し、
   「利用中の予約の窓で解錠OK・未来の予約の窓では解錠されない・keyId 取得OK・ロックIDでもキーパッドに解決・
   permanent 無傷」を確認。テストキーは全削除済み。
1. demo（Vercel `eightbase-demo`）に `SWITCHBOT_TOKEN`/`SWITCHBOT_SECRET` を設定
2. demo 管理画面の施設編集 → SwitchBotデバイスID に **`CED6749F1F5A`（キーパッド）** を登録
3. 「予約→決済→時限パスコード発行→解錠→時間外無効→取消で失効→再発行」を通しテスト
4. demo OK後、本番（Vercel `eightbase`・Production スコープ）に `SWITCHBOT_*` を設定＋本番施設に deviceId 登録。
   **本番は実課金・実機解錠**になる点に注意
- 管理画面の予約日時変更（PATCH）は**解錠コードの有効期間も新しい日時へ貼り替える**（2026-07-30 実装）。
  SwitchBot に「キーの更新」コマンドは無いので削除→作成。**パスコードの数字は使い回す**ので
  利用者へ配り直す必要はない（`switchBotPasscodeExpiresAt` は新しい予約終了に更新される）。
  - 貼り替えに失敗しても**日時変更は巻き戻さない**（予約の移動が主目的）。`switchBotStatus="failed"` ＋
    管理者通知 `switchbot_failed` ＋ 監査 `unlock.failed` を出し、レスポンスに `passcodeWarning` を載せる。
    復旧は管理画面の「再発行」。**黙って捨てないこと**（利用者が入れない状態になる）。
  - 成功時の監査は `unlock.rescheduled`。テスト: `__tests__/unit/api/adminReservationPatch.test.ts`。
- PATCH は**利用者へ日時変更を LINE 通知する**（`sendReservationRescheduled`・2026-07-30 実装）。
  利用者の操作なしに予約が動くので、通知しないと変更に気づけない（解錠できても来る時間が分からない）。
  変更前後の日時を併記し、解錠コードがある場合は「**コードの数字は同じまま**」と明記する。
  ⚠️ パスコードの貼り替えが失敗したときは `hasPasscode: false` で送る（使えないコードを「使える」と案内しない）。
  通知失敗で日時変更は巻き戻さない（他の予約通知と同じ方針）。
- 未連携のままでも予約は確定する（下記「SwitchBot未連携時の暫定運用」）。

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
ポーリングを足すときは必ず先に絞ること。当日系（`api/mahjong/day`・`lib/mahjongDay` 等）は
`seasonId + eventDate` の等値2条件に対応済み。

**通算順位（`/api/{game}/standings`）は scores をシーズン全件スキャンする＝ポーリング禁止。**
順位が動くのは「本日終了」の瞬間だけなので、マウント時と申告後だけ取り直す
（2026-07-28: ダーツ/ビリヤードの15秒ポーリングを撤去、麻雀は `loadCore(silent, withStandings)` で
ポーリング時のみ順位を除外）。

**当日GET（ダーツ/ビリヤード）は開始後 1 read に収める。** 全参加者が12秒間隔でポーリングするため、
開始後は「締切済みは自明＝日程docを読まない」「参加判定は `day.participants` から導く」で
dayState の1 readだけにする。開始前のみ日程doc＋自分のエントリー（決定的ID）を読む。

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

#### 予約↔Google Calendar 同期（SoT = Firestore）
- **真実の源は Firestore（`reservations` + `reservationLocks`）**。Google Calendar は表示・運用用のミラー。
- **空き状況API（`availability`/`week-availability`）は `getBlockingLockedSlots()`（confirmed ＋ 未失効pending の全ロック）＋ **GCal に人が直接入れた予定**（`getCalendarBusySlotsSafe`）の**両方**で塞ぐ。アプリ発の予約は Firestore が正、カレンダー直の予定は GCal が正。
- 予約作成は confirmed ロックを、管理キャンセル(DELETE)はロック削除を行う。**管理の日時変更(PATCH)は transaction で「空き再検証（自分の旧ロックは除外）→ 旧ロック削除＋新ロック作成 → 予約更新」を原子化し、その後 GCal を `updateCalendarEvent()`（無ければ `createCalendarEvent`）で追随**。GCal 更新失敗時は Firestore を旧状態へ巻き戻す（不整合を残さない）。
- GCal 書き込みは作成・更新とも `+09:00`/`Asia/Tokyo`（`googleCalendar.ts`）。

##### GCal に直接入れた予定を「予約済み」として扱う（2026-08-06 の不具合対応）
起きたこと: **Googleカレンダーから入れたトレーラーの予約が、ミニアプリでは空きに見えて予約できてしまった。**
原因は2つあり、両方直さないと塞がらなかった。
1. トレーラーの経路 `POST /api/reservations/pending`（決済つき仮押さえ）が **GCal を一度も見ていなかった**
   （通常の `POST /api/reservations` だけが見ていた）。
2. 旧 `getBookedSlots` が **終日予定（`start.date` のみ）を 00:00〜00:00 の長さゼロ**として扱い、
   終日で入れた予約を素通りさせていた。
- 判定は `src/lib/calendarBusy.ts` に一本化（**種目別・経路別にコピーしない**）。
  `busyIntervalsForDate()` が終日・日跨ぎ・`cancelled`・`transparency: transparent` を正規化する。
  旧 `getBookedSlots` / `checkAvailability` は削除済み。
- 呼ぶ場所: 空き状況API 2本（表示）＋ `POST /api/reservations`・`POST /api/reservations/pending`（確定前ガード）。
- ⚠️ **判定の向きは意図的に非対称**。予約側は GCal が読めなければ **503 `CALENDAR_UNAVAILABLE` で通さない**
  （読めないまま通すのが今回の事故）。表示側は読めなければ Firestore ぶんだけ出す（画面を止めない）。
- ⚠️ `assertCalendarSlotFree()` は **transaction の外**で呼ぶ（ネットワーク待ちを tx に入れない）。
  ⚠️ `calendarId` 未設定の施設は GCal 連携なし＝スキップする（従来どおり Firestore のみ）。
- ⚠️ 週表示は7日ぶんを **GCal 1リクエスト**で取る（日ごとに叩くと7倍のAPIコール）。
- 回帰テスト: `__tests__/unit/lib/calendarBusy.test.ts` /
  `__tests__/unit/api/reservationCalendarConflict.test.ts`（終日予定で 409・決済リンクを作らない）。
- 残っている未対応: **管理画面の予約日時変更(PATCH)は GCal の手動予定を見ない**（自分のミラーを除外する
  必要があるため別対応）。

##### カレンダー予約が「無料・パスコードなし」なのは仕様（欠陥ではない・2026-08-06 確認）
GCal に直接入れられるのは**社員だけ**（カレンダーの共有設定で担保する。一般会員に編集権限を渡さないこと。
渡すと参加費 20,000 円を回さずにトレーラーを押さえられる＝**コードでは塞げない**）。
社員は**常時有効パスコード**（`permanent`・現地 id 11/12）を持っているため、時限パスコードも要らない。
- したがって「カレンダー予約は課金されない／`reservations` に入らない／管理画面の予約一覧やマイ予約に出ない／
  SwitchBot の時限パスコードが出ない」のは**すべて想定どおり**。塞ぐべきは枠の二重取りだけで、それは上で対応済み。
- ⚠️ **GCal→Firestore の取り込み（webhook/syncToken/cron）を作らないこと。** 上記の前提なら不要で、
  実機のパスコード発行・削除まで自動で動かすと事故（時間外に開く／現地で開かない）の面が増えるだけ。
- 前提が変わる（社員以外もカレンダーに書く／現金予約にも時限パスコードを出したい）場合は、双方向同期ではなく
  **管理画面から予約を代理作成する導線**を作る方が安全。現状 `/api/admin/reservations` は GET のみで、
  作成APIは無い（日時変更 PATCH と削除 DELETE のみ）。

#### 直前予約の禁止（「利用日の N 日前までに予約」）
- 施設設定 `Facility.minAdvanceDays`（**0/未設定 = 制限なし**＝当日も予約可。既存施設は無影響）。
  管理画面の施設編集「何日前までに予約が必要か（日）」で設定する。**facilityId のハードコードはしない**。
  例: `7` なら「利用日の1週間前まで」＝ **今日+7 以降しか予約できない**（ちょうど7日後はOK・6日後はNG）。
- 判定は `validateReservationSlot()` に入れてあるので、**空き状況API・予約POST・トレーラー仮押さえの全経路で効く**。
  理由コードは `TOO_SOON`（400）。過去日 `PAST_DATE` とは別に返す（利用者に理由を出し分ける）。
- クライアント（カレンダーの活性判定）とサーバーは **`earliestBookableDate()` を共用**する。
  ここを別実装にすると「押せるのに予約できない日」ができるので分岐を二重に書かないこと。
- 上限は `BOOKING_HORIZON_DAYS`（=30・予約できる先の上限日数）**未満**。同数以上にすると予約できる日が
  1日も無くなるため、管理APIの `validateAdvanceFields` が 400 で弾く（クライアントにも同じチェック）。
  `BOOKING_HORIZON_DAYS` は予約画面のカレンダー上限と共用（マジックナンバーを二重に持たない）。
- ⚠️ 本番は TZ=UTC。日付の加算は **`addDaysJst()`**（UTC 0時基準 + epoch 加算）を使う。
  `new Date(str).setDate()` はローカル(JST)では通って本番だけ1日ズレる。
  境界値テスト: `__tests__/unit/lib/minAdvanceDays.test.ts`。

#### 同伴者必須の予約（サウナ＝1人で入れない施設）
- 施設設定 `Facility.requireCompanions`（既定 false）＋ `minPartySize`（最低合計人数・予約者本人を含む・既定2）。
  管理画面の施設編集「1人での利用を禁止する」で設定する。**facilityId のハードコードはしない**。
  同伴者の上限は `capacity - 1`（`MAX_COMPANIONS=9` で頭打ち）。
- 予約時、日時を選んだ後に「一緒に入る人」を **アプリ利用者（ゲスト以外）から全員選ぶ**。
  数値で人数を入れる欄は作らない（合計 = 1 + 選択数）。合計が `minPartySize` 未満なら予約ボタンは非活性。
- 候補API `GET /api/reservations/companions`（`requireMemberProfileComplete`）。
  `authorizedUsers.active==true` をメモリで role 判定（guest と自分を除外）→ `users` を `getAll` でピンポイント取得。
  **`/api/members` は使わない**（`src/app/api/members/route.ts:72-73` がスキル未登録者を意図的に落とすため候補として不足）。
  クライアントは `members:companions` キーでキャッシュ（TTL5分）し、**予測変換は `kanaIncludes`（`src/lib/kana.ts`）でメモリ絞り込み**。
- **検証は必ずサーバー（`src/lib/companions.ts` の `validateCompanionsForReservation`）**。
  `POST /api/reservations` と `POST /api/reservations/pending` の両方で、GCal / Square を叩く前に呼ぶ。
  エラーは `COMPANION_REQUIRED` / `COMPANION_INVALID` / `COMPANION_SELF` / `COMPANION_TOO_MANY` / `COMPANION_NOT_ALLOWED`（すべて400）。
  ⚠️ **トランザクションの外**で呼ぶこと（`assertSlotFreeInTx` の read と競合させない）。
  ⚠️ 重複IDの除去は**人数を数える前**（同じ人を2回選んで最低人数を突破させない）。
- 保存: `Reservation.companions`（表示名スナップショット）/ `companionIds`（array-contains用）/ `partySize` / `organizerName`。
  **同伴者0件のときは1フィールドも書かない**（既存予約と doc 形状を完全一致させる。`companionReservationFields()` が空オブジェクトを返す）。
  `partySize` は 2階スペース人数制限型要件（`docs/requirements/2階スペース-人数制限型予約-要件定義.md`）と共有する同一フィールド。
- 同伴者のマイ予約: `GET /api/reservations` が `companionIds array-contains` の2本目のクエリを合成する。
  ⚠️ array-contains に `status` を重ねない（複合インデックスが要る）。status はメモリで絞る。
  ⚠️ **同伴者に返すレコードからは解錠コード・決済情報を必ず落とす**（単独解錠を防ぐ）。キャンセルは同伴者不可（`[id]` DELETE の本人確認で既に403）。
- 同伴者の選択は URL ではなく `src/lib/reservationDraft.ts`（sessionStorage）で confirm 画面へ渡す（lineUserId を履歴・ログに残さない）。
  `clearAuthCache()` から `clearReservationDraft()` を呼ぶ経路を外さないこと（共有端末で前ユーザーの選択が残る）。
- 同伴者へのLINE通知は**なし**（2026-07-29 決定）。
- テスト: `__tests__/unit/lib/{kana,companions,companionResolve}.test.ts` / `__tests__/unit/api/myReservationsCompanion.test.ts`。

### 決済（現状すべて無効）
- `/api/payments`・`/api/payments/config` は先頭で `501 PAYMENT_DISABLED` を返す。
- 予約APIは `paymentId` を受け付けず、`requirePayment=true` 施設はオンライン予約不可。
- `src/lib/square.ts` は将来用に残置（未使用）。※トレーラー決済は上記「Square決済URLをボタン配置」の別方式で別途検討。

### LINE 認証フロー（`/` と `/login`）
- 共通処理 `runLiffServerLogin()`（`src/lib/liff.ts`）を両画面で使用。
- 環境判定 `detectEnv()`: `?env` 優先、無ければホスト名（localhost→dev / *.vercel.app→review / その他→prod）。**prodで dev LIFF ID にフォールバックしない**。
- 連携成功時は `clearAuthCache()`＋`profileComplete` で分岐（未完了は `/setup-profile` 直行で往復を防止）。
- 招待は**メールの招待URL（ボタン）方式・全ロール共通**（2026-07-29にOTPから統一）。
  メールのボタン → LINEミニアプリ `/guest` で引き換え → ゲストは氏名確認のみ、会員/社員は `/setup-profile` へ。
  1URL=1回（最初に開いた1名のみ）・既定2日で失効。`usesUrlInvite()` は常に true。
  ⚠️ **発行済みのOTPは引き続き有効**（`/api/auth/invite` が passcode で照合し `usesUrlInvite` を見ないため）。
  `/login` のコード入力画面もそのために残している。
- **OTPに戻す予定はない**（2026-07-29 決定）。管理画面へ平文パスコードを返す経路と
  `sendPasscodeEmail` は削除済み。メール送信に失敗したときは**招待URL（`guestUrl`）を管理者に出して手動共有**する。
  ※ `passcode` 自体は招待URLに埋め込むトークンとして現役（`buildGuestInviteUrl(passcode)`・`passcodeHash` で照合）。
    「平文を人に見せる用途」だけを廃止した、という区別に注意。未連携でも OTP は自動表示せず、`/` は「招待が必要」案内、OTP入力は `/login` の明示導線のみ。
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
- `/api/games/rules` はログイン必須（未ログイン取得不可）。
- 汎用の `/api/games/ranking`・`/api/games/cs` は**廃止**（全種目が専用の `standings`/`cs` API と専用ビューを持つため、呼び出し元がゼロだった）。
- **旧「単発ゲーム（大会・トーナメント）」機能は削除済み**（`/games/[id]`・`/api/games`・`/api/games/[gameId]`・
  `/api/admin/games`（CRUD）・`/api/admin/games/[gameId]/*`・型 `Game`/`GameStatus`）。
  シーズン制の4種目に置き換わっており、アプリ内リンク・LINE通知からの参照はゼロだった。
  ※ `games` コレクション自体は各種目の「本日終了」が軽量docを書くので残る。

### 詳細ページ
- `news`/`events`/`games` は個別GET（`/api/news/[id]` `/api/events/[eventId]` `/api/games/[gameId]`）で取得し、一覧の `limit` に依存しない。

### LINE 公式アカウント配信（role 別文面・宛先）
- 一斉配信の宛先は必ず `getActiveLineUserIdsByRoles(roles)`（`src/lib/firebaseAdmin.ts`）で **登録ユーザーの選択 role のみ**に絞る。**friend 全体への broadcast API は使わない**（未登録フォロワー＝第三者に届く）。
- コンテンツ公開: news/event/game は doc の `lineNotify`（既定ON）＋ `lineBroadcastAudience: UserRole[]`（未設定は種別デフォルト＝news/event: member+staff / game: all）に従い、`broadcastContentPublished(contentType, title, audience)`（`src/lib/line.ts`）が **role 別文面**で送る。ゲストは会員専用ルートに入れないので news/event のゲスト宛リンクは `/info`。管理UIは news/events の編集画面（`LineAudienceField`）。cron 公開（`api/cron/publish`）も同設定を参照。
- **開催日の中止（流会）は参加者へLINEで通知する**（4種目共通・`sendGameForfeitNotice`）。
  宛先は**その開催日の参加者だけ**（lineUserId を個別 push・一斉配信APIは使わない）。
  未払いの人にも送る（当日来ても開催されないため）＝文面だけ返金有無で出し分ける。
  送信はトランザクションの**外**（コミット後）で `Promise.allSettled`＝失敗しても中止処理は巻き戻さない。
  ※ `pushMessage` は `LINE_CHANNEL_ACCESS_TOKEN` 未設定ならスキップする（テスト・未構成環境で誤送信しない）。
- 管理者アプリ「メッセージ送信」（`/admin/messages`・`/api/admin/messages`）: 自由文＋任意リンクを宛先 role 選択で `sendAdminMessage` 配信。送信履歴は `adminMessageLogs`。要件: `docs/requirements/LINE公式アカウント-配信文面-区分-要件定義.md`。

#### ⚠️ 配信通数の上限（2026-07-31 本番で発生）— 「送れない」の第一容疑者
**LINE は宛先1人＝1通で数える。** multicast も同じで、登録者50人へニュース1本＝50通。
無料の「コミュニケーションプラン」は月200通しかないため、数本の一斉配信で枯れる。
上限に達すると LINE が 429 を返し、**ニュース/イベント/管理メッセージが一切届かなくなる**。
- 症状: 管理画面のニュース一覧に「LINE配信失敗」バッジ（`lineNotifyResult.ok === false`）。
  LINE Official Account Manager 側は「配信可能数を超えています」と表示する。
- 復旧はプラン変更か翌月のリセット待ち。**コードでは直せない**。
- 残量は送信画面に常時表示する（`getMessageQuota()` = `/v2/bot/message/quota` + `/quota/consumption`）。
  対象人数 > 残量なら送る前に警告を出す。原因調査より先にここを見ること。

**この障害で判明した設計上の落とし穴（戻さないこと）**
1. **`multicastMessage` の戻り値を捨てない。** 以前 `sendAdminMessage` が `void` で結果を捨てていたため、
   LINE が全件拒否しても API は `success: true`、画面は「N名へ送信しました」と表示していた。
   切り分けが極端に難しくなるので、`ok` を見て 502＋理由を返す。
2. **失敗理由は `describeLineError()` で日本語にして doc/レスポンスに残す。** 429/401/403 は
   「何をすれば直るか」まで書く。生の英文だけだと原因に辿り着けない。
3. **`notifyContentPublishedOnce` は失敗しても `lineNotifiedAt`（通知済みの主張）を維持する。**
   二重送信は防げるが、**上限超過は1通も届いていないのに「送信済み」で固定される**ため、
   増枠しても再送されない。救済は管理画面の「LINE再送」ボタン
   （`POST /api/admin/line-resend` → `notifyContentPublishedOnce(..., { force: true })`）だけ。
   **自動再送は作らない**（意図せず全員へ二重配信する）。
4. **イベントもニュースと同じ `notifyContentPublishedOnce` を通す。** 以前は `broadcastContentPublished`
   を直接呼んでいたため、下書き↔公開を往復するたびに全員へ再配信して通数を浪費し、
   失敗も `lineNotifyResult` に残らず管理画面から見えなかった。
5. `multicastMessage` にも `pushMessage` と同じトークン未設定ガードを入れる（`Bearer undefined` で叩かない）。
- 回帰テスト: `__tests__/unit/lib/lineDelivery.test.ts`（429の扱い・force再送・残量計算を固定）。