"use client";

import type { Liff } from "@line/liff";

let liffInstance: Liff | null = null;

/**
 * LIFF SDK を初期化して返す。
 * 複数回呼ばれても 1 回だけ初期化する。
 */
export async function initLiff(): Promise<Liff> {
  if (liffInstance) return liffInstance;

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });
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
