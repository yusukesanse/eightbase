# 引き継ぎドキュメント — EIGHT CANAL BASE Web App

最終更新: 2026-03-25

## 1. プロジェクト概要

EIGHT CANAL BASE（Eight Design 共有オフィス）の LINE ミニアプリおよび管理ダッシュボード。
入居者は LINE 上から施設予約・イベント閲覧・クエスト参加ができ、管理者は Web ダッシュボードからコンテンツを管理する。

## 2. 各種サービスとアカウント情報

| サービス | URL / 場所 | 備考 |
|---------|-----------|------|
| GitHub リポジトリ | https://github.com/yusukesanse/eight-canal-base-webApp | 旧名: eightcanalbase-wireframe-admin |
| Vercel プロジェクト | https://vercel.com/yusukesanses-projects/nakagawa-share-office-app | Hobby プラン |
| 本番 URL | https://nakagawa-share-office-app.vercel.app | 独自ドメイン取得予定 |
| LINE Developers | https://developers.line.biz/ | LIFF ID: `2009443491-Hay21xuZ` |
| Firebase Console | https://console.firebase.google.com/ | Firestore を使用 |
| Google Cloud Console | https://console.cloud.google.com/ | Calendar API（サービスアカウント認証） |

## 3. ブランチ戦略

```
main       ← 本番ブランチ（Vercel Production に自動デプロイ）
develop    ← 開発ブランチ（Vercel Preview に自動デプロイ）
feature/*  ← 機能ブランチ（develop から分岐、develop にマージ）
```

### デプロイフロー

- `main` へのプッシュ/マージ → 自動で Production デプロイ（手動 Promote 不要）
- `develop` へのプッシュ → Preview デプロイ（一時 URL が発行される）
- `feature/*` へのプッシュ → Preview デプロイ

### 開発手順

1. `develop` ブランチから `feature/xxx` を切る
2. 開発が完了したら `feature/xxx` → `develop` にマージ（PR 推奨）
3. Preview URL で動作確認
4. 問題なければ `develop` → `main` にマージして本番リリース

## 4. 環境変数

Vercel の Environment Variables に設定済み。ローカル開発では `.env.local` に設定する（`.env.local.example` をコピーして使用）。

### LINE 関連

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_LIFF_ID` | LIFF アプリ ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API チャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | チャネルシークレット |

### Google Calendar 関連

| 変数名 | 説明 |
|--------|------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | サービスアカウントの秘密鍵 |
| `CALENDAR_ID_MEETINGROOM_A` 〜 `C` | 会議室 A〜C のカレンダー ID |
| `CALENDAR_ID_BOOTH_1` 〜 `3` | ブース 1〜3 のカレンダー ID |

### Firebase 関連

| 変数名 | 説明 |
|--------|------|
| `FIREBASE_PROJECT_ID` | Firebase プロジェクト ID |
| `FIREBASE_CLIENT_EMAIL` | Admin SDK サービスアカウント |
| `FIREBASE_PRIVATE_KEY` | Admin SDK 秘密鍵 |

### 管理画面関連

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `ADMIN_API_TOKEN` | 管理者ログイントークン | ○ |
| `SESSION_SECRET` | JWT 署名用シークレット（未設定時は ADMIN_API_TOKEN を使用） | 推奨 |
| `ADMIN_ALLOWED_ORIGINS` | CSRF 許可オリジン（カンマ区切り、未設定時は本番 URL） | 任意 |

## 5. 技術構成

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | Next.js（App Router） | 14.2.5 |
| 言語 | TypeScript | - |
| スタイリング | Tailwind CSS | - |
| LINE 連携 | LIFF SDK v2 | - |
| DB | Firebase Firestore | Admin SDK |
| カレンダー | Google Calendar API v3 | サービスアカウント認証 |
| 認証（管理画面） | jose（JWT） | httpOnly Cookie |
| ホスティング | Vercel | Hobby プラン |

## 6. ディレクトリ構成（主要部分）

```
src/
├── app/
│   ├── page.tsx                     # ホーム（/reservation へリダイレクト）
│   ├── reservation/                 # 施設予約（日付選択→時間帯→確認）
│   ├── my-reservations/             # マイ予約一覧
│   ├── events/page.tsx              # イベント一覧（匿名グッドボタン付き）
│   ├── quests/page.tsx              # クエスト一覧（匿名グッドボタン付き）
│   ├── news/                        # ニュース
│   ├── admin/                       # 管理ダッシュボード
│   │   ├── login/page.tsx           # ログイン
│   │   ├── layout.tsx               # 共通レイアウト（認証チェック）
│   │   ├── page.tsx                 # 統計ダッシュボード
│   │   ├── users/page.tsx           # ユーザー管理（ソート・検索・フィルター）
│   │   ├── events/page.tsx          # イベント管理
│   │   ├── news/page.tsx            # ニュース管理
│   │   ├── quests/page.tsx          # クエスト管理
│   │   └── reservations/page.tsx    # 予約管理
│   └── api/
│       ├── admin/
│       │   ├── auth/route.ts        # 管理者認証 API（POST=ログイン, DELETE=ログアウト, GET=セッション確認）
│       │   ├── events/route.ts      # イベント CRUD（入力検証・フィールドホワイトリスト付き）
│       │   ├── news/route.ts        # ニュース CRUD
│       │   ├── quests/route.ts      # クエスト CRUD
│       │   ├── users/route.ts       # ユーザー管理
│       │   ├── reservations/route.ts # 予約管理
│       │   ├── stats/route.ts       # 統計
│       │   └── upload/route.ts      # 画像アップロード
│       ├── events/[eventId]/good/   # イベントグッドボタン（匿名、認証不要）
│       ├── quests/[questId]/good/   # クエストグッドボタン（匿名、認証不要）
│       ├── events/route.ts          # イベント一覧（公開 API）
│       ├── quests/route.ts          # クエスト一覧（公開 API）
│       └── reservations/            # 予約 API
├── lib/
│   ├── adminAuth.ts                 # 管理者認証（CSRF・JWT・バリデーション・ホワイトリスト）
│   ├── firebaseAdmin.ts             # Firebase Admin SDK 初期化
│   ├── googleCalendar.ts            # Google Calendar API
│   ├── liff.ts                      # LIFF SDK ラッパー
│   ├── line.ts                      # LINE Messaging API
│   └── facilities.ts                # 施設マスタデータ
└── types/index.ts                   # TypeScript 型定義
```

## 7. 管理画面のセキュリティ（2026-03-25 実装）

`src/lib/adminAuth.ts` に以下の保護を集約：

1. **CSRF 保護** — POST/PUT/DELETE リクエストで Origin ヘッダーを `ADMIN_ALLOWED_ORIGINS` と照合。不一致なら即拒否。
2. **httpOnly Cookie 認証** — ログイン成功時に JWT を httpOnly / Secure / SameSite=lax の Cookie に格納。XSS でトークンを窃取されるリスクを排除。
3. **フィールドホワイトリスト** — PUT API で更新可能なフィールドを明示的に制限。意図しないフィールド書き換えを防止。
4. **入力バリデーション** — 文字数制限（title: 200字、description: 5000字 等）、URL 形式検証、数値範囲チェック。

## 8. グッドボタンの仕組み

イベント・クエストの「グッド（いいね）」ボタンは匿名方式：

- サーバー側: Firestore ドキュメントの `goodCount` フィールドを `FieldValue.increment` で原子的に加算/減算
- クライアント側: `localStorage`（キー: `event_goods` / `quest_goods`）で押下状態を管理
- LINE ログイン不要（LINE チャネルが開発中ステータスでも動作する）

## 9. 今後の予定・TODO

- [ ] 独自ドメインの取得と Vercel への設定
- [ ] LINE ミニアプリ申請（審査用/本番用エンドポイント URL の設定）
- [ ] 開発環境（develop ブランチ）用の環境変数の分離
- [ ] SESSION_SECRET の独立設定（現在は ADMIN_API_TOKEN をフォールバック利用）
- [ ] セキュリティレビュー 中〜低優先度の対応（レートリミット等）

## 10. よく使うコマンド

```bash
# 開発サーバー起動
npm run dev

# TypeScript 型チェック
npx tsc --noEmit

# プロダクションビルド
npm run build

# Git Graph の起動（Cursor / VS Code）
# Cmd + Shift + P → "Git Graph: View Git Graph"
```
