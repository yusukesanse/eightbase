# EIGHT BASE UNGA

シェアオフィス「EIGHT BASE UNGA」の LINE ミニアプリ & 管理ダッシュボード。
入居者は LINE から施設予約・イベント閲覧・クエスト参加ができ、管理者は Web ダッシュボードからすべてを管理します。

## 全体像

```
┌─────────────────┐      ┌──────────────────────────────────┐
│   LINE アプリ    │─LIFF─▶  Next.js 14 (App Router)        │
│  （顧客向け）    │◀────▶│  Vercel にホスト                  │
└─────────────────┘      │                                  │
                          │  ├─ 顧客 API (/api/auth, ...)    │
┌─────────────────┐      │  └─ 管理 API (/api/admin/...)    │
│  管理ダッシュボード │──────▶│                                  │
│  （ブラウザ）     │◀─────│                                  │
└─────────────────┘      └────────┬──────────┬──────────────┘
                                   │          │
                          ┌────────▼──┐  ┌───▼────────────┐
                          │ Firestore  │  │ Google Calendar │
                          │ Storage    │  │ API v3          │
                          └───────────┘  └────────────────┘
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フレームワーク | Next.js 14 (App Router) + TypeScript |
| スタイリング | Tailwind CSS |
| LINE 連携 | LIFF SDK v2 + Messaging API |
| DB / ストレージ | Firebase Firestore + Storage |
| カレンダー | Google Calendar API v3 |
| 認証（顧客） | ハイブリッド認証（LIFF + メール/パスワード） |
| 認証（管理者） | JWT (jose) + httpOnly Cookie + CSRF 保護 |
| ホスティング | Vercel |

## クイックスタート

### 1. セットアップ

```bash
git clone <リポジトリURL>
cd eightbase
npm install
```

### 2. 環境変数

```bash
cp .env.local.example .env.local
```

`.env.local` を開き、各サービスの認証情報を設定してください。
必要な変数は `.env.local.example` にカテゴリ別でまとまっています。

> `.env.local` は `.gitignore` 済みです。絶対にコミットしないでください。

### 3. 開発サーバー

```bash
npm run dev
# → http://localhost:3000
```

> LIFF 機能は LINE アプリ内でのみ動作します。ブラウザでは管理画面の開発に利用できます。

### 4. デプロイ

現在は Vercel を使用しており、`main` ブランチへの push で自動デプロイされます。
ホスティング先の環境変数設定に `.env.local` と同じ変数を登録してください。

> Next.js アプリのため、Vercel 以外（Cloudflare Pages、AWS Amplify 等）にも対応可能です。

## 外部サービスの準備

### LINE Developers

1. [LINE Developers Console](https://developers.line.biz/) でプロバイダーを作成
2. Messaging API チャネルを作成
3. LIFF アプリを作成し、Endpoint URL にデプロイ先 URL を設定

### Firebase

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. Firestore Database を作成（本番モードで開始）
3. Firebase Storage を有効化
4. サービスアカウントの秘密鍵を生成

### Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Calendar API を有効化
3. サービスアカウントを作成し JSON キーをダウンロード
4. 施設ごとのカレンダーを作成し、サービスアカウントに予定の変更権限を付与

## ディレクトリ構成

```
src/
├── app/
│   ├── login/               # ログイン（LIFF + アカウント連携）
│   ├── setup-profile/       # 初回プロフィール登録
│   ├── reservation/         # 施設予約（日付→時間帯→確認）
│   ├── my-reservations/     # マイ予約一覧
│   ├── events/              # イベント一覧・詳細
│   ├── quests/              # クエスト一覧・詳細
│   ├── news/                # ニュース一覧・詳細
│   ├── profile/             # プロフィール編集
│   ├── admin/               # 管理ダッシュボード（8ページ）
│   └── api/                 # API Routes
├── components/              # AuthGuard, RichMenu, UI部品
├── lib/                     # 認証, Firebase, Calendar, LINE
└── types/                   # TypeScript 型定義
```

## 認証フロー

```
LINE アプリ起動
    │
    ▼
LIFF 自動ログイン
    │
    ▼
authorizedUsers に LINE ID があるか？
    │
    ├── YES → セッション発行 → プロフィール登録済み？
    │                              ├── YES → 施設予約画面へ
    │                              └── NO  → プロフィール登録画面へ
    │
    └── NO → メール+パスワードで本人確認
                  │
                  ▼
            LINE ID を紐づけ → プロフィール登録画面へ
```

2回目以降は LIFF 認証のみで自動ログインします。

## 管理画面の機能

| ページ | 機能 |
|--------|------|
| ダッシュボード | 統計概要・予約推移グラフ |
| ユーザー管理 | 追加・有効/無効・パスワードリセット・CSV出力・顧客詳細 |
| イベント管理 | CRUD + ステータス管理 + 画像アップロード |
| ニュース管理 | CRUD + タイマー投稿 |
| クエスト管理 | CRUD + ステータス管理 |
| 予約管理 | 一覧・フィルター・編集 |
| カレンダー管理 | 施設の営業時間・利用可能日設定 |
| 管理者アカウント | 管理者の追加・管理 |

## カラースキーム

| 用途 | カラー | プレビュー |
|------|--------|-----------|
| プライマリー | `#A5C1C8` | ![#A5C1C8](https://via.placeholder.com/12/A5C1C8/A5C1C8.png) |
| テキスト | `#231714` | ![#231714](https://via.placeholder.com/12/231714/231714.png) |
| アクセント | `#B0E401` | ![#B0E401](https://via.placeholder.com/12/B0E401/B0E401.png) |
| ベース | `#FFFFFF` | ![#FFFFFF](https://via.placeholder.com/12/FFFFFF/FFFFFF.png) |

## コマンド一覧

```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npx tsc --noEmit     # TypeScript 型チェック
```

## セキュリティに関する注意

- 環境変数の実値、本番 URL、LIFF ID、トークン等をソースコードやドキュメントに記載しないでください
- `.env.local` は `.gitignore` に含まれています
- 新しい環境変数を追加した場合は `.env.local.example` にプレースホルダーを追加してください

## ライセンス

Private — All rights reserved.
