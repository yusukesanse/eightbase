"use client";

import type { Liff } from "@line/liff";

let liffInstance: Liff | null = null;

/**
 * LINE Mini App の3つの環境（開発用/審査用/本番用）の LIFF ID。
 * 全環境が同じエンドポイントURL (portal.eightbase.net) を共有するため、
 * 実行時に正しい LIFF ID を検出する必要がある。
 */
const LIFF_IDS: string[] = [
  process.env.NEXT_PUBLIC_LIFF_ID || "2009443491-Hay21xuZ", // 開発用
  process.env.NEXT_PUBLIC_LIFF_ID_REVIEW || "2009443492-9ntShQ6k", // 審査用
  process.env.NEXT_PUBLIC_LIFF_ID_PROD || "2009443493-Pz9ZdqJ6", // 本番用
];

/**
 * LIFF SDK を初期化して返す。
 * 複数回呼ばれても 1 回だけ初期化する。
 *
 * LINE Mini App の3環境（開発用/審査用/本番用）が同一エンドポイントURLを
 * 共有するため、各 LIFF ID を順に試して現在のコンテキストに一致するものを使用する。
 */
export async function initLiff(): Promise<Liff> {
  if (liffInstance) return liffInstance;

  const liff = (await import("@line/liff")).default;

  // 重複を除去した LIFF ID リストを作成
  const uniqueIds = LIFF_IDS.filter(Boolean).filter(
    (id, i, arr) => arr.indexOf(id) === i
  );

  let lastError: unknown;
  for (const liffId of uniqueIds) {
    try {
      await liff.init({ liffId });
      liffInstance = liff;
      console.log(`[LIFF] Initialized with LIFF ID: ${liffId}`);
      return liff;
    } catch (e) {
      lastError = e;
      console.warn(`[LIFF] Failed to init with ${liffId}:`, e);
      // init 失敗後に再試行できるよう内部状態をリセット
      // LIFF SDK v2 は init 失敗時に未初期化状態のままなので再試行可能
      continue;
    }
  }

  throw new Error(
    `[LIFF] All LIFF IDs failed to initialize. Last error: ${lastError}`
  );
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
