"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { initLiff } from "@/lib/liff";
import { isDevLoginEnabled } from "@/lib/env";
import { clearAuthCache } from "@/components/AuthGuard";
import { Button, Field, GlassCard, PageBg, inputClass } from "@/components/ui/eb";

// ゲストのゲームハブは /games。AuthGuard の GUEST_HOME と一致させる。
const GUEST_HOME = "/games";

/** 連携中に出す固定文言。 */
const LINKING_TEXT = "LINE と連携しています…";

/** 緑の輪のスピナー（40px）。 */
function Spinner() {
  return (
    <div
      className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
      style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
    />
  );
}

/** 中央寄せの丸アイコン（64px）。 */
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

/** GlassCard 1枚を画面中央に置く共通レイアウト。 */
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <PageBg className="flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <GlassCard>{children}</GlassCard>
      </div>
    </PageBg>
  );
}

function GuestInner() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") || "";

  const [phase, setPhase] = useState<"loading" | "needs-line" | "confirm" | "tip" | "error">("loading");
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // 招待そのものが使えない（redeem 失敗）のか、それ以外（コード無し・通信エラー）かで見出しを変える。
  const [errorKind, setErrorKind] = useState<"invalid-invite" | "other">("other");
  const [saving, setSaving] = useState(false);

  const goGame = useCallback(() => {
    clearAuthCache();
    router.replace(GUEST_HOME);
  }, [router]);

  useEffect(() => {
    if (!code) {
      setPhase("error");
      setErrorKind("other");
      setErrorMsg("招待コードがURLにありません。メールのリンクから開いてください。");
      return;
    }
    let alive = true;
    (async () => {
      try {
        let accessToken: string | null;
        if (isDevLoginEnabled()) {
          // 開発環境（LINE非連携）は招待redeemを通さず、入口 `/` の固定ロール自動ログインに委ねる。
          window.location.replace("/");
          return;
        } else {
          const liff = await initLiff();
          if (!liff.isLoggedIn()) {
            if (liff.isInClient()) {
              // LINEアプリ内: ログインへ（戻り先はこのURL=code付き）
              liff.login({ redirectUri: window.location.href });
              return;
            }
            if (alive) setPhase("needs-line");
            return;
          }
          accessToken = liff.getAccessToken();
          if (!accessToken) {
            if (alive) {
              setPhase("error");
              setErrorKind("other");
              setErrorMsg("LINE情報の取得に失敗しました。LINEアプリで開き直してください。");
            }
            return;
          }
        }
        const res = await fetch("/api/auth/guest-redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code, accessToken }),
        });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setPhase("error");
          setErrorKind("invalid-invite");
          setErrorMsg(data.error || "参加登録に失敗しました。");
          return;
        }
        clearAuthCache();
        if (data.alreadyRegistered) {
          // 既存ユーザー: ゲストはゲームへ、会員/エイト社員は通常ホーム
          //（プロフィール未完了なら AuthGuard が /setup-profile へ誘導する）。
          router.replace(data.role === "guest" ? GUEST_HOME : "/reservation");
          return;
        }
        // 新規の会員/エイト社員: プロフィール登録へ（氏名確認だけでは終わらない）。
        // ゲストだけが氏名確認で完了する（利用範囲がゲームのみのため）。
        if (data.role !== "guest") {
          router.replace("/setup-profile");
          return;
        }
        // 新規ゲスト: 氏名確認へ
        setName(data.displayName || "");
        setPhase("confirm");
      } catch (e) {
        console.error("[guest] error:", e);
        if (alive) {
          setPhase("error");
          setErrorKind("other");
          setErrorMsg("エラーが発生しました。ページを再読み込みしてください。");
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, router]);

  async function startWithName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await fetch("/api/auth/guest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayName: trimmed }),
      });
    } catch {
      /* 名前保存失敗でもゲームには入れる */
    }
    setSaving(false);
    setPhase("tip"); // 登録完了 → 次回の開き方を案内
  }

  // ── 登録完了 + 次回の開き方の案内 ──
  if (phase === "tip") {
    return (
      <CenteredCard>
        <div className="text-center">
          <CircleIcon background="rgba(35,147,94,.14)">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </CircleIcon>
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">登録が完了しました</h1>
        </div>

        <div className="mt-5 rounded-2xl p-4" style={{ background: "var(--eb-tint)" }}>
          <p className="text-[15px] font-bold text-[color:var(--eb-ink)]">次回の開き方</p>
          <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            LINE の「ホーム」→「ミニアプリ」→「EIGHT BASE」
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            公式 LINE のトーク画面からも開けます。
          </p>
        </div>

        <div className="mt-5">
          <Button variant="primary" onClick={goGame}>
            麻雀リーグを開く
          </Button>
        </div>
      </CenteredCard>
    );
  }

  // ── 氏名確認画面 ──
  if (phase === "confirm") {
    return (
      <CenteredCard>
        <div className="text-center">
          <CircleIcon background="rgba(35,147,94,.14)">🀄</CircleIcon>
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">麻雀リーグへようこそ</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            順位表に表示されるお名前を確認してください。あとから変更もできます。
          </p>
        </div>

        <div className="mt-5">
          <Field label="お名前">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-5">
          <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={startWithName}>
            この名前で始める
          </Button>
        </div>
      </CenteredCard>
    );
  }

  // ── LINE で開いてもらう案内 ──
  if (phase === "needs-line") {
    return (
      <CenteredCard>
        <div className="text-center">
          <CircleIcon background="rgba(217,169,58,.18)">
            <span className="font-bold text-[color:var(--eb-gold-text)]">!</span>
          </CircleIcon>
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">LINE で開いてください</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            この招待リンクは LINE アプリの中でだけ使えます。メールの「麻雀リーグに参加する」ボタンを LINE で開いてください。
          </p>
        </div>
      </CenteredCard>
    );
  }

  // ── エラー ──
  if (phase === "error") {
    return (
      <CenteredCard>
        <div className="text-center">
          <CircleIcon background="rgba(217,72,58,.14)">
            <span className="font-bold text-[color:var(--eb-coral-text)]">×</span>
          </CircleIcon>
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">
            {errorKind === "invalid-invite" ? "この招待は使えません" : "うまく読み込めませんでした"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">{errorMsg}</p>
        </div>

        <div className="mt-5">
          <Button variant="primary" onClick={() => window.location.reload()}>
            もう一度読み込む
          </Button>
        </div>
      </CenteredCard>
    );
  }

  // ── ローディング ──
  return (
    <PageBg className="flex flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-[15px] text-[color:var(--eb-ink-muted)]">{LINKING_TEXT}</p>
    </PageBg>
  );
}

export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <PageBg className="flex items-center justify-center">
          <Spinner />
        </PageBg>
      }
    >
      <GuestInner />
    </Suspense>
  );
}
