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
export default function HomePage() {
  const router = useRouter();
  const [status, setStatus] = useState("LIFF初期化中...");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // ── Step 1: LIFF SDK 初期化 ──
        const liff = await initLiff();
        if (cancelled) return;

        // ── Step 2: LINE ログイン状態確認 ──
        if (!liff.isLoggedIn()) {
          // LIFF ブラウザ内では通常ここには来ない（自動ログイン済み）
          // 外部ブラウザの場合は LINE ログインへリダイレクト
          setStatus("LINEログイン中...");
          liff.login({ redirectUri: window.location.href });
          return;
        }

        // ── Step 3: LIFF アクセストークンでサーバーセッション作成 ──
        setStatus("認証中...");
        const accessToken = liff.getAccessToken();

        if (!accessToken) {
          setStatus("アクセストークンを取得できませんでした");
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
          router.replace("/reservation");
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus(data.error || "認証に失敗しました。管理者にお問い合わせください。");
        }
      } catch (err) {
        console.error("[HomePage] boot error:", err);
        if (!cancelled) {
          setStatus("エラーが発生しました。ページを再読み込みしてください。");
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500 mt-2">{status}</p>
      </div>
    </div>
  );
}
