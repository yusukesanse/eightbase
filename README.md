# NUF LINE ミニアプリ

Eight Design 共有オフィス向け LINE ミニアプリ（LIFF）

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | Next.js 14 + TypeScript + Tailwind CSS |
| LINE 連携 | LIFF SDK v2 + LINE Messaging API |
| バックエンド | Next.js API Routes（Vercel） |
| カレンダー | Google Calendar API v3（サービスアカウント認証） |
| DB | Firebase Firestore |

## セットアップ手順

### 1. リポジトリクローンと依存関係インストール

```bash
git clone https://github.com/your-org/nuf-line-miniapp.git
cd nuf-line-miniapp
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて各値を設定する。  
→ 詳細は技術仕様書 **第5章「環境変数・設定」** を参照。

### 3. LINE Developers の設定

1. [LINE Developers Console](https://developers.line.biz/) でプロバイダーを作成
2. Messaging API チャネルを作成し `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` を取得
3. LIFF アプリを作成し `NEXT_PUBLIC_LIFF_ID` を取得
4. LIFF の Endpoint URL に `https://your-vercel-domain.vercel.app` を設定

### 4. Google Calendar の設定

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクトを作成
2. Google Calendar API を有効化
3. IAM > サービスアカウントを作成し JSON キーをダウンロード
4. Google Workspace で施設ごとのカレンダーを作成（各6つ）
5. 各カレンダーの「設定と共有」でサービスアカウントに **予定の変更権限** を付与

### 5. Firebase の設定

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. Firestore Database を作成（本番モードで開始）
3. プロジェクト設定 > サービスアカウント > Admin SDK で秘密鍵を生成

#### Firestore セキュリティルール

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーは自分のドキュメントのみ読み書き可
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // 予約は本人のみ読み書き可（API Route 経由で操作するため実質 Admin SDK のみ）
    match /reservations/{id} {
      allow read: if false;
      allow write: if false;
    }
    // イベント・ニュース・クエストは全員読み取り可
    match /events/{id} {
      allow read: if true;
      allow write: if false;
    }
    match /news/{id} {
      allow read: if true;
      allow write: if false;
    }
    match /quests/{id} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

### 6. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開く。  
※ LIFF 機能（LINE ログイン）は LINE アプリ内での動作が必要。

### 7. Vercel へのデプロイ

```bash
# Vercel CLI を使う場合
npx vercel --prod
```

Vercel の Environment Variables に `.env.local` の全変数を設定する。

## ディレクトリ構成

```
src/
├── app/
│   ├── page.tsx                    # ホーム（/reservation へリダイレクト）
│   ├── reservation/page.tsx        # 施設・日付選択
│   ├── reservation/timeslot/       # 時間帯選択
│   ├── reservation/confirm/        # 予約確認・完了
│   ├── my-reservations/            # マイ予約一覧
│   ├── events/                     # イベント情報
│   ├── quests/                     # クエスト情報
│   ├── news/                       # ニュース
│   └── api/                        # API Routes
│       ├── reservations/           # GET（一覧）/ POST（作成）
│       ├── reservations/[id]/      # DELETE（キャンセル）
│       ├── reservations/availability/  # GET（空き確認）
│       ├── events/
│       ├── news/
│       └── quests/
├── components/
│   ├── RichMenu.tsx                # 下部ナビゲーション
│   └── ui/TopBar.tsx
├── lib/
│   ├── liff.ts                     # LIFF SDK ラッパー
│   ├── firebaseAdmin.ts            # Firebase Admin SDK
│   ├── googleCalendar.ts           # Google Calendar API
│   ├── line.ts                     # LINE Messaging API
│   └── facilities.ts               # 施設マスタ
└── types/index.ts                  # TypeScript 型定義
```

## 主要 API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/reservations/availability` | 空き確認 |
| GET | `/api/reservations` | マイ予約一覧 |
| POST | `/api/reservations` | 予約登録 |
| DELETE | `/api/reservations/:id` | 予約キャンセル |
| GET | `/api/events` | イベント一覧 |
| GET | `/api/news` | ニュース一覧 |
| GET | `/api/quests` | クエスト一覧・進捗 |

すべての API は `x-line-user-id` ヘッダーによる認証が必要（施設予約・クエスト系）。
