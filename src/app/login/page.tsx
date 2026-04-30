"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { initLiff } from "@/lib/liff";

/**
 * ログインページ — ハイブリッド認証フロー
 *
 * 1. LIFF 初期化 → LINE ログイン
 * 2. /api/auth/liff-login で authorizedUsers を照合
 *    - 連携済み → セッション発行 → /reservation (or /setup-profile)
 *    - 未連携 → メール+パスワードフォームを表示
 * 3. メール+パスワード認証成功 → LINE ID 連携 → /setup-profile or /reservation
 */
export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<
    "loading" | "liff-login" | "needs-linking" | "linking" | "no-access"
  >("loading");
  const [message, setMessage] = useState("読み込み中...");

  // LINE 情報（未連携時に保持）
  const [lineInfo, setLineInfo] = useState<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string;
  } | null>(null);

  // メール+パスワードフォーム
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tryLiffLogin() {
      try {
        const liff = await initLiff();
        if (cancelled) return;

        const isInClient = liff.isInClient();

        if (!liff.isLoggedIn()) {
          if (isInClient) {
            setMessage("LINEログイン中...");
            liff.login({ redirectUri: window.location.origin });
            return;
          }
          setStatus("no-access");
          return;
        }

        // LINE ログイン済み → LIFF ログイン API
        setStatus("liff-login");
        setMessage("認証中...");

        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setStatus("no-access");
          return;
        }

        // クライアント側でプロフィールを取得（サーバー側 LINE API 失敗時のフォールバック）
        let liffProfile: { userId?: string; displayName?: string; pictureUrl?: string } = {};
        try {
          const p = await liff.getProfile();
          liffProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" };
        } catch (e) {
          console.warn("[LoginPage] liff.getProfile() failed:", e);
        }

        const res = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, liffProfile }),
          credentials: "include",
        });

        if (cancelled) return;

        const data = await res.json();

        if (data.success) {
          // 連携済み → プロフィール完了チェック
          if (data.profileComplete) {
            router.replace("/reservation");
          } else {
            router.replace("/setup-profile");
          }
        } else if (data.needsLinking) {
          // 未連携 → メール+パスワードフォーム表示
          setLineInfo({
            lineUserId: data.lineUserId,
            displayName: data.displayName,
            pictureUrl: data.pictureUrl || "",
          });
          setStatus("needs-linking");
        } else {
          if (data.error) setMessage(data.error);
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
    return () => {
      cancelled = true;
    };
  }, [router]);

  // メール+パスワードで認証 → LINE ID 連携
  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lineInfo) return;

    setLinkError(null);
    setStatus("linking");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          lineUserId: lineInfo.lineUserId,
          lineDisplayName: lineInfo.displayName,
          linePictureUrl: lineInfo.pictureUrl,
        }),
        credentials: "include",
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (data.profileComplete) {
          router.replace("/reservation");
        } else {
          router.replace("/setup-profile");
        }
      } else {
        setLinkError(data.error || "認証に失敗しました");
        setStatus("needs-linking");
      }
    } catch {
      setLinkError("通信エラーが発生しました。もう一度お試しください");
      setStatus("needs-linking");
    }
  }

  // ── ローディング / LIFF ログイン中 ──
  if (status === "loading" || status === "liff-login" || status === "linking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {status === "linking" ? "アカウント連携中..." : message}
          </p>
        </div>
      </div>
    );
  }

  // ── アカウント連携フォーム ──
  if (status === "needs-linking" && lineInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* ヘッダー */}
        <div className="bg-[#A5C1C8] px-5 pt-12 pb-8">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2a5 5 0 015 5v0a5 5 0 01-10 0v0a5 5 0 015-5z" stroke="#231714" strokeWidth="1.5" />
              <path d="M3 20c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-wide text-[#231714]">アカウント連携</h1>
          <p className="text-sm text-[#231714]/60 mt-1">初回ログイン — LINEアカウントと紐づけます</p>
        </div>

        <div className="flex-1 px-4 pt-6 pb-8">
          {/* LINE プロフィール表示 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-4 flex items-center gap-3">
            {lineInfo.pictureUrl ? (
              <img
                src={lineInfo.pictureUrl}
                alt=""
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-[#A5C1C8]/30 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2a4 4 0 014 4v0a4 4 0 01-8 0v0a4 4 0 014-4z" stroke="#A5C1C8" strokeWidth="1.5" />
                  <path d="M2 18c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="#A5C1C8" strokeWidth="1.5" />
                </svg>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-[#231714]">{lineInfo.displayName}</p>
              <p className="text-xs text-[#231714]/40">LINE アカウント</p>
            </div>
            <div className="ml-auto">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#06C755]/10 text-[#06C755] text-xs font-medium rounded-full">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M8.5 1.5l-5 5L1 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                LINE認証済み
              </span>
            </div>
          </div>

          {/* メール+パスワードフォーム */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-base font-semibold text-[#231714] mb-1">本人確認</h2>
            <p className="text-xs text-[#231714]/50 mb-4 leading-relaxed">
              管理者から通知されたメールアドレスとパスワードを入力してください。
              初回のみの操作です。
            </p>

            <form onSubmit={handleLinkSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  required
                  autoComplete="email"
                  className="w-full px-3 py-3 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                  パスワード
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="パスワードを入力"
                    required
                    autoComplete="current-password"
                    className="w-full px-3 py-3 pr-10 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#231714]/30 hover:text-[#231714]/60"
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M2 2l14 14M7.5 7.5a2.12 2.12 0 003 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        <path d="M3 9s2.5-5 6-5c1 0 1.9.3 2.7.7M15 9s-1.2 2.4-3 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M9 5C5.5 5 3 9 3 9s2.5 4 6 4 6-4 6-4-2.5-4-6-4z" stroke="currentColor" strokeWidth="1.3"/>
                        <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {linkError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-red-600">{linkError}</p>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors mt-2"
              >
                アカウントを連携する
              </button>
            </form>
          </div>

          <p className="text-xs text-[#231714]/30 text-center mt-4 leading-relaxed">
            メールアドレスとパスワードがわからない場合は<br />管理者にお問い合わせください
          </p>
        </div>
      </div>
    );
  }

  // ── アクセス不可 ──
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 relative overflow-hidden px-6">
      {/* 背景ロゴ */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-72 h-72 text-[#231714] opacity-[0.06]">
          <path d="M67 30c-18 0-33 13-33 30s15 30 33 30c12 0 22-6 33-18 11 12 21 18 33 18 18 0 33-13 33-30s-15-30-33-30c-12 0-22 6-33 18C89 36 79 30 67 30zm0 10c9 0 17 5 27 17-10 12-18 17-27 17-13 0-23-10-23-20s10-14 23-14zm66 0c13 0 23 4 23 14s-10 20-23 20c-9 0-17-5-27-17 10-12 18-17 27-17z" fill="currentColor"/>
          <circle cx="67" cy="57" r="7" fill="white"/>
          <circle cx="133" cy="57" r="7" fill="white"/>
          <text x="100" y="112" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">EIGHT</text>
          <text x="100" y="132" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">BASE</text>
          <text x="100" y="152" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="16" letterSpacing="4" fill="currentColor">UNGA</text>
        </svg>
      </div>

      {/* メインコンテンツ */}
      <div className="relative z-10 text-center max-w-xs">
        <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-24 h-24 text-[#231714] mx-auto mb-6">
          <path d="M67 70c-18 0-33 13-33 30s15 30 33 30c12 0 22-6 33-18 11 12 21 18 33 18 18 0 33-13 33-30s-15-30-33-30c-12 0-22 6-33 18C89 76 79 70 67 70zm0 10c9 0 17 5 27 17-10 12-18 17-27 17-13 0-23-10-23-20s10-14 23-14zm66 0c13 0 23 4 23 14s-10 20-23 20c-9 0-17-5-27-17 10-12 18-17 27-17z" fill="currentColor"/>
          <circle cx="67" cy="97" r="7" fill="white"/>
          <circle cx="133" cy="97" r="7" fill="white"/>
          <text x="100" y="152" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">EIGHT</text>
          <text x="100" y="172" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" letterSpacing="3" fill="currentColor">BASE</text>
          <text x="100" y="192" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="16" letterSpacing="4" fill="currentColor">UNGA</text>
        </svg>

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
