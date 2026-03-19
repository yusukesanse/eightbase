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
 * ログインしていない場合は login() にリダイレクトする。
 */
export async function getLineUserId(): Promise<string> {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    // login() はリダイレクトするため、ここには到達しない
    throw new Error("Redirecting to LINE login...");
  }

  const profile = await liff.getProfile();
  return profile.userId;
}

export async function getLineProfile() {
  const liff = await initLiff();

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    throw new Error("Redirecting to LINE login...");
  }

  return liff.getProfile();
}
