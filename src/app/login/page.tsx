"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getAuthAccessToken } from "@/lib/liff";
import { clearAuthCache } from "@/components/AuthGuard";
import { useLiffBoot } from "@/hooks/useLiffBoot";
import { Avatar } from "@/components/ui/LineContact";
import { Button, GlassCard, PageBg } from "@/components/ui/eb";
import { AuthRecovery } from "@/components/AuthRecovery";

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
  const boot = useLiffBoot();
  const [status, setStatus] = useState<
    "loading" | "liff-login" | "needs-linking" | "linking" | "no-access" | "error"
  >("loading");
  const [message, setMessage] = useState("読み込み中...");
  const [attempt, setAttempt] = useState(0);

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
      // `/` と共通の LIFF→サーバーセッション発行フロー（useLiffBoot）
      setMessage("認証中...");
      setStatus("loading");
      const result = await boot();
      if (cancelled) return;

      // 例外（boot 内でログ済み）→ アクセス不可表示
      if (!result) {
        setMessage("通信状況を確認して、もう一度お試しください。");
        setStatus("error");
        return;
      }

      switch (result.kind) {
        case "redirecting":
          setStatus("liff-login");
          setMessage("LINEログイン中...");
          return;
        case "linked":
          // boot() 内で表示キャッシュ破棄＋遷移済み
          return;
        case "needs-dev-login":
          // 開発環境の入口 `/` へ（ドメインごとの固定ロールで自動ログイン）
          window.location.replace("/");
          return;
        // "pending-request" は `/` の「現在申請中です」用の結果だが、`/login` は
        // 発行済み OTP の入力導線なので、申請中でも従来どおりコードを入力できるようにする
        // （case を足さないと未連携ユーザーが「認証中...」で止まる）。
        case "pending-request":
        case "needs-linking":
          setLineInfo({
            lineUserId: result.lineUserId,
            displayName: result.displayName,
            pictureUrl: result.pictureUrl || "",
          });
          setStatus("needs-linking");
          return;
        case "needs-line-login":
          setStatus("no-access");
          return;
        case "no-access":
          setMessage(result.error || "ログインを確認できませんでした。もう一度お試しください。");
          setStatus("error");
          return;
      }
    }

    tryLiffLogin();
    return () => {
      cancelled = true;
    };
  }, [boot, attempt]);

  // ワンタイムパスワードで認証 → LINE ID 連携
  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lineInfo) return;

    setLinkError(null);
    setStatus("linking");

    try {
      const accessToken = await getAuthAccessToken();
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

  if (status === "error") {
    return <AuthRecovery title="ログインを確認できませんでした" message={message} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  // ── ローディング / LIFF ログイン中 ──
  if (status === "loading" || status === "liff-login" || status === "linking") {
    return (
      <PageBg className="flex items-center justify-center">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
          />
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">
            {status === "linking" ? "アカウント連携中..." : message}
          </p>
        </div>
      </PageBg>
    );
  }

  // ── アカウント連携フォーム ──
  if (status === "needs-linking" && lineInfo) {
    return (
      <PageBg>
        <div className="flex flex-col items-center px-5 pt-[52px] text-center">
          <div className="mb-4 h-16 w-16">
            <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={64} height={64} priority />
          </div>
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">ログイン</h1>
          <p className="mt-1 text-[14px] text-[color:var(--eb-ink-muted)]">
            初回ログイン — LINEアカウントと紐づけます
          </p>
        </div>

        <div className="px-5 pt-6 pb-10 space-y-4">
          {/* LINE プロフィール表示 */}
          <GlassCard padding="md">
            <div className="flex items-center gap-3">
              <Avatar src={lineInfo.pictureUrl} name={lineInfo.displayName} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{lineInfo.displayName}</p>
                <p className="text-[12px] text-[color:var(--eb-ink-muted)]">LINE アカウント</p>
              </div>
              <span
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold"
                style={{ background: "rgba(6,199,85,.12)", color: "#06C755" }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                  <path d="M8.5 1.5l-5 5L1 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                LINE認証済み
              </span>
            </div>
          </GlassCard>

          {/* ワンタイムパスワードフォーム */}
          <GlassCard>
            <h2 className="text-[16px] font-bold text-[color:var(--eb-ink)]">ワンタイムパスワード</h2>
            <p className="mt-1 mb-4 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              招待メールに記載されたワンタイムパスワードを入力してください。初回のみの操作です。
            </p>

            <form onSubmit={handleLinkSubmit} className="space-y-3">
              <div>
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
                  inputMode="email"
                  lang="en"
                  spellCheck={false}
                  className="h-14 w-full rounded-2xl border bg-white px-4 text-center text-[26px] font-bold uppercase text-[color:var(--eb-ink)] placeholder:text-[#c3cac6] focus:outline-none focus:border-2"
                  style={{ borderColor: "var(--eb-line)", letterSpacing: "0.2em" }}
                />
                {linkError && (
                  <p className="mt-1.5 text-[13px] text-[color:var(--eb-coral-text)]">{linkError}</p>
                )}
              </div>

              <Button type="submit" variant="primary">
                ログイン
              </Button>
            </form>
          </GlassCard>

          <p className="text-center text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            ワンタイムパスワードがわからない場合は<br />管理者にお問い合わせください
          </p>
        </div>
      </PageBg>
    );
  }

  // ── アクセス不可 / LINE未ログイン・外部ブラウザ時 ──
  return (
    <PageBg className="flex items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 h-16 w-16">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={64} height={64} priority />
        </div>
        <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">ログイン</h1>

        <GlassCard className="mt-5 text-left">
          <h2 className="text-[16px] font-bold text-[color:var(--eb-ink)]">アカウントが見つかりません</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            ご利用には招待が必要です。招待メールをお持ちの方は、メール内のワンタイムパスワードでログインしてください。わからない場合は管理者にお問い合わせください。
          </p>
        </GlassCard>
      </div>
    </PageBg>
  );
}
