"use client";

/**
 * Dev ログイン（検証環境専用・LINE/LIFF 切り離し）。
 *
 * テストユーザー（lineUserId/表示名）を選び、Devトークン経由で本番同一フローを検証する。
 * - 本番では `isDevLoginEnabled()` が常に false → 無効画面を表示。
 * - ここで選んだ識別子は localStorage に保存され、`/`・`/login`・`/guest` が Devトークンとして使う。
 */

import { useEffect, useState } from "react";
import { isDevLoginEnabled } from "@/lib/env";
import {
  getStoredDevIdentity,
  setStoredDevIdentity,
  clearStoredDevIdentity,
  type DevIdentity,
} from "@/lib/devLogin";
import { clearAuthCache } from "@/components/AuthGuard";

const PRESETS: { label: string; id: DevIdentity; note: string }[] = [
  { label: "会員テスト", id: { userId: "dev-member-01", displayName: "会員テスト" }, note: "固定ID（招待して会員登録すると以後は会員）" },
  { label: "ゲストテスト", id: { userId: "dev-guest-01", displayName: "ゲストテスト" }, note: "固定ID（ゲスト招待で登録）" },
];

function randomNewUser(): DevIdentity {
  const rand = Math.random().toString(36).slice(2, 8);
  return { userId: `dev-new-${rand}`, displayName: "新規テスト" };
}

export default function DevLoginPage() {
  const enabled = isDevLoginEnabled();
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [current, setCurrent] = useState<DevIdentity | null>(null);

  useEffect(() => {
    const id = getStoredDevIdentity();
    setCurrent(id);
    if (id) {
      setUserId(id.userId);
      setDisplayName(id.displayName);
      setPictureUrl(id.pictureUrl ?? "");
    }
  }, []);

  if (!enabled) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
        <p className="text-sm font-medium text-[#231714]">Dev ログインは無効です</p>
        <p className="text-xs text-[#231714]/50 mt-1">
          この画面は検証環境（非本番・<code>NEXT_PUBLIC_DEV_LOGIN=on</code>）でのみ利用できます。
        </p>
      </div>
    );
  }

  function persist(): DevIdentity | null {
    const uid = userId.trim();
    if (!uid) return null;
    const identity: DevIdentity = {
      userId: uid,
      displayName: displayName.trim() || uid,
      pictureUrl: pictureUrl.trim(),
    };
    // ユーザー切替時は前ユーザーの表示キャッシュを破棄
    clearAuthCache();
    setStoredDevIdentity(identity);
    setCurrent(identity);
    return identity;
  }

  function applyPreset(id: DevIdentity) {
    setUserId(id.userId);
    setDisplayName(id.displayName);
    setPictureUrl(id.pictureUrl ?? "");
  }

  function go(path: string) {
    if (!persist()) return;
    window.location.href = path;
  }

  function goGuest() {
    if (!persist()) return;
    const code = guestCode.trim();
    window.location.href = code ? `/guest?code=${encodeURIComponent(code)}` : "/guest";
  }

  function reset() {
    clearAuthCache();
    clearStoredDevIdentity();
    setCurrent(null);
    setUserId("");
    setDisplayName("");
    setPictureUrl("");
  }

  const inputCls =
    "w-full px-3 py-2 text-sm border border-[#231714]/15 rounded-lg bg-white focus:outline-none focus:border-[#231714]";
  const btnPrimary =
    "w-full py-2.5 rounded-xl text-sm font-bold text-white bg-[#231714] active:scale-[0.99] transition";
  const btnSub =
    "w-full py-2.5 rounded-xl text-sm font-bold text-[#231714] bg-white border border-[#231714]/15 active:scale-[0.99] transition";

  return (
    <div className="min-h-screen bg-gray-50 px-5 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">検証環境</span>
          <h1 className="text-lg font-bold text-[#231714]">Dev ログイン</h1>
        </div>
        <p className="text-xs text-[#231714]/50 mb-5">
          LINE/LIFF を通さずにテストユーザーで顧客アプリ・登録フローを検証します。本番では無効です。
        </p>

        {current && (
          <div className="mb-4 rounded-xl bg-[#A5C1C8]/15 border border-[#A5C1C8]/40 px-4 py-3">
            <p className="text-[11px] text-[#231714]/50">現在の選択ユーザー</p>
            <p className="text-sm font-bold text-[#231714]">
              {current.displayName} <span className="font-mono text-xs text-[#231714]/50">({current.userId})</span>
            </p>
          </div>
        )}

        {/* プリセット */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => (
            <button key={p.id.userId} onClick={() => applyPreset(p.id)} title={p.note}
              className="px-3 py-1.5 text-xs font-bold rounded-full bg-white border border-[#231714]/15 text-[#231714]">
              {p.label}
            </button>
          ))}
          <button onClick={() => applyPreset(randomNewUser())} title="毎回別ID＝未登録ユーザー"
            className="px-3 py-1.5 text-xs font-bold rounded-full bg-white border border-[#231714]/15 text-[#231714]">
            新規ユーザー生成
          </button>
        </div>

        {/* 入力 */}
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-[11px] font-bold text-[#231714]/60 mb-1">lineUserId（疑似）</label>
            <input className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="dev-member-01" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#231714]/60 mb-1">表示名</label>
            <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="会員テスト" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#231714]/60 mb-1">画像URL（任意）</label>
            <input className={inputCls} value={pictureUrl} onChange={(e) => setPictureUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        {/* 導線 */}
        <div className="space-y-2.5">
          <button className={btnPrimary} onClick={() => go("/")}>
            顧客アプリを開く（登録済みユーザーで閲覧）
          </button>
          <button className={btnSub} onClick={() => go("/login")}>
            会員登録／ログイン（OTP入力へ）
          </button>
          <div className="rounded-xl border border-[#231714]/10 p-3 space-y-2">
            <label className="block text-[11px] font-bold text-[#231714]/60">ゲスト招待コード</label>
            <input className={inputCls} value={guestCode} onChange={(e) => setGuestCode(e.target.value)} placeholder="招待メールの code" />
            <button className={btnSub} onClick={goGuest}>ゲスト招待を試す（/guest へ）</button>
          </div>
          <button className="w-full py-2 text-xs font-bold text-[#231714]/50" onClick={reset}>
            選択ユーザーをクリア（ログアウト相当）
          </button>
        </div>
      </div>
    </div>
  );
}
