"use client";

/**
 * /invite/[token] — ワンタイム招待URLのランディングページ
 *
 * フロー:
 * 1. LIFF 初期化 → LINE ログイン
 * 2. セッション作成（liff-login）
 * 3. 招待トークンで LINE ID 紐づけ（/api/auth/invite）
 * 4. プロフィール登録画面へリダイレクト
 */

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { initLiff } from "@/lib/liff";

type Phase = "loading" | "linking" | "error" | "expired" | "already";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusText, setStatusText] = useState("初期化中...");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // 1. LIFF 初期化
        setStatusText("LIFF初期化中...");
        const liff = await initLiff();
        if (cancelled) return;

        // 2. LINE ログイン
        if (!liff.isLoggedIn()) {
          setStatusText("LINEログイン中...");
          liff.login({ redirectUri: window.location.href });
          return;
        }

        // 3. セッション作成
        setStatusText("認証中...");
        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setStatusText("アクセストークンを取得できませんでした");
          setPhase("error");
          return;
        }

        let liffProfile: { userId?: string; displayName?: string; pictureUrl?: string } = {};
        try {
          const p = await liff.getProfile();
          liffProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" };
        } catch { /* ignore */ }

        const loginRes = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, liffProfile }),
          credentials: "include",
        });

        if (cancelled) return;

        if (loginRes.ok) {
          const loginData = await loginRes.json().catch(() => ({}));
          if (loginData.success) {
            // 既にアカウント連携済み → そのまま予約画面へ
            router.replace("/reservation");
            return;
          }
        }

        // 4. 招待トークンで紐づけ
        setPhase("linking");
        setStatusText("アカウントを作成中...");

        const inviteRes = await fetch("/api/auth/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include",
        });

        if (cancelled) return;

        const inviteData = await inviteRes.json();

        if (inviteRes.ok && inviteData.success) {
          // プロフィール登録へ
          router.replace("/setup-profile");
          return;
        }

        if (inviteData.alreadyLinked) {
          setPhase("already");
          return;
        }

        if (inviteRes.status === 410) {
          setPhase("expired");
          setStatusText(inviteData.error || "この招待URLは無効です");
          return;
        }

        setStatusText(inviteData.error || "エラーが発生しました");
        setPhase("error");
      } catch (err) {
        console.error("[InvitePage] error:", err);
        if (!cancelled) {
          setStatusText("エラーが発生しました。ページを再読み込みしてください。");
          setPhase("error");
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [router, token]);

  if (phase === "already") {
    return (
      <CenterLayout>
        <StatusIcon type="success" />
        <p className="text-sm font-medium text-[#231714] mt-4">既に登録済みです</p>
        <p className="text-xs text-[#231714]/50 mt-1">このLINEアカウントは既に登録されています。</p>
        <button
          onClick={() => router.replace("/reservation")}
          className="mt-6 px-6 py-3 text-sm font-medium bg-[#231714] text-white rounded-xl"
        >
          アプリを開く
        </button>
      </CenterLayout>
    );
  }

  if (phase === "expired") {
    return (
      <CenterLayout>
        <StatusIcon type="expired" />
        <p className="text-sm font-medium text-[#231714] mt-4">招待URLが無効です</p>
        <p className="text-xs text-[#231714]/50 mt-2 text-center max-w-xs">{statusText}</p>
      </CenterLayout>
    );
  }

  if (phase === "error") {
    return (
      <CenterLayout>
        <StatusIcon type="error" />
        <p className="text-sm text-[#231714]/50 mt-4 text-center">{statusText}</p>
      </CenterLayout>
    );
  }

  // loading / linking
  return (
    <CenterLayout>
      <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-[#231714]/50 mt-4">{statusText}</p>
    </CenterLayout>
  );
}

function CenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
      {children}
    </div>
  );
}

function StatusIcon({ type }: { type: "success" | "expired" | "error" }) {
  const colors = {
    success: "text-[#B0E401]",
    expired: "text-orange-400",
    error: "text-red-400",
  };
  const paths = {
    success: <path d="M6 12l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    expired: <><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M12 7v6M12 16v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
    error: <><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  };

  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className={colors[type]}>
      {paths[type]}
    </svg>
  );
}
