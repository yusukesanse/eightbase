"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";

/**
 * 管理者ログインページ
 *
 * 方法1: Google OAuth (従来)
 * 方法2: メールアドレス + 6桁認証コード + reCAPTCHA v2
 */

type EmailStep = "email" | "code";

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // メール認証ステート
  const [emailStep, setEmailStep] = useState<EmailStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const recaptchaRef = useRef<HTMLDivElement>(null);

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
      // Google OAuthが設定されていなくても、メール認証は使える
      return;
    }

    if (window.google?.accounts?.id) {
      initializeGsi(clientId);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => initializeGsi(clientId);
    document.head.appendChild(script);

    function initializeGsi(id: string) {
      window.google.accounts.id.initialize({
        client_id: id,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

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

  // reCAPTCHA v2 初期化
  useEffect(() => {
    if (checkingSession) return;
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    if (!siteKey || !recaptchaRef.current) return;

    // grecaptcha がロードされたらレンダリング
    const renderRecaptcha = () => {
      if (window.grecaptcha && recaptchaRef.current) {
        try {
          // すでにレンダリング済みの場合にリセット
          if (recaptchaRef.current.childNodes.length > 0) {
            window.grecaptcha.reset();
            return;
          }
          window.grecaptcha.render(recaptchaRef.current, {
            sitekey: siteKey,
            callback: (token: string) => setRecaptchaToken(token),
            "expired-callback": () => setRecaptchaToken(null),
          });
        } catch {
          // 既にレンダリング済みの場合のエラーを無視
        }
      }
    };

    if (typeof window.grecaptcha !== "undefined") {
      renderRecaptcha();
    } else {
      // スクリプトのロード完了を待つ
      (window as unknown as Record<string, () => void>).__recaptchaCallback = renderRecaptcha;
    }
  }, [checkingSession]);

  // クールダウンタイマー
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // ── メール認証: コード送信 ──
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("メールアドレスを入力してください");
      return;
    }
    if (!recaptchaToken) {
      setError("「私はロボットではありません」にチェックを入れてください");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), recaptchaToken }),
      });

      const data = await res.json();

      if (res.ok) {
        setCodeSent(true);
        setEmailStep("code");
        setCooldown(60);
      } else {
        setError(data.error || "送信に失敗しました");
        // reCAPTCHAリセット
        if (window.grecaptcha) {
          window.grecaptcha.reset();
          setRecaptchaToken(null);
        }
      }
    } catch {
      setError("接続エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  // ── メール認証: コード検証 ──
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("6桁の認証コードを入力してください");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), code }),
      });

      if (res.ok) {
        router.replace("/admin");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "認証に失敗しました");
      }
    } catch {
      setError("接続エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  // ── コード再送信 ──
  async function handleResendCode() {
    if (cooldown > 0 || !recaptchaToken) return;
    setError(null);
    setLoading(true);

    try {
      // reCAPTCHAリセット & 再チェック要求
      if (window.grecaptcha) {
        window.grecaptcha.reset();
        setRecaptchaToken(null);
      }
      setEmailStep("email");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

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

  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50/80 to-indigo-100/60 flex items-center justify-center p-4 relative overflow-hidden">
      {/* reCAPTCHA v2 スクリプト */}
      {recaptchaSiteKey && (
        <Script
          src="https://www.google.com/recaptcha/api.js?onload=__recaptchaCallback&render=explicit"
          strategy="afterInteractive"
        />
      )}

      {/* 背景デコレーション */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-gradient-to-br from-blue-200/40 to-indigo-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 -left-20 w-72 h-72 bg-gradient-to-br from-emerald-200/30 to-cyan-200/20 rounded-full blur-3xl" />

      <div className="relative bg-white/50 backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border border-white/60 p-8 w-full max-w-sm">
        {/* ロゴ */}
        <div className="mb-7 text-center">
          <div className="w-12 h-12 bg-gradient-to-br from-[#A5C1C8] to-[#7BA8B0] rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-[#A5C1C8]/30">
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
        <div className="flex flex-col items-center">
          <div ref={googleBtnRef} className="flex justify-center" />
        </div>

        {/* セパレータ */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-[#231714]/10" />
          <span className="text-[11px] text-[#231714]/30 font-medium">または</span>
          <div className="flex-1 h-px bg-[#231714]/10" />
        </div>

        {/* メール認証フォーム */}
        {emailStep === "email" ? (
          <form onSubmit={handleSendCode} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#231714]/60 mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full border border-[#231714]/10 rounded-xl px-4 py-2.5 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#A5C1C8] focus:border-transparent transition-all"
                autoComplete="email"
                disabled={loading}
              />
            </div>

            {/* reCAPTCHA */}
            {recaptchaSiteKey && (
              <div className="flex justify-center">
                <div ref={recaptchaRef} />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || (!!recaptchaSiteKey && !recaptchaToken)}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#231714] text-white hover:bg-[#231714]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "送信中..." : "認証コードを送信"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <div className="bg-[#A5C1C8]/10 rounded-xl px-4 py-3 mb-1">
              <p className="text-xs text-[#231714]/60">
                <strong className="text-[#231714]">{email}</strong> に認証コードを送信しました
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#231714]/60 mb-1">認証コード（6桁）</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="000000"
                className="w-full border border-[#231714]/10 rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#A5C1C8] focus:border-transparent transition-all"
                autoFocus
                autoComplete="one-time-code"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#231714] text-white hover:bg-[#231714]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "認証中..." : "ログイン"}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setEmailStep("email");
                  setCode("");
                  setError(null);
                  setCodeSent(false);
                  if (window.grecaptcha) {
                    window.grecaptcha.reset();
                    setRecaptchaToken(null);
                  }
                }}
                className="text-xs text-[#231714]/40 hover:text-[#231714]/60 transition-colors"
              >
                ← メールアドレスを変更
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={cooldown > 0}
                className="text-xs text-[#A5C1C8] hover:text-[#7BA8B0] disabled:text-[#231714]/20 transition-colors"
              >
                {cooldown > 0 ? `再送信 (${cooldown}秒)` : "コードを再送信"}
              </button>
            </div>
          </form>
        )}

        {/* エラー */}
        {error && (
          <div className="mt-4 w-full bg-red-50/60 backdrop-blur-sm border border-red-200/40 rounded-xl px-4 py-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        <p className="text-[10px] text-[#231714]/30 text-center mt-5 leading-relaxed">
          管理者として登録されたアカウントでログインしてください
        </p>

        {/* 認証中オーバーレイ */}
        {loading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-[#231714]/60">
                {emailStep === "code" ? "認証中..." : "送信中..."}
              </p>
            </div>
          </div>
        )}
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
    grecaptcha: {
      render: (
        element: HTMLElement,
        config: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => number;
      reset: (widgetId?: number) => void;
      getResponse: (widgetId?: number) => string;
    };
  }
}
