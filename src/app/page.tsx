"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import AccessRequestForm from "@/components/AccessRequestForm";
import { useLiffBoot } from "@/hooks/useLiffBoot";
import { isDevLoginEnabled } from "@/lib/env";
import { normalizeRole } from "@/lib/roles";
import { loginDestination } from "@/lib/loginDestination";
import { AuthRecovery } from "@/components/AuthRecovery";
import { clearAuthCache } from "@/components/AuthGuard";
import { getStoredDevIdentity, setStoredDevIdentity } from "@/lib/devLogin";
import type { LiffPendingRequest } from "@/lib/liff";
import { Button, GlassCard, PageBg } from "@/components/ui/eb";

const LOGGED_OUT_FLAG = "eb_logged_out";

/** ご利用形態の表示名（申請中カードで使う）。 */
const ROLE_LABELS: Record<LiffPendingRequest["requestedRole"], string> = {
  member: "オフィス契約者",
  staff: "社員",
  guest: "ゲスト",
};

/** ISO文字列を「M月D日」にする（JST基準。読めなければ空文字）。 */
function formatRequestDate(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

/** 中央寄せの丸アイコン（各画面共通のトーン）。 */
function CircleIcon({ background, children }: { background: string; children: React.ReactNode }) {
  return (
    <div
      className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-[26px]"
      style={{ background }}
    >
      {children}
    </div>
  );
}

/** 緑の輪のスピナー（40px）。 */
function Spinner() {
  return (
    <div
      className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
      style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
    />
  );
}

/**
 * 開発環境（固定ログイン）のロールをドメインで決める。
 * ゲスト用ドメイン（NEXT_PUBLIC_GUEST_DOMAIN）なら guest、それ以外は会員(member)。
 */
function devFixedRole(): "member" | "guest" {
  const guestDomain = process.env.NEXT_PUBLIC_GUEST_DOMAIN;
  if (guestDomain && typeof window !== "undefined" && window.location.host === guestDomain) {
    return "guest";
  }
  return "member";
}

export default function HomePage() {
  const boot = useLiffBoot();
  const [phase, setPhase] = useState<
    "loading" | "no-account" | "pending-request" | "edit-request" | "error" | "logged-out"
  >("loading");
  const [statusText, setStatusText] = useState("LIFF初期化中...");
  const [pendingRequest, setPendingRequest] = useState<LiffPendingRequest | null>(null);

  // `/` と `/login` で共通の LIFF→サーバーセッション発行フロー（useLiffBoot）。
  // ログアウト後の「ログインする」ボタンからも呼べるように useCallback で切り出す。
  const runBoot = useCallback(async () => {
    setPhase("loading");
    setStatusText("認証中...");

    const result = await boot();
    if (!result) {
      // 例外発生（boot 内でログ済み）
      setStatusText("エラーが発生しました。ページを再読み込みしてください。");
      setPhase("error");
      return;
    }

    switch (result.kind) {
      case "redirecting":
        setStatusText("LINEログイン中...");
        return;
      case "linked":
        // boot() 内で表示キャッシュ破棄＋遷移済み
        return;
      case "needs-dev-login":
        // 開発環境の入口 `/` へ（ドメインごとの固定ロールで自動ログイン）
        window.location.replace("/");
        return;
      case "pending-request":
        // 申請済みで承認待ち。申請フォームを出し直さず「現在申請中です」を出す。
        setPendingRequest(result.request);
        setPhase("pending-request");
        return;
      case "needs-linking":
        // 未連携/未招待は OTP を自動表示せず「利用申請」フォームを出す。
        setPhase("no-account");
        return;
      case "needs-line-login":
        setStatusText("LINEアプリから開き直してください。");
        setPhase("error");
        return;
      case "no-access":
        setStatusText(result.error || "ログインを確認できませんでした。もう一度お試しください。");
        setPhase("error");
        return;
    }
  }, [boot]);

  useEffect(() => {
    // DEV-ONLY（develop 専用 / main へ入れない）: 非本番のみ URLごと固定ロールで自動ログイン。
    // 本番は isDevLoginEnabled()===false で下の通常フロー（LIFF）に進む。
    if (isDevLoginEnabled()) {
      // DEV検証専用: ?apply=1 で「未登録の擬似LINEユーザー」として利用申請フォームを表示する。
      // 本番は isDevLoginEnabled()===false なので発動しない（自動ログインもしない）。
      if (new URLSearchParams(window.location.search).get("apply") === "1") {
        const stored = getStoredDevIdentity();
        if (!stored || !stored.userId.startsWith("applicant-")) {
          setStoredDevIdentity({ userId: `applicant-${Date.now()}`, displayName: "申請テスト" });
        }
        setPhase("no-account");
        return;
      }
      const role = devFixedRole();
      const loginAs = () => {
        clearAuthCache();
        fetch("/api/dev/quick-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ role }),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error("Dev login failed");
            const data = await r.json();
            if (!data.success) throw new Error("Dev login failed");
            window.location.replace(loginDestination(data.role, !!data.profileComplete, window.location.search));
          })
          .catch(() => {
            setStatusText("ログインに失敗しました。ページを再読み込みしてください。");
            setPhase("error");
          });
      };
      fetch("/api/auth/check", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          // 既にこのドメインの固定ロールでログイン済みならそのままホームへ。
          if (d?.authorized && normalizeRole(d.role) === role) {
            window.location.replace(loginDestination(d.role, d.profileComplete, window.location.search));
          } else {
            loginAs();
          }
        })
        .catch(loginAs);
      return;
    }

    // ログアウト直後は自動ログインせず「ログアウトしました」画面を出す（即再ログイン防止）。
    // フラグは一度きり消費する。
    let loggedOut = false;
    try {
      loggedOut = !!sessionStorage.getItem(LOGGED_OUT_FLAG);
      if (loggedOut) sessionStorage.removeItem(LOGGED_OUT_FLAG);
    } catch { /* 無視 */ }

    if (loggedOut) {
      setPhase("logged-out");
      return;
    }
    runBoot();
  }, [runBoot]);

  // ── ログアウト後画面（自動再ログインせず、明示的に再ログイン） ──
  if (phase === "logged-out") {
    return (
      <PageBg className="flex flex-col items-center justify-center px-6">
        <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={72} height={72} priority className="mb-6" />
        <p className="text-[17px] font-bold text-[color:var(--eb-ink)]">ログアウトしました</p>
        <p className="mt-1 mb-6 text-[15px] text-[color:var(--eb-ink-muted)]">
          ご利用ありがとうございました
        </p>
        <div className="w-full max-w-sm">
          <Button variant="primary" onClick={runBoot}>
            ログインする
          </Button>
        </div>
      </PageBg>
    );
  }

  // ── 現在申請中です（承認待ち） ──
  if (phase === "pending-request" && pendingRequest) {
    const requestedAt = formatRequestDate(pendingRequest.createdAt);
    return (
      <PageBg className="flex items-center justify-center px-5">
        <div className="w-full max-w-sm">
          <GlassCard>
            <div className="text-center">
              <CircleIcon background="rgba(217,169,58,.18)">⏳</CircleIcon>
              <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">現在申請中です</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
                管理者が確認しています。承認されると、メールでご案内が届きます。
              </p>
            </div>

            <dl
              className="mt-5 space-y-2 rounded-2xl p-4 text-[15px]"
              style={{ background: "var(--eb-tint)" }}
            >
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-[color:var(--eb-ink-muted)]">お名前</dt>
                <dd className="min-w-0 break-words text-[color:var(--eb-ink)]">
                  {pendingRequest.displayName || "—"}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-[color:var(--eb-ink-muted)]">利用形態</dt>
                <dd className="min-w-0 text-[color:var(--eb-ink)]">
                  {ROLE_LABELS[pendingRequest.requestedRole]}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-[color:var(--eb-ink-muted)]">メール</dt>
                <dd className="min-w-0 break-all text-[color:var(--eb-ink)]">
                  {pendingRequest.email || "—"}
                </dd>
              </div>
              {requestedAt && (
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-[color:var(--eb-ink-muted)]">申請日</dt>
                  <dd className="min-w-0 text-[color:var(--eb-ink)]">{requestedAt}</dd>
                </div>
              )}
            </dl>

            <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              メールが届いたら、中のボタンを LINE で開いてください。
            </p>

            <div className="mt-5">
              <Button variant="ghost" onClick={() => setPhase("edit-request")}>
                メールアドレスを直す
              </Button>
            </div>
          </GlassCard>
        </div>
      </PageBg>
    );
  }

  // ── 申請内容の直し（既存の申請を上書き送信する） ──
  if (phase === "edit-request") {
    return (
      <AccessRequestForm
        initialValues={
          pendingRequest
            ? {
                displayName: pendingRequest.displayName,
                email: pendingRequest.email,
                requestedRole: pendingRequest.requestedRole,
              }
            : undefined
        }
      />
    );
  }

  // ── アカウントなし画面（未登録＝利用申請フォーム） ──
  if (phase === "no-account") {
    return <AccessRequestForm />;
  }

  // ── エラー画面 ──
  if (phase === "error") {
    return (
      <AuthRecovery title="ログインを確認できませんでした" message={statusText} onRetry={runBoot} />
    );
  }

  // ── ローディング画面 ──
  return (
    <PageBg className="flex flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-[15px] text-[color:var(--eb-ink-muted)]">{statusText}</p>
    </PageBg>
  );
}
