"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { initLiff } from "@/lib/liff";

/**
 * ログインページ。
 *
 * LIFF 内で開かれた場合:
 *   - LIFF SDK を初期化 → LINE ログイン → セッション作成 → /reservation へ遷移
 *   - メール/パスワードの入力は不要
 *
 * LIFF 外（通常ブラウザ）で開かれた場合:
 *   - LIFF の初期化は行わず、アクセス不可のメッセージを表示
 */
export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "liff-login" | "no-access">("loading");
  const [message, setMessage] = useState("読み込み中...");

  useEffect(() => {
    let cancelled = false;

    async function tryLiffLogin() {
      try {
        const liff = await initLiff();
        if (cancelled) return;

        // LIFF ブラウザ内かどうか判定
        const isInClient = liff.isInClient();

        if (!liff.isLoggedIn()) {
          if (isInClient) {
            // LIFF ブラウザ内で未ログイン → 通常あり得ないが、念のためリダイレクト
            setMessage("LINEログイン中...");
            liff.login({ redirectUri: window.location.origin });
            return;
          }
          // 外部ブラウザで未ログイン
          setStatus("no-access");
          return;
        }

        // LINE ログイン済み → セッション作成
        setStatus("liff-login");
        setMessage("認証中...");

        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setStatus("no-access");
          return;
        }

        const res = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          router.replace("/reservation");
        } else {
          setStatus("no-access");
        }
      } catch (err) {
        console.error("[LoginPage] LIFF error:", err);
        if (!cancelled) {
          setStatus("no-access");
        }
      }
    }

    tryLiffLogin();
    return () => { cancelled = true; };
  }, [router]);

  if (status === "loading" || status === "liff-login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">{message}</p>
        </div>
      </div>
    );
  }

  // アクセス不可
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#06C755] px-5 pt-12 pb-8 text-white">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-3">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="3" width="18" height="16" rx="3" stroke="white" strokeWidth="1.5"/>
            <path d="M7 2v2M15 2v2M2 9h18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M7 13h8M7 16h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-wide">EIGHT BASE UNGA</h1>
        <p className="text-sm text-green-100 mt-1">シェアオフィス 施設予約システム</p>
      </div>

      <div className="flex-1 px-4 pt-6 pb-8">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-800 mb-3">LINEミニアプリからアクセスしてください</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            このアプリはLINEミニアプリとしてご利用いただけます。
            LINEアプリ内からアクセスすると、自動的にログインされます。
          </p>
        </div>
      </div>
    </div>
  );
}
