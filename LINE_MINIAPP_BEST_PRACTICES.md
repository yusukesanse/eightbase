# LINE ミニアプリ 本番デプロイ ベストプラクティス

Next.js + LIFF (LINE Front-end Framework) 構成での本番運用に向けた設計・実装・運用のガイドライン。

---

## 1. LIFF の設定

### エンドポイント URL は本番ドメインに固定する

LIFF アプリは「エンドポイント URL」に対して LINE ログインのコールバックが返ってくる。本番・開発で LIFF アプリを分けることを強く推奨。

| 環境 | LIFF アプリ | Endpoint URL |
|------|------------|-------------|
| 本番 | `liff.xxxx` (本番用) | `https://your-app.vercel.app` |
| 開発 | `liff.yyyy` (開発用) | `http://localhost:3000` |

環境変数 `NEXT_PUBLIC_LIFF_ID` を環境ごとに切り替える。

```bash
# .env.local（ローカル開発）
NEXT_PUBLIC_LIFF_ID=1234567890-XXXXXXXX   # 開発用 LIFF ID

# Vercel Environment Variables（本番）
NEXT_PUBLIC_LIFF_ID=1234567890-YYYYYYYY   # 本番用 LIFF ID
```

### LIFF サイズは `Full` を選択

LINE ミニアプリとして全画面で動作させる場合、LIFF サイズは `Full` に設定する。`Tall` や `Compact` では上部に LINE のヘッダーが表示され、ミニアプリらしい体験にならない。

### Scope の最小化

LIFF アプリの Scope（権限）は必要最低限に絞る。

```
✅ profile    # ユーザー名・アイコン取得に必要
✅ openid     # ユーザー ID 取得に必要
❌ email      # 不要なら外す（メールアドレスは LINE ユーザーが設定していない場合もある）
❌ chat_message.write  # メッセージ送信が不要なら外す
```

---

## 2. 認証・セキュリティ

### LINE ユーザー ID をそのままヘッダーで渡さない

```typescript
// ❌ 悪い例: クライアントが任意の userId を偽装できる
headers: { 'x-line-user-id': userId }

// ✅ 良い例: サーバーで LIFF ID トークンを検証して JWT セッション発行
// 1. クライアント: LIFF の idToken を送信
// 2. サーバー: LINE API で idToken を検証 → userId を取得
// 3. サーバー: httpOnly Cookie に JWT を発行
```

### JWT は httpOnly Cookie に保存する

`localStorage` や `sessionStorage` はXSS 攻撃で盗まれる。`httpOnly` Cookie は JavaScript からアクセスできないため安全。

```typescript
// next.config.mjs でのセキュリティヘッダー設定
headers: [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
```

### LIFF ID トークンの検証

LINE API を使って idToken の正当性を必ずサーバー側で検証する。

```typescript
// サーバー側での検証例（src/lib/line.ts）
const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    id_token: idToken,
    client_id: process.env.NEXT_PUBLIC_LIFF_ID!,
  }),
});
```

### レートリミットの実装

ブルートフォース攻撃や API 乱用を防ぐためにレートリミットを設ける。

```typescript
// 本プロジェクトの実装: インメモリ（単一インスタンス向け）
// 本格運用: Vercel KV (Upstash Redis) で複数インスタンス対応に拡張
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const ip = getClientIp(request);
if (!checkRateLimit(ip, 10, 5 * 60 * 1000)) {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

---

## 3. 本番環境の構成

### 環境変数の管理

```bash
# ❌ 絶対にやらないこと
git add .env.local    # 環境変数を Git にコミット

# ✅ 正しい管理
.env.local.example    # キー名だけ記載したサンプルを Git 管理
.env.local            # 実際の値は .gitignore で除外
# 本番値は Vercel / CI の環境変数として設定
```

Vercel での設定: Dashboard → Settings → Environment Variables

### Google Calendar サービスアカウントの秘密鍵

Vercel の環境変数に秘密鍵を貼るとき、改行 `\n` の扱いに注意。

```bash
# Vercel CLI での設定（改行を正しく処理する）
vercel env add GOOGLE_PRIVATE_KEY

# または環境変数の値を以下の形式に変換して貼り付け
"-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

アプリ側では以下のように改行を復元:

```typescript
const privateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
```

### Firebase Admin SDK の初期化

```typescript
// 二重初期化を防ぐ（Next.js はホットリロードで複数回実行される）
import { getApps, initializeApp, cert } from 'firebase-admin/app';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
```

---

## 4. Next.js / Vercel 固有の注意点

### Vercel のサーバーレス関数の制限

- **実行時間制限**: Hobby プランは 10 秒、Pro プランは 60 秒（`maxDuration` で設定可）
- **コールドスタート**: インスタンスが再起動するとインメモリキャッシュ（レートリミット等）はリセットされる
- **ステートレス**: 複数インスタンスで状態を共有するには外部ストア（Vercel KV 等）が必要

```typescript
// route.ts でタイムアウト設定
export const maxDuration = 30; // Pro プランのみ 30 秒以上設定可
```

### Edge Runtime vs Node.js Runtime

LIFF の idToken 検証・Firebase Admin SDK・Google Calendar API は Node.js の機能を使うため、`edge` ランタイムでは動作しない。

```typescript
// API Routes は明示的に Node.js ランタイムを使う
export const runtime = 'nodejs'; // デフォルト。明示的に記述しても可
```

### `next/headers` を使う際の注意

App Router で Cookie を読む場合は `next/headers` を使うが、これはサーバーコンポーネント / Route Handler 内でのみ動作する。

```typescript
import { cookies } from 'next/headers';
const token = cookies().get('__session')?.value;
```

---

## 5. LINE ミニアプリの UX ガイドライン

### LIFF の初期化を非同期で適切に扱う

```typescript
// ❌ 初期化を待たずに liff.getProfile() を呼ぶ
const profile = await liff.getProfile(); // エラーになる

// ✅ 初期化完了後に呼ぶ
await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });
if (liff.isLoggedIn()) {
  const profile = await liff.getProfile();
}
```

### LINE 外ブラウザでのフォールバック

LIFF は LINE アプリ外のブラウザ（Safari, Chrome 等）でも動作するが、LINE ログインのリダイレクトが発生する。開発中に混乱しやすいので適切に処理する。

```typescript
if (!liff.isInClient()) {
  // LINE アプリ外でのアクセス
  // → LINE ログインにリダイレクトするか、別のメッセージを表示
  liff.login();
}
```

### `liff.closeWindow()` で LINE アプリに戻る

ミニアプリの処理完了後は `liff.closeWindow()` を呼ぶことで LINE のトーク画面に戻れる。

```typescript
// 予約完了後など
liff.closeWindow();
```

### LINE Messaging API でのフォローアップメッセージ

予約完了などのタイミングで LINE メッセージを送信する場合は、Push Message API を使う（Reply Message はユーザーからのアクション直後のみ有効）。

```typescript
await fetch('https://api.line.me/v2/bot/message/push', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: userId,
    messages: [{ type: 'text', text: '予約を受け付けました。' }],
  }),
});
```

---

## 6. 監視・運用

### Vercel のビルドログ・デプロイログ

https://vercel.com/nakagawa-share-office/nakagawa-share-office-app/deployments

デプロイのたびにビルドログが記録される。エラー発生時はここから確認。

### Vercel のランタイムログ（関数ログ）

https://vercel.com/nakagawa-share-office/nakagawa-share-office-app/logs

リアルタイムで API の実行ログ・エラーを確認できる。`console.error()` で出力した内容もここに表示される。

### Firebase のモニタリング

Firebase Console → Firestore → 使用量タブで読み書き回数を確認。無料枠（Spark プラン）の上限に注意:
- 読み取り: 50,000 回/日
- 書き込み: 20,000 回/日
- 削除: 20,000 回/日

### エラー通知の設定（推奨）

本番では Sentry や Vercel の alerting を設定しておくと、エラー発生時に即座に気づける。

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

---

## 7. 本番リリースチェックリスト

### セキュリティ
- [ ] `JWT_SECRET` が本番用の強固なランダム値（32 文字以上）
- [ ] 管理者パスワードが PBKDF2 ハッシュ化されている
- [ ] `.env.local` が `.gitignore` に含まれている
- [ ] Firebase セキュリティルールが本番用に設定されている
- [ ] LIFF の Endpoint URL が本番ドメイン

### 機能確認
- [ ] LINE アプリ内でミニアプリが開く
- [ ] LINE ログインが正常に動作する
- [ ] 施設の空き確認が表示される
- [ ] 予約の作成・キャンセルができる
- [ ] Google Calendar に予約が反映される
- [ ] 管理者画面にログインできる
- [ ] 予約完了後に LINE メッセージが届く

### パフォーマンス
- [ ] `npm run build` がエラーなく完了する
- [ ] Vercel のデプロイが `READY` になる
- [ ] Core Web Vitals が許容範囲内（Vercel Analytics で確認）

### 運用
- [ ] GitHub リポジトリにコードが push されている
- [ ] Vercel と GitHub が連携している（自動デプロイ設定）
- [ ] チームメンバーが Vercel プロジェクトにアクセスできる
- [ ] Firebase コンソールの権限設定が適切
- [ ] Google Cloud の IAM 権限が適切
