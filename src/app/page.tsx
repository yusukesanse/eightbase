"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { initLiff } from "@/lib/liff";

/**
 * ホームページ — LIFF エンドポイント URL のランディングページ。
 *
 * 1. liff.init() を完了させる（LINE の OAuth フローを処理）
 * 2. LINE ログイン済みなら LIFF アクセストークンでセッションを作成
 * 3. /reservation へ遷移
 *
 * ⚠️ AuthGuard より先に LIFF 初期化を行う必要があるため、
 *   このパスは AuthGuard の PUBLIC_PATHS に含めること。
 */

/** ロゴ SVG（∞ + EIGHT BASE UNGA） */
function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* ∞ マーク */}
      <path
        d="M67 70c-18 0-33 13-33 30s15 30 33 30c12 0 22-6 33-18 11 12 21 18 33 18 18 0 33-13 33-30s-15-30-33-30c-12 0-22 6-33 18C89 76 79 70 67 70zm0 10c9 0 17 5 27 17-10 12-18 17-27 17-13 0-23-10-23-20s10-14 23-14zm66 0c13 0 23 4 23 14s-10 20-23 20c-9 0-17-5-27-17 10-12 18-17 27-17z"
        fill="currentColor"
      />
      {/* 目（白丸） */}
      <circle cx="67" cy="97" r="7" fill="white" />
      <circle cx="133" cy="97" r="7" fill="white" />
      {/* テキスト */}
      <text x="100" y="152" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">EIGHT</text>
      <text x="100" y="172" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">BASE</text>
      <text x="100" y="192" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="16" letterSpacing="4" fill="currentColor">UNGA</text>
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "no-account" | "error">("loading");
  const [statusText, setStatusText] = useState("LIFF初期化中...");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // ── Step 1: LIFF SDK 初期化 ──
        const liff = await initLiff();
        if (cancelled) return;

        // ── Step 2: LINE ログイン状態確認 ──
        if (!liff.isLoggedIn()) {
          setStatusText("LINEログイン中...");
          liff.login({ redirectUri: window.location.href });
          return;
        }

        // ── Step 3: LIFF アクセストークンでサーバーセッション作成 ──
        setStatusText("認証中...");
        const accessToken = liff.getAccessToken();

        if (!accessToken) {
          setStatusText("アクセストークンを取得できませんでした");
          setPhase("error");
          return;
        }

        // クライアント側でプロフィールを取得（サーバー側 LINE API 失敗時のフォールバック）
        let liffProfile: { userId?: string; displayName?: string; pictureUrl?: string } = {};
        try {
          const p = await liff.getProfile();
          liffProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" };
        } catch (e) {
          console.warn("[HomePage] liff.getProfile() failed:", e);
        }

        const res = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, liffProfile }),
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.success) {
            router.replace("/reservation");
          } else if (data.needsLinking) {
            // 未連携ユーザー → アカウントなし画面
            setPhase("no-account");
          } else {
            setPhase("no-account");
          }
        } else {
          // 401 / 500 など
          setPhase("no-account");
        }
      } catch (err) {
        console.error("[HomePage] boot error:", err);
        if (!cancelled) {
          setStatusText("エラーが発生しました。ページを再読み込みしてください。");
          setPhase("error");
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [router]);

  // ── アカウントなし画面 ──
  if (phase === "no-account") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 relative overflow-hidden px-6">
        {/* 背景ロゴ */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Logo className="w-72 h-72 text-[#231714] opacity-[0.06]" />
        </div>

        {/* メインコンテンツ */}
        <div className="relative z-10 text-center max-w-xs">
          <Logo className="w-24 h-24 text-[#231714] mx-auto mb-6" />

          <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-sm p-6">
            <div className="w-12 h-12 rounded-full bg-[#A5C1C8]/15 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="#A5C1C8" strokeWidth="1.8"/>
                <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="#A5C1C8" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="12" y1="18" x2="12" y2="14" stroke="#A5C1C8" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="10" y1="16" x2="14" y2="16" stroke="#A5C1C8" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="text-base font-bold text-[#231714] mb-2">
              アカウントが存在しません
            </h2>
            <p className="text-sm text-[#231714]/50 leading-relaxed">
              ご契約者様は、施設管理者までお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── エラー画面 ──
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <Logo className="w-20 h-20 text-[#231714] opacity-20 mb-6" />
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
