"use client";

/**
 * Dev ログイン（検証環境専用・LINE/LIFF 切り離し）。
 *
 * ボタン1つで「会員 / ゲスト / 新規」のテストユーザーとして即アプリに入る。
 * サーバー(`/api/dev/quick-login`)が authorizedUsers を upsert して実 `__session` を張るため、
 * 選んだユーザーは **管理者アプリの顧客一覧にも表示**される。
 * - 本番では `isDevLoginEnabled()` が常に false → 無効画面。
 */

import { useState } from "react";
import { isDevLoginEnabled } from "@/lib/env";
import { setStoredDevIdentity, clearStoredDevIdentity } from "@/lib/devLogin";
import { clearAuthCache } from "@/components/AuthGuard";

export default function DevLoginPage() {
  const enabled = isDevLoginEnabled();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestCode, setGuestCode] = useState("");
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  if (!enabled) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
        <p className="text-sm font-medium text-[#231714]">Dev ログインは無効です</p>
        <p className="text-xs text-[#231714]/50 mt-1">
          検証環境（非本番・<code>NEXT_PUBLIC_DEV_LOGIN=on</code>）でのみ利用できます。
        </p>
      </div>
    );
  }

  async function quickLogin(role: "member" | "guest" | "staff" | "new") {
    setBusy(role);
    setError(null);
    try {
      // 前ユーザーの表示キャッシュ・Dev識別子を破棄してから切替
      clearAuthCache();
      clearStoredDevIdentity();
      const res = await fetch("/api/dev/quick-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "ログインに失敗しました");
        setBusy(null);
        return;
      }
      // フルリロードで遷移（AuthGuard を新セッションで再評価）
      window.location.href = data.home || "/";
    } catch {
      setError("通信エラーが発生しました");
      setBusy(null);
    }
  }

  // 管理者が発行した実ゲスト招待コードで redeem を試す（新規ゲスト identity で /guest へ）
  function tryGuestCode() {
    const code = guestCode.trim();
    if (!code) return;
    clearAuthCache();
    const rand = Math.random().toString(36).slice(2, 8);
    setStoredDevIdentity({ userId: `dev-invite-${rand}`, displayName: "招待ゲスト" });
    window.location.href = `/guest?code=${encodeURIComponent(code)}`;
  }

  async function seedGameData() {
    setBusy("seed");
    setSeedMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/dev/seed", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "投入に失敗しました");
      } else {
        const s = data.summary || {};
        setSeedMsg(`投入しました（卓${s.tables ?? 0}・参加${s.entries ?? 0}・CS${s.csEvents ?? 0}・選手${s.players ?? 0}）。ログイン後にリーグ/CS画面で確認できます。`);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  }

  function logout() {
    clearAuthCache();
    clearStoredDevIdentity();
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
      window.location.href = "/dev-login";
    });
  }

  const btn =
    "w-full py-3.5 rounded-2xl text-sm font-bold active:scale-[0.99] transition disabled:opacity-50";

  return (
    <div className="min-h-screen bg-gray-50 px-5 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">検証環境</span>
          <h1 className="text-lg font-bold text-[#231714]">Dev ログイン</h1>
        </div>
        <p className="text-xs text-[#231714]/50 mb-5">
          ボタンを押すとテストユーザーとしてそのままアプリに入ります（LINE不要）。選んだユーザーは管理画面の顧客一覧にも出ます。
        </p>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="space-y-3">
          <button className={`${btn} bg-[#231714] text-white`} disabled={!!busy} onClick={() => quickLogin("member")}>
            {busy === "member" ? "処理中..." : "会員としてログイン（予約・掲示板など全機能）"}
          </button>
          <button className={`${btn} bg-[#2f7d57] text-white`} disabled={!!busy} onClick={() => quickLogin("guest")}>
            {busy === "guest" ? "処理中..." : "ゲストとしてログイン（ゲームのみ）"}
          </button>
          <button className={`${btn} bg-[#1172a5] text-white`} disabled={!!busy} onClick={() => quickLogin("staff")}>
            {busy === "staff" ? "処理中..." : "エイト社員としてログイン（ゲームのみ・支払い免除）"}
          </button>
          <button className={`${btn} bg-white text-[#231714] border border-[#231714]/15`} disabled={!!busy} onClick={() => quickLogin("new")}>
            {busy === "new" ? "処理中..." : "新規登録を試す（プロフィール設定から）"}
          </button>
        </div>

        {/* 実ゲスト招待コードの検証（任意） */}
        <div className="mt-6 rounded-xl border border-[#231714]/10 p-3 space-y-2">
          <label className="block text-[11px] font-bold text-[#231714]/60">
            管理画面で発行したゲスト招待コードを試す（任意）
          </label>
          <input
            className="w-full px-3 py-2 text-sm border border-[#231714]/15 rounded-lg bg-white focus:outline-none focus:border-[#231714]"
            value={guestCode}
            onChange={(e) => setGuestCode(e.target.value)}
            placeholder="EB-XXXXXX（URLの code= の値）"
          />
          <button className={`${btn} bg-white text-[#231714] border border-[#231714]/15 !py-2.5`} onClick={tryGuestCode}>
            この招待コードで登録を試す（/guest へ）
          </button>
        </div>

        {/* 検証用ゲームデータの投入（実データ・冪等） */}
        <div className="mt-6 rounded-xl border border-[#231714]/10 p-3 space-y-2">
          <label className="block text-[11px] font-bold text-[#231714]/60">
            ゲーム確認用データ（麻雀リーグ/順位/申告/CS）を投入
          </label>
          <p className="text-[11px] text-[#231714]/40 leading-relaxed">
            demo Firestore に実データを作成します（何度押しても重複しません）。会員/ゲストで
            ログインするとリーグ画面などにデータが表示されます。
          </p>
          <button
            className={`${btn} bg-white text-[#231714] border border-[#231714]/15 !py-2.5`}
            disabled={!!busy}
            onClick={seedGameData}
          >
            {busy === "seed" ? "投入中..." : "検証用ゲームデータを投入する"}
          </button>
          {seedMsg && <p className="text-[11px] text-[#2f7d57] font-bold">{seedMsg}</p>}
        </div>

        <button className="mt-5 w-full py-2 text-xs font-bold text-[#231714]/50" onClick={logout}>
          ログアウト（セッション破棄）
        </button>
      </div>
    </div>
  );
}
