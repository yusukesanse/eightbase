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
 * LINE ユーザー ID を取得する。
 * LINE アプリ内のみ login() にリダイレクトする。
 * 外部ブラウザからのアクセス時はリダイレクトせずエラーを投げる。
 */
export async function getLineUserId(): Promise<string> {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    if (liff.isInClient()) {
      liff.login({ redirectUri: window.location.href });
      // login() はリダイレクトするため、ここには到達しない
    }
    throw new Error("Not logged in to LINE");
  }

  const profile = await liff.getProfile();
  return profile.userId;
}

export async function getLineProfile() {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    if (liff.isInClient()) {
      liff.login({ redirectUri: window.location.href });
      // login() はリダイレクトするため、ここには到達しない
    }
    throw new Error("Not logged in to LINE");
  }

  return liff.getProfile();
}
