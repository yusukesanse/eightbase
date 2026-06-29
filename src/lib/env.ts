/**
 * 環境（local / demo / production）の判定と、環境変数の整合性チェック。
 *
 * 目的: 「demo の Vercel プロジェクトに本番 Firebase の値を貼ってしまった」等の
 * 取り違えを *起動時に throw して止める*（本番データへ到達させない多層防御の中核）。
 *
 * 判定は `NEXT_PUBLIC_APP_ENV` を唯一の真実とする（クライアント側のバナー表示にも使うため
 * NEXT_PUBLIC_*。値は秘匿情報ではない）。未設定時は安全側に倒して "local" 扱い。
 */

export type AppEnv = "production" | "demo" | "local";

/** 現在の APP_ENV を返す（未設定/不正値は "local"） */
export function getAppEnv(): AppEnv {
  const raw = (process.env.NEXT_PUBLIC_APP_ENV ?? "").toLowerCase();
  if (raw === "production" || raw === "demo" || raw === "local") return raw;
  return "local";
}

export function isProduction(): boolean {
  return getAppEnv() === "production";
}

export function isDemo(): boolean {
  return getAppEnv() === "demo";
}

/**
 * ダミーデータ（モックデータ）を各 GET API が返してよい環境か。
 *
 * env フラグ `EIGHTBASE_DUMMY_DATA` が有効、かつ production でないときだけ true。
 * - production では二重に封じる: 万一フラグが本番 env に紛れても runtime で false を返し、
 *   さらに `scripts/check-env.mjs` が本番ビルドでこのフラグを検出するとビルド失敗させる。
 * - プレビューモード（Cookie ベースの認証バイパス / `src/lib/preview.ts`）とは独立。
 *   dev/staging はプレビューに関係なくダミーを表示し、本番は常に実データ。
 */
export function isDummyDataEnabled(): boolean {
  if (isProduction()) return false;
  const raw = (process.env.EIGHTBASE_DUMMY_DATA ?? "").toLowerCase();
  return raw === "on" || raw === "1" || raw === "true" || raw === "yes";
}

/**
 * demo / 開発専用の「認証バイパス」。LINE/LIFF ログインを省略してテストするための抜け穴。
 *
 * env フラグ `NEXT_PUBLIC_DEMO_AUTH_BYPASS` が有効、かつ production でないときだけ true。
 * - production では二重に封じる: isProduction() で常に false ＋ `scripts/check-env.mjs` が
 *   本番ビルドでこのフラグを検出するとビルド失敗させる。
 * - NEXT_PUBLIC_* なのはクライアント（ルートページの LIFF 省略）でも判定するため。値は秘匿情報ではない。
 * - 有効時、サーバーの認可は固定のテストユーザー(DEMO_BYPASS_USER_ID)を返す。
 */
export function isAuthBypassEnabled(): boolean {
  if (isProduction()) return false;
  const raw = (process.env.NEXT_PUBLIC_DEMO_AUTH_BYPASS ?? "").toLowerCase();
  return raw === "on" || raw === "1" || raw === "true" || raw === "yes";
}

/** 認証バイパス時に使う固定テストユーザーID */
export const DEMO_BYPASS_USER_ID = "demo-bypass-user";

/** vercel.app / localhost を含む = 本番ドメインではない、と判定 */
function looksNonProdUrl(url: string): boolean {
  return (
    url.includes("vercel.app") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.startsWith("http://")
  );
}

/**
 * 環境変数の整合性を検証する。問題があれば Error を throw。
 *
 * チェック内容:
 *  1. EXPECTED_FIREBASE_PROJECT_ID を設定していれば、FIREBASE_PROJECT_ID と完全一致を要求。
 *     → 各 Vercel プロジェクトに一度だけ EXPECTED を設定しておけば、後から誤って別環境の
 *        Firebase 認証ブロックを貼っても projectId が食い違って起動失敗する（取り違えの主因を捕捉）。
 *  2. APP_ENV=production のとき:
 *     - FIREBASE_PROJECT_ID が必須。
 *     - NEXT_PUBLIC_PORTAL_URL が本番ドメイン（https の独自ドメイン）であること。
 *       vercel.app / localhost のままなら demo 値の貼り間違いとみなして throw。
 *
 * 冪等・副作用なし。サーバー起動経路（firebaseAdmin 初期化）から呼ぶ。
 */
export function assertEnvConsistency(): void {
  const appEnv = getAppEnv();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const expected = process.env.EXPECTED_FIREBASE_PROJECT_ID ?? "";
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? "";

  // 1. 期待プロジェクトIDとの突合（環境を問わず最優先）
  if (expected && projectId && expected !== projectId) {
    throw new Error(
      `[env] 環境変数の取り違えを検出しました: FIREBASE_PROJECT_ID="${projectId}" は ` +
        `EXPECTED_FIREBASE_PROJECT_ID="${expected}" と一致しません。` +
        `この Vercel プロジェクトの Firebase 設定（PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY）を見直してください。`
    );
  }

  // 2. 本番固有のガード
  if (appEnv === "production") {
    if (!projectId) {
      throw new Error("[env] APP_ENV=production ですが FIREBASE_PROJECT_ID が未設定です。");
    }
    if (!portalUrl || looksNonProdUrl(portalUrl)) {
      throw new Error(
        `[env] APP_ENV=production ですが NEXT_PUBLIC_PORTAL_URL="${portalUrl}" が本番ドメインではありません。` +
          `demo の値が混入していないか確認してください。`
      );
    }
  }
}
