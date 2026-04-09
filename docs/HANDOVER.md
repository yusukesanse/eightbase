# 引き継ぎドキュメント — EIGHT BASE UNGA Web App

最終更新: 2026-04-09

## 1. プロジェクト概要

EIGHT BASE UNGA（シェアオフィス）の LINE ミニアプリおよび管理ダッシュボード。
入居者は LINE 上から施設予約・イベント閲覧・クエスト参加ができ、管理者は Web ダッシュボードからコンテンツを管理する。

## 2. 各種サービス

| サービス | 備考 |
|---------|------|
| GitHub | リポジトリ URL は管理者に確認 |
| Vercel | ホスティング。ダッシュボードにログインして確認 |
| LINE Developers | https://developers.line.biz/ — LIFF ID 等はコンソールで確認 |
| Firebase Console | https://console.firebase.google.com/ — Firestore / Storage |
| Google Cloud Console | https://console.cloud.google.com/ — Calendar API |

> **重要**: 本番 URL、LIFF ID、トークン等の具体的な値はセキュリティ上ここには記載しません。Vercel の環境変数設定または `.env.local` を参照してください。

## 3. ブランチ戦略

```
main       ← 本番ブランチ（Vercel Production に自動デプロイ）
develop    ← 開発ブランチ（Vercel Preview に自動デプロイ）
feature/*  ← 機能ブランチ（develop から分岐、develop にマージ）
```

### デプロイフロー

- `main` へのプッシュ/マージ → 自動で Production デプロイ
- `develop` へのプッシュ → Preview デプロイ（一時 URL が発行される）

## 4. 環境変数

Vercel の Environment Variables に設定済み。ローカル開発では `.env.local.example` をコピーして使用。

### 必要な環境変数カテゴリ

- **LINE 関連**: LIFF ID、チャネルアクセストークン、チャネルシークレット
- **Google Calendar 関連**: サービスアカウント認証情報、各施設のカレンダー ID
- **Firebase 関連**: プロジェクト ID、クライアントメール、秘密鍵、ストレージバケット
- **認証関連**: セッションシークレット（JWT署名用、最低32文字）
- **管理者関連**: 管理者認証トークン、CSRF 許可オリジン（任意）

> 変数の具体的な値はこのファイルに記載しないでください。

## 5. 技術構成

| レイヤー | 技術 |
|---------|------|
| フレームワーク | Next.js 14（App Router） + TypeScript |
| スタイリング | Tailwind CSS |
| LINE 連携 | LIFF SDK v2 |
| DB | Firebase Firestore |
| ストレージ | Firebase Storage |
| カレンダー | Google Calendar API v3（サービスアカウント認証） |
| 認証（顧客） | ハイブリッド認証（LIFF + メール/パスワード + authorizedUsers 照合） |
| 認証（管理者） | jose（JWT） + httpOnly Cookie + CSRF 保護 |
| ホスティング | Vercel |

## 6. ディレクトリ構成（主要部分）

```
src/
├── app/
│   ├── page.tsx                     # ホーム（/reservation へリダイレクト）
│   ├── login/page.tsx               # ログイン（LIFF + アカウント連携）
│   ├── setup-profile/page.tsx       # 初回プロフィール登録
│   ├── reservation/                 # 施設予約（日付選択→時間帯→確認）
│   ├── my-reservations/             # マイ予約一覧
│   ├── events/                      # イベント一覧・詳細
│   ├── quests/                      # クエスト一覧・詳細
│   ├── news/                        # ニュース一覧・詳細
│   ├── admin/                       # 管理ダッシュボード
│   │   ├── login/                   # 管理者ログイン
│   │   ├── layout.tsx               # 共通レイアウト（アイコンサイドバー）
│   │   ├── page.tsx                 # 統計ダッシュボード
│   │   ├── users/                   # ユーザー管理
│   │   ├── events/                  # イベント管理
│   │   ├── news/                    # ニュース管理
│   │   ├── quests/                  # クエスト管理
│   │   ├── reservations/            # 予約管理
│   │   ├── calendars/               # カレンダー・施設管理
│   │   └── admin-users/             # 管理者アカウント管理
│   └── api/
│       ├── auth/                    # 顧客認証 API
│       ├── admin/                   # 管理者 API
│       ├── reservations/            # 予約 API
│       ├── events/                  # イベント API
│       ├── news/                    # ニュース API
│       └── quests/                  # クエスト API
├── components/
│   ├── AuthGuard.tsx                # 認証ガード（JWT + プロフィール完了チェック）
│   ├── ClientLayout.tsx             # クライアントレイアウト
│   ├── RichMenu.tsx                 # 下部ナビゲーション
│   └── ui/                          # UIコンポーネント（TimePicker, DatePicker 等）
├── lib/
│   ├── session.ts                   # JWT セッション管理
│   ├── adminAuth.ts                 # 管理者認証（CSRF・JWT・バリデーション）
│   ├── rateLimit.ts                 # インメモリレートリミッター
│   ├── liff.ts                      # LIFF SDK ラッパー
│   ├── firebaseAdmin.ts             # Firebase Admin SDK 初期化
│   ├── googleCalendar.ts            # Google Calendar API
│   ├── line.ts                      # LINE Messaging API
│   └── facilities.ts                # 施設マスタデータ
└── types/index.ts                   # TypeScript 型定義
```

## 7. 認証フロー

### 顧客向け（ハイブリッド認証）

1. LINE ミニアプリから LIFF 自動ログイン
2. `authorizedUsers` コレクションで lineUserId を照合
3. 未連携 → メール+パスワードで本人確認 → LINE ID 紐づけ
4. 初回 → プロフィール登録（氏名、電話番号、住所等）
5. 2回目以降 → LIFF 認証のみで自動ログイン

### 管理者向け

- トークンベース認証 + JWT セッション
- httpOnly Cookie + CSRF 保護
- フィールドホワイトリスト

## 8. グッドボタンの仕組み

イベント・クエストの「グッド」ボタンは匿名方式：

- サーバー側: Firestore ドキュメントの `goodCount` を原子的に加算/減算
- クライアント側: `localStorage` で押下状態を管理

## 9. 管理画面の機能

- ユーザー管理（追加・有効/無効・パスワードリセット・検索・フィルター・LINE 連携状態）
- イベント/ニュース/クエスト管理（CRUD + ステータスタブ + タイマー投稿）
- 予約管理（一覧・フィルター・編集）
- カレンダー・施設管理（営業時間・利用可能日設定）
- 管理者アカウント管理

## 10. よく使うコマンド

```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npx tsc --noEmit     # TypeScript 型チェック
```
