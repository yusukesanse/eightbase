"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { initLiff } from "@/lib/liff";
import { clearAuthCache } from "@/components/AuthGuard";

const GUEST_HOME = "/games/mahjong";

function Spinner() {
  return <div className="w-9 h-9 border-2 border-[#2f7d57] border-t-transparent rounded-full animate-spin" />;
}

function GuestInner() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") || "";

  const [phase, setPhase] = useState<"loading" | "needs-line" | "confirm" | "error">("loading");
  const [statusText, setStatusText] = useState("LINEと連携しています…");
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const goGame = useCallback(() => {
    clearAuthCache();
    router.replace(GUEST_HOME);
  }, [router]);

  useEffect(() => {
    if (!code) {
      setPhase("error");
      setErrorMsg("招待コードがURLにありません。メールのリンクから開いてください。");
      return;
    }
    let alive = true;
    (async () => {
      try {
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
        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          if (alive) {
            setPhase("error");
            setErrorMsg("LINE情報の取得に失敗しました。LINEアプリで開き直してください。");
          }
          return;
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
          setErrorMsg(data.error || "参加登録に失敗しました。");
          return;
        }
        clearAuthCache();
        if (data.alreadyRegistered) {
          // 既存ユーザー: 会員は通常ホーム、ゲストはゲームへ
          router.replace(data.role === "member" ? "/reservation" : GUEST_HOME);
          return;
        }
        // 新規ゲスト: 氏名確認へ
        setName(data.displayName || "");
        setPhase("confirm");
      } catch (e) {
        console.error("[guest] error:", e);
        if (alive) {
          setPhase("error");
          setErrorMsg("エラーが発生しました。ページを再読み込みしてください。");
        }
      }
    })();
    return () => {
      alive = false;
    };
    // statusText は固定文言なので依存に含めない
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
    goGame();
  }

  // ── 氏名確認画面 ──
  if (phase === "confirm") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-6">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
          <div className="text-center mb-5">
            <div className="w-12 h-12 rounded-full bg-[#2f7d57]/10 flex items-center justify-center mx-auto mb-3">
              <span className="text-[#2f7d57] text-xl">🀄</span>
            </div>
            <h1 className="text-base font-bold text-[#1c1f21]">麻雀リーグへようこそ</h1>
            <p className="text-xs text-[#231714]/50 mt-1">順位表に表示されるお名前をご確認ください</p>
          </div>
          <label className="block text-xs font-medium text-[#231714]/60 mb-1">お名前</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2f7d57]/40"
          />
          <button
            onClick={startWithName}
            disabled={saving || !name.trim()}
            className="mt-4 w-full py-3 rounded-2xl text-sm font-bold bg-[#2f7d57] text-white disabled:opacity-40"
          >
            {saving ? "開始中…" : "この名前で始める"}
          </button>
        </div>
      </div>
    );
  }

  // ── LINE で開いてもらう案内 ──
  if (phase === "needs-line") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
        <Image src="/logo.svg" alt="EIGHT BASE" width={64} height={64} className="opacity-20 mb-5" priority />
        <p className="text-sm text-[#231714]">この招待リンクは <strong>LINEアプリ</strong> で開いてください。</p>
        <p className="text-xs text-[#231714]/50 mt-2">メールの「麻雀リーグに参加する」ボタンをLINEで開くと参加できます。</p>
      </div>
    );
  }

  // ── エラー ──
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
        <Image src="/logo.svg" alt="EIGHT BASE" width={64} height={64} className="opacity-20 mb-5" priority />
        <p className="text-sm text-[#231714]/70">{errorMsg}</p>
      </div>
    );
  }

  // ── ローディング ──
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] gap-3">
      <Spinner />
      <p className="text-sm text-gray-400">{statusText}</p>
    </div>
  );
}

export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]">
          <Spinner />
        </div>
      }
    >
      <GuestInner />
    </Suspense>
  );
}
