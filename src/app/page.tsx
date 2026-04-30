"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { initLiff } from "@/lib/liff";

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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
          <Image src="/logo.svg" alt="" width={320} height={320} priority />
        </div>

        {/* メインコンテンツ */}
        <div className="relative z-10 text-center max-w-xs">
          <div className="mx-auto mb-6 w-28 h-28">
            <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={112} height={112} priority />
          </div>

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
