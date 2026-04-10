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

/** env パラメータがない場合のデフォルト環境 */
const DEFAULT_ENV = "dev";

/**
 * 現在の URL の ?env= クエリパラメータから環境を判定し、
 * 対応する LIFF ID を返す。
 */
function detectLiffId(): string {
  if (typeof window === "undefined") {
    const id = LIFF_ID_MAP[DEFAULT_ENV];
    if (!id) throw new Error("[LIFF] NEXT_PUBLIC_LIFF_ID is not set");
    return id;
  }

  const params = new URLSearchParams(window.location.search);
  const env = params.get("env") || DEFAULT_ENV;
  const liffId = LIFF_ID_MAP[env];

  if (!liffId) {
    console.error(`[LIFF] No LIFF ID configured for env="${env}". Check environment variables.`);
    // フォールバック: dev 用を試す
    const fallback = LIFF_ID_MAP[DEFAULT_ENV];
    if (!fallback) throw new Error("[LIFF] No LIFF ID configured. Set NEXT_PUBLIC_LIFF_ID in environment variables.");
    return fallback;
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
