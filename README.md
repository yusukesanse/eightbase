# EIGHT BASE UNGA — Web App

シェアオフィス「EIGHT BASE UNGA」向け LINE ミニアプリ（LIFF）＆ 管理ダッシュボード

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | Next.js 14 + TypeScript + Tailwind CSS |
| LINE 連携 | LIFF SDK v2 + LINE Messaging API |
| バックエンド | Next.js API Routes（Vercel） |
| カレンダー | Google Calendar API v3（サービスアカウント認証） |
| DB | Firebase Firestore |
| ストレージ | Firebase Storage |
| 認証 | ハイブリッド認証（LIFF + メール/パスワード） |

## セットアップ手順

### 1. リポジトリクローンと依存関係インストール

```bash
git clone <リポジトリURL>
cd <プロジェクトディレクトリ>
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて各値を設定する。

必要な環境変数:

- **LINE 関連**: LIFF ID、チャネルアクセストークン、チャネルシークレット
- **Firebase 関連**: プロジェクトID、クライアントメール、秘密鍵、ストレージバケット
- **Google Calendar 関連**: サービスアカウント認証情報、カレンダーID
- **セッション**: セッションシークレット（最低32文字のランダム文字列）
- **管理者認証**: 管理者用認証トークン

> **重要**: `.env.local` は `.gitignore` に含まれており、リポジトリにコミットされません。

### 3. 外部サービスの設定

#### LINE Developers

1. [LINE Developers Console](https://developers.line.biz/) でプロバイダーを作成
2. Messaging API チャネルを作成
3. LIFF アプリを作成し、Endpoint URL にデプロイ先URLを設定

#### Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Calendar API を有効化
3. サービスアカウントを作成し JSON キーをダウンロード
4. 施設ごとのカレンダーを作成し、サービスアカウントに予定の変更権限を付与

#### Firebase

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. Firestore Database を作成（本番モードで開始）
3. Firebase Storage を有効化
4. サービスアカウントの秘密鍵を生成

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開く。

> ※ LIFF 機能（LINE ログイン）は LINE アプリ内での動作が必要。

### 5. デプロイ

Vercel にデプロイし、Environment Variables に `.env.local` の全変数を設定する。

## 認証フロー

### 顧客向けアプリ（ハイブリッド認証）

1. ユーザーが LINE ミニアプリからアクセス → LIFF 自動ログイン
2. `authorizedUsers` コレクションで LINE ユーザーID を照合
3. 未連携の場合 → メール＋パスワードで本人確認 → LINE アカウントと紐づけ
4. 初回ログイン後 → プロフィール情報の入力（氏名、電話番号、住所等）
5. 2回目以降は LIFF 認証のみで自動ログイン

### 管理者用アプリ

- httpOnly Cookie + JWT によるセッション管理
- CSRF 保護（Origin / Referer ヘッダー検証）

## ディレクトリ構成

```
src/
├── app/
│   ├── page.tsx                    # ホーム（/reservation へリダイレクト）
│   ├── login/                      # ログイン（LIFF + アカウント連携）
│   ├── setup-profile/              # 初回プロフィール登録
│   ├── reservation/                # 施設予約（日付・時間帯・確認）
│   ├── my-reservations/            # マイ予約一覧
│   ├── events/                     # イベント情報
│   ├── quests/                     # クエスト情報
│   ├── news/                       # ニュース
│   ├── admin/                      # 管理ダッシュボード
│   │   ├── users/                  # ユーザー管理
│   │   ├── events/                 # イベント管理
│   │   ├── news/                   # ニュース管理
│   │   ├── quests/                 # クエスト管理
│   │   ├── reservations/           # 予約管理
│   │   ├── calendars/              # カレンダー・施設管理
│   │   └── admin-users/            # 管理者アカウント管理
│   └── api/                        # API Routes
│       ├── auth/                   # 認証（LIFF, ログイン, プロフィール）
│       ├── reservations/           # 予約 CRUD
│       ├── events/                 # イベント
│       ├── news/                   # ニュース
│       ├── quests/                 # クエスト
│       └── admin/                  # 管理者用 API
├── components/
│   ├── AuthGuard.tsx               # 認証ガード
│   ├── RichMenu.tsx                # 下部ナビゲーション
│   └── ui/                         # UIコンポーネント
│       ├── TimePicker.tsx          # カスタムタイムピッカー
│       ├── DatePicker.tsx          # カスタムデイトピッカー
│       ├── DateTimePicker.tsx      # 日時ピッカー
│       ├── TopBar.tsx              # ヘッダー
│       └── RichText.tsx            # リッチテキスト
├── lib/
│   ├── liff.ts                     # LIFF SDK ラッパー
│   ├── session.ts                  # JWT セッション管理
│   ├── adminAuth.ts                # 管理者認証
│   ├── firebaseAdmin.ts            # Firebase Admin SDK
│   ├── googleCalendar.ts           # Google Calendar API
│   ├── line.ts                     # LINE Messaging API
│   ├── facilities.ts               # 施設マスタ
│   └── rateLimit.ts                # レートリミット
└── types/index.ts                  # TypeScript 型定義
```

## カラースキーム

| 用途 | カラー |
|------|--------|
| プライマリー | `#A5C1C8` |
| セカンダリー | `#414141` |
| アクセント | `#B0E401` |
| ベース | `#FFFFFF` |

## ライセンス

Private — All rights reserved.
