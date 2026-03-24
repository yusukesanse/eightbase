# NUF LINE ミニアプリ — 引き継ぎドキュメント

Eight Design 共有オフィス予約システム。LINE LIFF（LINE Front-end Framework）上で動作する Next.js アプリ。

---

## 重要リンク集

| 用途 | URL |
|------|-----|
| **Vercel ダッシュボード** | https://vercel.com/nakagawa-share-office/nakagawa-share-office-app |
| **本番 URL** | https://nakagawa-share-office-app.vercel.app |
| **GitHub リポジトリ** | ※ローカルのみ（リモート未設定）→ 引き継ぎ時に GitHub に push すること |
| **LINE Developers Console** | https://developers.line.biz/ |
| **Firebase Console** | https://console.firebase.google.com/ |
| **Google Cloud Console** | https://console.cloud.google.com/ |

---

## アーキテクチャ概要

```
LINE アプリ
    │  LIFF SDK
    ▼
Next.js 14 (App Router, TypeScript)  ← Vercel でホスト
    │
    ├── /api/auth/login       JWT セッション発行（PBKDF2 パスワード検証）
    ├── /api/auth/check       セッション検証
    ├── /api/reservations     予約 CRUD（Google Calendar + Firestore）
    ├── /api/admin/*          管理者向け API
    └── /api/events|news|quests
         │
         ├── Firebase Firestore   ユーザー・予約データ永続化
         └── Google Calendar API  施設カレンダー（空き確認・予約作成）
```

### セキュリティ実装（本番強化済み）

- **JWT セッション**: `jose` ライブラリ使用。httpOnly `__session` Cookie（旧: `x-line-user-id` ヘッダーは削除済み）
- **PBKDF2 パスワードハッシュ**: 100,000 イテレーション（旧パスワードはログイン時に自動マイグレーション）
- **レートリミット**: 10 リクエスト / 5 分 / IP（インメモリ、`src/lib/rateLimit.ts`）
- **セキュリティヘッダー**: `next.config.mjs` で HSTS / X-Frame-Options / CSP 等を設定

---

## 環境変数（Vercel に設定済み）

Vercel ダッシュボード → Settings → Environment Variables で確認・変更可能。

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_LIFF_ID` | LINE LIFF アプリ ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API アクセストークン |
| `LINE_CHANNEL_SECRET` | LINE チャネルシークレット |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google サービスアカウントのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | Google サービスアカウントの秘密鍵（`-----BEGIN...` 形式） |
| `FIREBASE_PROJECT_ID` | Firebase プロジェクト ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK サービスアカウントメール |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK 秘密鍵 |
| `JWT_SECRET` | JWT 署名用シークレット（32 文字以上推奨） |
| `ADMIN_PASSWORD_HASH` | 管理者パスワードの PBKDF2 ハッシュ（下記参照） |

### 管理者パスワードの更新方法

```bash
node -e "
const crypto = require('crypto');
const password = 'NEW_PASSWORD_HERE';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
console.log(salt + ':' + hash);
"
```

出力された文字列を `ADMIN_PASSWORD_HASH` に設定する。

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

# 4. ビルド確認（本番前）
npm run build
```

> **注意**: LIFF 機能（LINE ログイン・プロフィール取得）は LINE アプリ内でのみ動作。
> ブラウザ開発時は LIFF の初期化がスキップされる。

---

## Vercel へのデプロイ

### 通常のデプロイ（推奨: GitHub 連携）

```bash
# 1. GitHub にリポジトリを作成
git remote add origin https://github.com/YOUR_ORG/nakagawa-share-office-app.git
git push -u origin main

# 2. Vercel ダッシュボードで GitHub と連携
# Settings → Git → Connect Git Repository
# → 以降は main への push で自動デプロイ
```

### 手動デプロイ（Vercel CLI）

```bash
npx vercel --prod
```

---

## ディレクトリ構成

```
src/
├── app/
│   ├── page.tsx                         # ホーム（/reservation へリダイレクト）
│   ├── login/page.tsx                   # LINE ログインページ
│   ├── reservation/page.tsx             # 施設・日付選択
│   ├── reservation/timeslot/page.tsx    # 時間帯選択
│   ├── reservation/confirm/page.tsx     # 予約確認・完了
│   ├── my-reservations/page.tsx         # マイ予約一覧
│   ├── events/page.tsx                  # イベント情報
│   ├── quests/page.tsx                  # クエスト情報
│   ├── news/page.tsx                    # ニュース
│   ├── admin/                           # 管理者画面
│   │   ├── layout.tsx                   # 管理者レイアウト（認証ガード）
│   │   ├── login/page.tsx               # 管理者ログイン
│   │   ├── page.tsx                     # ダッシュボード
│   │   ├── reservations/page.tsx        # 予約一覧・管理
│   │   └── users/page.tsx               # ユーザー管理
│   └── api/
│       ├── auth/login/route.ts          # JWT 発行（PBKDF2 認証）
│       ├── auth/check/route.ts          # セッション確認
│       ├── reservations/route.ts        # GET 一覧 / POST 作成
│       ├── reservations/[id]/route.ts   # DELETE キャンセル
│       ├── reservations/availability/   # GET 空き確認
│       ├── admin/reservations/          # 管理者: 予約管理
│       ├── admin/users/                 # 管理者: ユーザー管理
│       ├── admin/stats/                 # 管理者: 統計
│       ├── events/                      # イベント API
│       ├── news/                        # ニュース API
│       └── quests/                      # クエスト API
├── components/
│   ├── AuthGuard.tsx                    # LINE 認証ガード（JWT ベース）
│   ├── ClientLayout.tsx                 # クライアントレイアウト
│   ├── RichMenu.tsx                     # 下部ナビゲーション
│   └── ui/TopBar.tsx                    # トップバー
└── lib/
    ├── session.ts                       # JWT セッション管理（jose）
    ├── rateLimit.ts                     # インメモリレートリミッター
    ├── liff.ts                          # LIFF SDK ラッパー
    ├── firebaseAdmin.ts                 # Firebase Admin SDK 初期化
    ├── googleCalendar.ts                # Google Calendar API
    ├── line.ts                          # LINE Messaging API
    └── facilities.ts                    # 施設マスタデータ
```

---

## 施設マスタの更新

`src/lib/facilities.ts` に施設リストが定義されている。
施設の追加・削除・名称変更はこのファイルを編集する。
また、各施設に対応する Google Calendar の ID も同ファイルで管理。

---

## Firebase Firestore コレクション構造

| コレクション | ドキュメント内容 |
|------------|----------------|
| `users` | LINE ユーザーID、表示名、パスワードハッシュ（管理者） |
| `reservations` | 予約情報（施設 ID、日時、ユーザー ID、Google Calendar イベント ID） |
| `events` | イベント情報（タイトル、日時、説明） |
| `news` | ニュース記事（タイトル、本文、公開日） |
| `quests` | クエスト定義と進捗（ユーザーごとの達成状況） |

---

## トラブルシューティング

### ビルドエラー: TypeScript
```bash
npm run build 2>&1 | head -50
```

### LINE ログインが動かない
- LIFF Endpoint URL が正しい Vercel URL を指しているか確認（LINE Developers Console）
- `NEXT_PUBLIC_LIFF_ID` が正しいか確認

### Google Calendar の予約が作成されない
- サービスアカウントに各カレンダーへの**予定の変更権限**が付与されているか確認
- `GOOGLE_PRIVATE_KEY` の改行が `\n` でエスケープされているか確認（Vercel では `\n` → 実際の改行に変換が必要）

### Firebase 接続エラー
- `FIREBASE_PRIVATE_KEY` の末尾に改行が含まれているか確認
- Firebase Console でサービスアカウントの権限（Firestore 読み書き）を確認

---

## 引き継ぎ TODO

- [ ] GitHub リポジトリ作成 & `git remote add origin` → `git push`
- [ ] Vercel を GitHub 連携に切り替え（自動デプロイ設定）
- [ ] LINE LIFF の Endpoint URL を本番ドメインに確定させる
- [ ] `JWT_SECRET` を強固なランダム値に更新
- [ ] 管理者パスワードを本番用に変更（上記の更新方法参照）
- [ ] Firebase の Firestore セキュリティルールを本番ルールに切り替え
- [ ] Google Calendar のサービスアカウント権限を最小権限に絞る
