"use client";

import type { Liff } from "@line/liff";

let liffInstance: Liff | null = null;

/**
 * 環境ごとの LIFF ID マッピング。
 * LINE Developers Console の各チャネル（開発用/審査用/本番用）の
 * エンドポイント URL に ?env=dev / ?env=review / ?env=prod を付与し、
 * そのクエリパラメータで正しい LIFF ID を判定する。
 *
 * すべての LIFF ID は環境変数から読み込む。
 * - NEXT_PUBLIC_LIFF_ID         → dev 用
 * - NEXT_PUBLIC_LIFF_ID_REVIEW  → review 用
 * - NEXT_PUBLIC_LIFF_ID_PROD    → prod 用
 */
const LIFF_ID_MAP: Record<string, string | undefined> = {
  dev: process.env.NEXT_PUBLIC_LIFF_ID,
  review: process.env.NEXT_PUBLIC_LIFF_ID_REVIEW,
  prod: process.env.NEXT_PUBLIC_LIFF_ID_PROD,
};

type LiffEnv = "dev" | "review" | "prod";

/** env を判定できない場合のデフォルト（SSR時のみ使用） */
const DEFAULT_ENV: LiffEnv = "dev";

/**
 * 環境を判定する。
 * 1. URL の ?env= が dev/review/prod のいずれかなら最優先（チャネル別エンドポイントの明示指定）。
 * 2. なければホスト名から推定する:
 *      localhost / 127.0.0.1 / *.local → dev
 *      *.vercel.app（プレビュー）       → review
 *      それ以外（本番ドメイン）          → prod
 * これにより ?env を付け忘れた本番URLで dev 用 LIFF ID が使われるのを防ぐ。
 */
function detectEnv(): LiffEnv {
  if (typeof window === "undefined") return DEFAULT_ENV;

  const explicit = new URLSearchParams(window.location.search).get("env");
  if (explicit === "dev" || explicit === "review" || explicit === "prod") {
    return explicit;
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return "dev";
  }
  if (host.endsWith(".vercel.app")) {
    return "review";
  }
  return "prod";
}

/**
 * 判定した環境に対応する LIFF ID を返す。
 * prod 環境では dev 用 LIFF ID へフォールバックしない（本番で dev LIFF ID を使わない）。
 */
function detectLiffId(): string {
  const env = detectEnv();
  const liffId = LIFF_ID_MAP[env];
  if (liffId) return liffId;

  // dev/review は未設定時に dev 用へフォールバック可。prod はフォールバックさせない。
  if (env !== "prod") {
    const devId = LIFF_ID_MAP.dev;
    if (devId) {
      console.warn(`[LIFF] env="${env}" の LIFF ID 未設定のため dev 用にフォールバックします。`);
      return devId;
    }
  }
  throw new Error(`[LIFF] No LIFF ID configured for env="${env}". 環境変数を確認してください。`);
}

/**
 * LIFF SDK を初期化して返す。
 * 複数回呼ばれても 1 回だけ初期化する。
 */
export async function initLiff(): Promise<Liff> {
  if (liffInstance) return liffInstance;

  const liff = (await import("@line/liff")).default;
  const liffId = detectLiffId();

  await liff.init({ liffId });
  liffInstance = liff;
  return liff;
}

/**
 * LINE ユーザー ID を取得する（ログイン必須）。
 * 未ログインの場合、LINE ログインへリダイレクトする。
 */
export async function getLineUserId(): Promise<string> {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    throw new Error("Redirecting to LINE login");
  }

  const profile = await liff.getProfile();
  return profile.userId;
}

/**
 * ログイン済みなら LINE ユーザー ID を返す。
 * 未ログインの場合はリダイレクトせず null を返す。
 */
export async function tryGetLineUserId(): Promise<string | null> {
  try {
    const liff = await initLiff();
    if (!liff.isLoggedIn()) return null;
    const profile = await liff.getProfile();
    return profile.userId;
  } catch {
    return null;
  }
}

/**
 * LINE ログインへリダイレクトする。
 */
export async function loginWithLine(): Promise<void> {
  const liff = await initLiff();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
  }
}

/** /api/auth/liff-login のレスポンス形 */
interface LiffLoginApiResponse {
  success?: boolean;
  profileComplete?: boolean;
  needsLinking?: boolean;
  lineUserId?: string;
  displayName?: string;
  pictureUrl?: string;
  error?: string;
}

export type LiffLoginResult =
  | { kind: "redirecting" } // LINE ログインへリダイレクトした
  | { kind: "needs-line-login" } // 外部ブラウザ等でログイン不可
  | { kind: "linked"; profileComplete: boolean } // サーバーセッション発行済み
  | { kind: "needs-linking"; lineUserId: string; displayName: string; pictureUrl: string }
  | { kind: "no-access"; error?: string };

/**
 * LIFF を初期化し、LINE ログイン状態を確認して /api/auth/liff-login で
 * サーバーセッションを発行する共通フロー（`/` と `/login` で共用）。
 *
 * - LINE 未ログイン & LINE アプリ内 → LINE ログインへリダイレクト（"redirecting"）
 * - LINE 未ログイン & 外部ブラウザ → "needs-line-login"
 * - セッション発行成功 → "linked"（profileComplete 付き）
 * - 招待済みだが未連携 → "needs-linking"（OTP 入力へ）
 * - それ以外 → "no-access"
 *
 * セッション切替後の表示キャッシュ破棄（clearAuthCache）と画面遷移は呼び出し側で行う。
 */
export async function runLiffServerLogin(): Promise<LiffLoginResult> {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    if (liff.isInClient()) {
      liff.login({ redirectUri: window.location.href });
      return { kind: "redirecting" };
    }
    return { kind: "needs-line-login" };
  }

  const accessToken = liff.getAccessToken();
  if (!accessToken) {
    return { kind: "no-access", error: "アクセストークンを取得できませんでした" };
  }

  // クライアント側プロフィール（サーバー側 LINE API 失敗時のフォールバック）
  let liffProfile: { userId?: string; displayName?: string; pictureUrl?: string } = {};
  try {
    const p = await liff.getProfile();
    liffProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" };
  } catch (e) {
    console.warn("[liff] getProfile() failed:", e);
  }

  const res = await fetch("/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, liffProfile }),
    credentials: "include",
  });

  const data: LiffLoginApiResponse = await res.json().catch(() => ({}));

  if (res.ok && data.success) {
    return { kind: "linked", profileComplete: !!data.profileComplete };
  }
  if (data.needsLinking) {
    return {
      kind: "needs-linking",
      lineUserId: data.lineUserId ?? "",
      displayName: data.displayName ?? "",
      pictureUrl: data.pictureUrl ?? "",
    };
  }
  return { kind: "no-access", error: data.error };
}

/**
 * 外部URL（相手の LINE 友だち追加URL など）を開く。
 * LIFF 環境では liff.openWindow({ external:true }) で LINE アプリ側に遷移させ、
 * それ以外（外部ブラウザ）では通常の window.open でフォールバックする。
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    const liff = await initLiff();
    liff.openWindow({ url, external: true });
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}

/**
 * LINE プロフィールを取得する（ログイン必須）。
 */
export async function getLineProfile() {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    throw new Error("Redirecting to LINE login");
  }

  return liff.getProfile();
}
