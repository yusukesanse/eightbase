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
- リーグ戦: 参加表明 → 管理者が卓組み(自動) → 各自スコア申告(ミニアプリ) → 通算アベレージで順位 → 月次でリーグ確定(M1/M2/M3)。
- スコアは利用者がミニアプリで申告。管理画面は確認・修正のみ。
- CS（チャンピオンシップ）: **誰でも参加可**。リーグ上位はシード権で有利になるだけ（出場制限なし）。
- 日程の種別は**リーグ戦のみ**（CSは麻雀CSタブで個別管理）。
- 配色: M1=マゼンタ #E4007F / M2=シアン #00A0E9 / M3=イエロー(表示用 #F5B400)。ピラミッドは3D(正面・Three.js)。
