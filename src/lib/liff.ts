"use client";

import type { Liff } from "@line/liff";

let liffInstance: Liff | null = null;

/**
 * 環境ごとの LIFF ID マッピング。
 * LINE Developers Console の各内部チャネル（開発用/審査用/本番用）の
 * エンドポイント URL に ?env=dev / ?env=review / ?env=prod を付与し、
 * そのクエリパラメータで正しい LIFF ID を判定する。
 *
 * ⚠️ LIFF SDK はグローバルシングルトンのため、liff.init() は
 *   正しい LIFF ID で「1回だけ」呼ぶ必要がある。
 *   間違った ID で init すると内部状態が壊れ、以降の API 呼び出しが
 *   永久にハングする（ログイン後に読み込み中のまま止まる原因）。
 */
const LIFF_ID_MAP: Record<string, string> = {
  dev: process.env.NEXT_PUBLIC_LIFF_ID || "2009443491-Hay21xuZ",
  review: process.env.NEXT_PUBLIC_LIFF_ID_REVIEW || "2009443492-9ntShQ6k",
  prod: process.env.NEXT_PUBLIC_LIFF_ID_PROD || "2009443493-Pz9ZdqJ6",
};

/** env パラメータがない場合のデフォルト環境 */
const DEFAULT_ENV = "dev";

/**
 * 現在の URL の ?env= クエリパラメータから環境を判定し、
 * 対応する LIFF ID を返す。
 *
 * LINE Developers Console で各チャネルのエンドポイント URL を以下のように設定:
 *   開発用: https://portal.eightbase.net?env=dev
 *   審査用: https://portal.eightbase.net?env=review
 *   本番用: https://portal.eightbase.net?env=prod
 */
function detectLiffId(): string {
  if (typeof window === "undefined") {
    return LIFF_ID_MAP[DEFAULT_ENV];
  }

  const params = new URLSearchParams(window.location.search);
  const env = params.get("env") || DEFAULT_ENV;
  const liffId = LIFF_ID_MAP[env];

  if (!liffId) {
    console.warn(
      `[LIFF] Unknown env "${env}", falling back to "${DEFAULT_ENV}"`
    );
    return LIFF_ID_MAP[DEFAULT_ENV];
  }

  console.log(`[LIFF] Detected env="${env}", using LIFF ID: ${liffId}`);
  return liffId;
}

/**
 * LIFF SDK を初期化して返す。
 * 複数回呼ばれても 1 回だけ初期化する。
 *
 * URL の ?env= パラメータで環境を判定し、対応する LIFF ID で
 * liff.init() を 1 回だけ呼ぶ。
 */
export async function initLiff(): Promise<Liff> {
  if (liffInstance) return liffInstance;

  const liff = (await import("@line/liff")).default;
  const liffId = detectLiffId();

  await liff.init({ liffId });
  liffInstance = liff;
  console.log(`[LIFF] Initialized successfully with LIFF ID: ${liffId}`);
  return liff;
}

/**
 * LINE ユーザー ID を取得する（ログイン必須）。
 * 未ログインの場合、LINE ログインへリダイレクトする。
 */
export async function getLineUserId(): Promise<string> {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    // LINE アプリ内・外部ブラウザ両方で LINE ログインへリダイレクト
    liff.login({ redirectUri: window.location.href });
    // login() はリダイレクトするため、ここには到達しない
    throw new Error("Redirecting to LINE login");
  }

  const profile = await liff.getProfile();
  return profile.userId;
}

/**
 * ログイン済みなら LINE ユーザー ID を返す。
 * 未ログインの場合はリダイレクトせず null を返す。
 * ページ初期読み込み時に使い、閲覧はログインなしでも可能にする。
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
 * グッドボタン押下時など、明示的にログインが必要な場面で呼ぶ。
 */
export async function loginWithLine(): Promise<void> {
  const liff = await initLiff();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
  }
}

/**
 * LINE プロフィールを取得する（ログイン必須）。
 * 未ログインの場合、LINE ログインへリダイレクトする。
 */
export async function getLineProfile() {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    throw new Error("Redirecting to LINE login");
  }

  return liff.getProfile();
}
