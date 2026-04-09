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

        const res = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
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
              <path d="M11 2a5 5 0 015 5v0a5 5 0 01-10 0v0a5 5 0 015-5z" stroke="#414141" strokeWidth="1.5" />
              <path d="M3 20c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="#414141" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-wide text-[#414141]">アカウント連携</h1>
          <p className="text-sm text-[#414141]/60 mt-1">初回ログイン — LINEアカウントと紐づけます</p>
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
              <div className="w-12 h-12 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2a4 4 0 014 4v0a4 4 0 01-8 0v0a4 4 0 014-4z" stroke="#A5C1C8" strokeWidth="1.5" />
                  <path d="M2 18c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="#A5C1C8" strokeWidth="1.5" />
                </svg>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-[#414141]">{lineInfo.displayName}</p>
              <p className="text-xs text-[#414141]/40">LINE アカウント</p>
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
            <h2 className="text-base font-semibold text-[#414141] mb-1">本人確認</h2>
            <p className="text-xs text-[#414141]/50 mb-4 leading-relaxed">
              管理者から通知されたメールアドレスとパスワードを入力してください。
              初回のみの操作です。
            </p>

            <form onSubmit={handleLinkSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  required
                  autoComplete="email"
                  className="w-full px-3 py-3 text-sm border border-[#414141]/10 rounded-xl focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">
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
                    className="w-full px-3 py-3 pr-10 text-sm border border-[#414141]/10 rounded-xl focus:outline-none focus:border-[#414141] focus:ring-1 focus:ring-[#414141] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#414141]/30 hover:text-[#414141]/60"
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
                className="w-full py-3 text-sm font-medium bg-[#414141] text-white rounded-xl hover:bg-[#414141]/80 transition-colors mt-2"
              >
                アカウントを連携する
              </button>
            </form>
          </div>

          <p className="text-xs text-[#414141]/30 text-center mt-4 leading-relaxed">
            メールアドレスとパスワードがわからない場合は<br />管理者にお問い合わせください
          </p>
        </div>
      </div>
    );
  }

  // ── アクセス不可 ──
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#A5C1C8] px-5 pt-12 pb-8">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-3">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="3" width="18" height="16" rx="3" stroke="#414141" strokeWidth="1.5" />
            <path d="M7 2v2M15 2v2M2 9h18" stroke="#414141" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M7 13h8M7 16h5" stroke="#414141" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-wide text-[#414141]">EIGHT BASE UNGA</h1>
        <p className="text-sm text-[#414141]/60 mt-1">シェアオフィス 施設予約システム</p>
      </div>

      <div className="flex-1 px-4 pt-6 pb-8">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            LINEミニアプリからアクセスしてください
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            このアプリはLINEミニアプリとしてご利用いただけます。
            LINEアプリ内からアクセスすると、自動的にログインされます。
          </p>
        </div>
      </div>
    </div>
  );
}
