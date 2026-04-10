"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * 管理者ログインページ — Google OAuth のみ
 *
 * 1. Google Identity Services (GSI) を読み込み
 * 2. 「Googleでログイン」ボタンを表示
 * 3. Google ID トークンをサーバーに送信して検証
 * 4. 許可されたメールアドレスなら管理者セッション Cookie を発行
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // すでにログイン済みならダッシュボードへ
  useEffect(() => {
    fetch("/api/admin/auth", { credentials: "same-origin" })
      .then((res) => {
        if (res.ok) router.replace("/admin");
        else setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));
  }, [router]);

  // Google ID トークンをサーバーに送信
  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      setError(null);
      setLoading(true);

      try {
        const res = await fetch("/api/admin/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ idToken: response.credential }),
        });

        if (res.ok) {
          router.replace("/admin");
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "認証に失敗しました");
        }
      } catch {
        setError("接続エラーが発生しました。もう一度お試しください。");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  // Google Identity Services の読み込みと初期化
  useEffect(() => {
    if (checkingSession) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      setError("Google OAuth Client ID が設定されていません");
      return;
    }

    // GSI スクリプトが既に読み込まれている場合
    if (window.google?.accounts?.id) {
      initializeGsi(clientId);
      return;
    }

    // GSI スクリプトを動的に読み込み
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => initializeGsi(clientId);
    script.onerror = () => setError("Google認証の読み込みに失敗しました");
    document.head.appendChild(script);

    function initializeGsi(id: string) {
      window.google.accounts.id.initialize({
        client_id: id,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      // Google ボタンをレンダリング
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingSession, handleCredentialResponse]);

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#A5C1C8]/40 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#231714]/40">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50/80 to-indigo-100/60 flex items-center justify-center p-4 relative overflow-hidden">
      {/* 背景デコレーション */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-gradient-to-br from-blue-200/40 to-indigo-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 -left-20 w-72 h-72 bg-gradient-to-br from-emerald-200/30 to-cyan-200/20 rounded-full blur-3xl" />

      <div className="relative bg-white/50 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border border-white/60 p-8 w-full max-w-sm">
        {/* ロゴ */}
        <div className="mb-7 text-center">
          <div className="w-12 h-12 bg-gradient-to-br from-[#A5C1C8] to-[#7BA8B0] rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-[#A5C1C8]/20">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="2" y="3" width="18" height="16" rx="3" stroke="white" strokeWidth="1.5"/>
              <path d="M7 2v2M15 2v2M2 9h18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M7 13h8M7 16h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-lg font-bold text-[#231714]">管理者ログイン</h1>
          <p className="text-xs text-[#231714]/40 mt-1">EIGHT BASE UNGA 管理ダッシュボード</p>
        </div>

        {/* Google ログインボタン */}
        <div className="flex flex-col items-center space-y-4">
          {loading ? (
            <div className="flex items-center space-x-2 py-3">
              <div className="w-5 h-5 border-2 border-[#A5C1C8]/40 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#231714]/60">認証中...</span>
            </div>
          ) : (
            <div ref={googleBtnRef} className="flex justify-center" />
          )}

          {error && (
            <div className="w-full bg-red-50/60 backdrop-blur-sm border border-red-200/40 rounded-xl px-4 py-3">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <p className="text-xs text-[#231714]/40 text-center leading-relaxed">
            管理者として登録されたGoogleアカウントで<br />ログインしてください
          </p>
        </div>
      </div>
    </div>
  );
}

// Google Identity Services の型定義
declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              theme?: string;
              size?: string;
              width?: number;
              text?: string;
              shape?: string;
              logo_alignment?: string;
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}
