"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import AccessRequestForm from "@/components/AccessRequestForm";
import { useLiffBoot } from "@/hooks/useLiffBoot";
import { isDevLoginEnabled } from "@/lib/env";
import { isGamesOnlyRole, normalizeRole } from "@/lib/roles";
import { clearAuthCache } from "@/components/AuthGuard";
import { getStoredDevIdentity, setStoredDevIdentity } from "@/lib/devLogin";

const LOGGED_OUT_FLAG = "eb_logged_out";

/**
 * 開発環境（固定ログイン）のロールをドメインで決める。
 * ゲスト用ドメイン（NEXT_PUBLIC_GUEST_DOMAIN）なら guest、それ以外は会員(member)。
 */
function devFixedRole(): "member" | "guest" {
  const guestDomain = process.env.NEXT_PUBLIC_GUEST_DOMAIN;
  if (guestDomain && typeof window !== "undefined" && window.location.host === guestDomain) {
    return "guest";
  }
  return "member";
}

function roleHome(role: string, profileComplete: boolean): string {
  return isGamesOnlyRole(role)
    ? "/games"
    : profileComplete
      ? "/reservation"
      : "/setup-profile";
}

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
        // 開発環境の入口 `/` へ（ドメインごとの固定ロールで自動ログイン）
        window.location.replace("/");
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
    // DEV-ONLY（develop 専用 / main へ入れない）: 非本番のみ URLごと固定ロールで自動ログイン。
    // 本番は isDevLoginEnabled()===false で下の通常フロー（LIFF）に進む。
    if (isDevLoginEnabled()) {
      // DEV検証専用: ?apply=1 で「未登録の擬似LINEユーザー」として利用申請フォームを表示する。
      // 本番は isDevLoginEnabled()===false なので発動しない（自動ログインもしない）。
      if (new URLSearchParams(window.location.search).get("apply") === "1") {
        const stored = getStoredDevIdentity();
        if (!stored || !stored.userId.startsWith("applicant-")) {
          setStoredDevIdentity({ userId: `applicant-${Date.now()}`, displayName: "申請テスト" });
        }
        setPhase("no-account");
        return;
      }
      const role = devFixedRole();
      const loginAs = () => {
        clearAuthCache();
        fetch("/api/dev/quick-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ role }),
        })
          .then((r) => r.json())
          .then((res) => window.location.replace(res.home ?? "/info"))
          .catch(() => {
            setStatusText("ログインに失敗しました。ページを再読み込みしてください。");
            setPhase("error");
          });
      };
      fetch("/api/auth/check", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          // 既にこのドメインの固定ロールでログイン済みならそのままホームへ。
          if (d?.authorized && normalizeRole(d.role) === role) {
            window.location.replace(roleHome(d.role, d.profileComplete));
          } else {
            loginAs();
          }
        })
        .catch(loginAs);
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
        <p className="text-xs text-[#231714]/80 mt-1 mb-6">ご利用ありがとうございました</p>
        <button
          onClick={runBoot}
          className="px-6 py-3 rounded-xl bg-[#231714] text-white text-sm font-medium active:scale-[0.98] transition-transform"
        >
          ログインする
        </button>
      </div>
    );
  }

  // ── アカウントなし画面（未登録＝利用申請フォーム） ──
  if (phase === "no-account") {
    return <AccessRequestForm />;
  }

  // ── エラー画面 ──
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="opacity-20 mb-6">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={80} height={80} priority />
        </div>
        <p className="text-sm text-[#231714]/85 text-center">{statusText}</p>
      </div>
    );
  }

  // ── ローディング画面 ──
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-700 mt-2">{statusText}</p>
      </div>
    </div>
  );
}
