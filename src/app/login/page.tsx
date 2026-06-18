"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { initLiff } from "@/lib/liff";
import { clearAuthCache } from "@/components/AuthGuard";

/**
 * ログインページ — LIFF + ワンタイムパスワード認証フロー
 *
 * 1. LIFF 初期化 → LINE ログイン
 * 2. /api/auth/liff-login で authorizedUsers を照合
 *    - 連携済み → セッション発行 → /reservation (or /setup-profile)
 *    - 未連携 → ワンタイムパスワードフォームを表示
 * 3. ワンタイムパスワード認証成功 → LINE ID 連携 → /setup-profile
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

  // ワンタイムパスワードフォーム
  const [passcode, setPasscode] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const passcodeRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const prevValueRef = useRef("");

  const handlePasscodeInput = useCallback(() => {
    if (composingRef.current) return;
    const el = passcodeRef.current;
    if (!el) return;

    const prev = prevValueRef.current;
    let v = el.value.toUpperCase();
    const isDeleting = v.length < prev.length;

    // 削除操作時はフォーマットせずそのまま受け入れる
    if (!isDeleting) {
      // "EB" の直後にハイフンを自動挿入（追加時のみ）
      if (v.length === 2 && v === "EB") {
        v = "EB-";
      } else if (v.length > 2 && v.startsWith("EB") && v[2] !== "-") {
        v = "EB-" + v.slice(2);
      }
      v = v.slice(0, 9);
    }

    el.value = v;
    prevValueRef.current = v;
    setPasscode(v);
  }, []);

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
            liff.login({ redirectUri: window.location.href });
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
          clearAuthCache();
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

  // ワンタイムパスワードで認証 → LINE ID 連携
  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lineInfo) return;

    setLinkError(null);
    setStatus("linking");

    try {
      const liff = await initLiff();
      const accessToken = liff.getAccessToken();
      if (!accessToken) {
        setLinkError("LINE アカウント情報を確認できませんでした。もう一度お試しください。");
        setStatus("needs-linking");
        return;
      }

      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim().toUpperCase(), accessToken }),
        credentials: "include",
      });

      const data = await res.json();

      if (res.ok && data.success) {
        clearAuthCache();
        router.replace("/setup-profile");
      } else if (data.alreadyLinked) {
        clearAuthCache();
        router.replace("/reservation");
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

          {/* ワンタイムパスワードフォーム */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-base font-semibold text-[#231714] mb-1">ワンタイムパスワード</h2>
            <p className="text-xs text-[#231714]/50 mb-4 leading-relaxed">
              管理者から提供されたワンタイムパスワードを入力してください。
              初回のみの操作です。
            </p>

            <form onSubmit={handleLinkSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">
                  ワンタイムパスワード
                </label>
                <input
                  ref={passcodeRef}
                  type="text"
                  defaultValue=""
                  onInput={handlePasscodeInput}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; handlePasscodeInput(); }}
                  placeholder="EB-A3X9K2"
                  maxLength={9}
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  inputMode="url"
                  lang="en"
                  spellCheck={false}
                  className="w-full px-3 py-3 text-base font-mono tracking-widest text-center uppercase border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] transition-colors"
                />
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
                登録する
              </button>
            </form>
          </div>

          <p className="text-xs text-[#231714]/30 text-center mt-4 leading-relaxed">
            ワンタイムパスワードがわからない場合は<br />管理者にお問い合わせください
          </p>
        </div>
      </div>
    );
  }

  // ── アクセス不可 ──
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
      <div className="text-center max-w-xs">
        <div className="mx-auto mb-6 w-28 h-28">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={112} height={112} priority />
        </div>

        <h2 className="text-base font-bold text-[#231714]">
          アカウントが存在しません
        </h2>
      </div>
    </div>
  );
}
