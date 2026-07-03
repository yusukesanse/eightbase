"use client";

import type { Liff } from "@line/liff";
import { isDevLoginEnabled } from "@/lib/env";
import { buildDevToken, getStoredDevIdentity } from "@/lib/devLogin";

let liffInstance: Liff | null = null;

/**
 * 本番の LIFF ID を返す。**LIFF は本番のみ使用**（開発環境は Dev ログインで LINE 非連携）。
 * `NEXT_PUBLIC_LIFF_ID_PROD`（無ければ `NEXT_PUBLIC_LIFF_ID`）から読む。
 */
function detectLiffId(): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_PROD || process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    throw new Error("[LIFF] NEXT_PUBLIC_LIFF_ID_PROD が未設定です。");
  }
  return liffId;
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
  | { kind: "needs-dev-login" } // Dev ログイン有効だがテストユーザー未選択（/dev-login へ）
  | { kind: "linked"; profileComplete: boolean } // サーバーセッション発行済み
  | { kind: "needs-linking"; lineUserId: string; displayName: string; pictureUrl: string }
  | { kind: "no-access"; error?: string };

/** アクセストークン＋クライアントプロフィールで /api/auth/liff-login を叩き結果を返す。 */
async function postLiffLogin(
  accessToken: string,
  liffProfile: { userId?: string; displayName?: string; pictureUrl?: string }
): Promise<LiffLoginResult> {
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
 * 認証用アクセストークンを取得する。
 * - Dev ログイン（非本番）: 選択済みテストユーザーの Devトークン（未選択は null）。
 * - 通常: LIFF のアクセストークン。
 */
export async function getAuthAccessToken(): Promise<string | null> {
  if (isDevLoginEnabled()) {
    const id = getStoredDevIdentity();
    return id ? buildDevToken(id) : null;
  }
  const liff = await initLiff();
  return liff.getAccessToken();
}

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
  // Dev ログイン（非本番）: LIFF を通さず、選択済みテストユーザーの Devトークンでセッション発行。
  if (isDevLoginEnabled()) {
    const identity = getStoredDevIdentity();
    if (!identity) return { kind: "needs-dev-login" };
    return postLiffLogin(buildDevToken(identity), {
      userId: identity.userId,
      displayName: identity.displayName,
      pictureUrl: identity.pictureUrl ?? "",
    });
  }

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

  return postLiffLogin(accessToken, liffProfile);
}

/**
 * 外部URL（相手の LINE 友だち追加URL など）を開く。
 * LIFF 環境では liff.openWindow({ external:true }) で LINE アプリ側に遷移させ、
 * それ以外（外部ブラウザ）では通常の window.open でフォールバックする。
 */
export async function openExternalUrl(url: string): Promise<void> {
  // 開発環境（LINE非連携）は LIFF を使わず通常のブラウザ遷移。
  if (!isDevLoginEnabled()) {
    try {
      const liff = await initLiff();
      liff.openWindow({ url, external: true });
      return;
    } catch {
      /* LIFF 外はフォールバック */
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * LINE プロフィールを取得する（表示名等）。
 * 開発環境では選択中のテストユーザーを LINE プロフィール相当として返す（LIFF 不使用）。
 */
export async function getLineProfile() {
  if (isDevLoginEnabled()) {
    const id = getStoredDevIdentity();
    return {
      userId: id?.userId ?? "",
      displayName: id?.displayName ?? "",
      pictureUrl: id?.pictureUrl ?? "",
    };
  }
  const liff = await initLiff();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    throw new Error("Redirecting to LINE login");
  }
  return liff.getProfile();
}
