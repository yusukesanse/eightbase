"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import ShibaGame from "@/components/ShibaGame";
import { useLiffBoot } from "@/hooks/useLiffBoot";
import { isDevLoginEnabled } from "@/lib/env";
import { isGamesOnlyRole } from "@/lib/roles";

const LOGGED_OUT_FLAG = "eb_logged_out";

export default function HomePage() {
  const boot = useLiffBoot();
  const [phase, setPhase] = useState<"loading" | "no-account" | "error" | "logged-out">("loading");
  const [statusText, setStatusText] = useState("LIFF初期化中...");

  // `/` と `/login` で共通の LIFF→サーバーセッション発行フロー（useLiffBoot）。
  // ログアウト後の「ログインする」ボタンからも呼べるように useCallback で切り出す。
  const runBoot = useCallback(async () => {
    setPhase("loading");
    setStatusText("認証中...");

    const result = await boot();
    if (!result) {
      // 例外発生（boot 内でログ済み）
      setStatusText("エラーが発生しました。ページを再読み込みしてください。");
      setPhase("error");
      return;
    }

    switch (result.kind) {
      case "redirecting":
        setStatusText("LINEログイン中...");
        return;
      case "linked":
        // boot() 内で表示キャッシュ破棄＋遷移済み
        return;
      case "needs-dev-login":
        // Dev ログイン有効だがテストユーザー未選択 → 選択画面へ
        window.location.replace("/dev-login");
        return;
      case "needs-linking":
      case "needs-line-login":
      case "no-access":
        // 未連携/未招待は OTP を自動表示せず「招待が必要」案内（NO ACCOUNT 画面）を出す。
        // 招待（ワンタイムパスワード）を持つ人は画面内リンクから /login へ進む。
        setPhase("no-account");
        return;
    }
  }, [boot]);

  useEffect(() => {
    // Dev ログイン（非本番）: 実セッションの有無で分岐（本番では常に false）。
    // ログイン済み → ロールに応じたホームへ / 未ログイン → /dev-login のワンクリック画面へ。
    if (isDevLoginEnabled()) {
      fetch("/api/auth/check", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          if (d?.authorized) {
            const home = isGamesOnlyRole(d.role)
              ? "/games/mahjong"
              : d.profileComplete
                ? "/reservation"
                : "/setup-profile";
            window.location.replace(home);
          } else {
            window.location.replace("/dev-login");
          }
        })
        .catch(() => window.location.replace("/dev-login"));
      return;
    }

    // ログアウト直後は自動ログインせず「ログアウトしました」画面を出す（即再ログイン防止）。
    // フラグは一度きり消費する。
    let loggedOut = false;
    try {
      loggedOut = !!sessionStorage.getItem(LOGGED_OUT_FLAG);
      if (loggedOut) sessionStorage.removeItem(LOGGED_OUT_FLAG);
    } catch { /* 無視 */ }

    if (loggedOut) {
      setPhase("logged-out");
      return;
    }
    runBoot();
  }, [runBoot]);

  // ── ログアウト後画面（自動再ログインせず、明示的に再ログイン） ──
  if (phase === "logged-out") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="opacity-20 mb-6">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={80} height={80} priority />
        </div>
        <p className="text-sm font-medium text-[#231714]">ログアウトしました</p>
        <p className="text-xs text-[#231714]/40 mt-1 mb-6">ご利用ありがとうございました</p>
        <button
          onClick={runBoot}
          className="px-6 py-3 rounded-xl bg-[#231714] text-white text-sm font-medium active:scale-[0.98] transition-transform"
        >
          ログインする
        </button>
      </div>
    );
  }

  // ── アカウントなし画面（柴犬インタラクティブゲーム） ──
  if (phase === "no-account") {
    return <ShibaGame />;
  }

  // ── エラー画面 ──
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="opacity-20 mb-6">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={80} height={80} priority />
        </div>
        <p className="text-sm text-[#231714]/50 text-center">{statusText}</p>
      </div>
    );
  }

  // ── ローディング画面 ──
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400 mt-2">{statusText}</p>
      </div>
    </div>
  );
}
