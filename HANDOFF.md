# EIGHT BASE UNGA — 引き継ぎドキュメント

シェアオフィス「EIGHT BASE UNGA」向け LINE ミニアプリ（LIFF）＆ 管理ダッシュボード

---

## 重要リンク集

| 用途 | 備考 |
|------|------|
| Vercel ダッシュボード | Vercel にログインして確認 |
| LINE Developers Console | https://developers.line.biz/ |
| Firebase Console | https://console.firebase.google.com/ |
| Google Cloud Console | https://console.cloud.google.com/ |

> **注意**: 本番 URL、LIFF ID、リポジトリ URL 等の具体的な値はセキュリティ上ここには記載しません。Vercel ダッシュボードまたは `.env.local` を確認してください。

---

## アーキテクチャ概要

```
LINE アプリ
    │  LIFF SDK
    ▼
Next.js 14 (App Router, TypeScript)  ← Vercel でホスト
    │
    ├── /api/auth/liff-login    LIFF 認証 + authorizedUsers 照合
    ├── /api/auth/login         メール+パスワード認証 → LINE ID 連携
    ├── /api/auth/profile       プロフィール登録・取得
    ├── /api/auth/check         セッション検証 + プロフィール完了チェック
    ├── /api/reservations       予約 CRUD（Google Calendar + Firestore）
    ├── /api/admin/*            管理者向け API
    └── /api/events|news|quests
         │
         ├── Firebase Firestore   ユーザー・予約データ永続化
         ├── Firebase Storage     画像アップロード
         └── Google Calendar API  施設カレンダー（空き確認・予約作成）
```

### 認証フロー（ハイブリッド認証）

1. ユーザーが LINE ミニアプリからアクセス → LIFF 自動ログイン
2. `authorizedUsers` コレクションで LINE ユーザーID を照合
3. 未連携の場合 → メール＋パスワードで本人確認 → LINE ID 紐づけ
4. 初回ログイン後 → プロフィール情報の入力
5. 2回目以降は LIFF 認証のみで自動ログイン

### セキュリティ実装

- **ハイブリッド認証**: LIFF + メール/パスワード（初回のみ）+ authorizedUsers 照合
- **JWT セッション**: `jose` ライブラリ使用。httpOnly Cookie
- **PBKDF2 パスワードハッシュ**: 100,000 イテレーション（旧パスワードはログイン時に自動マイグレーション）
- **レートリミット**: ログイン試行に対するIPベースの制限
- **CSRF 保護**: 管理画面の変更操作で Origin ヘッダー検証
- **セキュリティヘッダー**: `next.config.mjs` で HSTS / X-Frame-Options / CSP 等を設定

---

## 環境変数

Vercel ダッシュボード → Settings → Environment Variables で確認・変更可能。
ローカル開発では `.env.local.example` をコピーして `.env.local` を作成。

### 必要な環境変数一覧

| カテゴリ | 変数名 | 説明 |
|---------|--------|------|
| LINE | `NEXT_PUBLIC_LIFF_ID` | LIFF アプリ ID |
| LINE | `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API アクセストークン |
| LINE | `LINE_CHANNEL_SECRET` | チャネルシークレット |
| Google | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのメールアドレス |
| Google | `GOOGLE_PRIVATE_KEY` | サービスアカウントの秘密鍵 |
| Google | `CALENDAR_ID_*` | 各施設のカレンダー ID（施設数分） |
| Firebase | `FIREBASE_PROJECT_ID` | Firebase プロジェクト ID |
| Firebase | `FIREBASE_CLIENT_EMAIL` | Admin SDK サービスアカウント |
| Firebase | `FIREBASE_PRIVATE_KEY` | Admin SDK 秘密鍵 |
| Firebase | `FIREBASE_STORAGE_BUCKET` | Storage バケット |
| 認証 | `SESSION_SECRET` | JWT 署名用シークレット（最低32文字） |
| 管理者 | `ADMIN_API_TOKEN` | 管理者認証トークン |
| 管理者 | `ADMIN_ALLOWED_ORIGINS` | CSRF 許可オリジン（カンマ区切り、任意） |

> **重要**: 環境変数の実際の値はこのファイルに記載しないでください。

---

## ローカル開発手順

```bash
# 1. 依存関係インストール
npm install

# 2. 環境変数設定
cp .env.local.example .env.local
# .env.local を編集して各値を入力

# 3. 開発サーバー起動
npm run dev
# → http://localhost:3000
```

> **注意**: LIFF 機能（LINE ログイン）は LINE アプリ内でのみ動作。

---

## Firestore コレクション構造

| コレクション | 説明 |
|------------|------|
| `authorizedUsers` | 認証済みユーザー（メール、パスワードハッシュ、LINE ID、プロフィール） |
| `users` | ユーザー表示情報（LINE 表示名、予約用表示名） |
| `reservations` | 予約情報（施設 ID、日時、ユーザー ID、Google Calendar イベント ID） |
| `events` | イベント情報（タイトル、日時、説明、グッドカウント） |
| `news` | ニュース記事（タイトル、本文、公開日、タイマー設定） |
| `quests` | クエスト情報（タイトル、説明、グッドカウント） |

---

## 管理画面の機能

| ページ | 機能 |
|--------|------|
| ダッシュボード | 統計概要 |
| ユーザー管理 | ユーザー追加・有効/無効・パスワードリセット・検索・フィルター |
| イベント管理 | CRUD + ステータスタブ（公開済み/下書き/タイマー設定） |
| ニュース管理 | CRUD + ステータスタブ + タイマー投稿 |
| クエスト管理 | CRUD + ステータスタブ |
| 予約管理 | 一覧・フィルター・編集 |
| カレンダー管理 | 施設の営業時間・利用可能日設定 |
| 管理者アカウント | 管理者の追加・管理 |

---

## よく使うコマンド

```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npx tsc --noEmit     # TypeScript 型チェック
```
