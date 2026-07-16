"use client";

import { useEffect, useState } from "react";
import type { UserRole } from "@/lib/roles";

/**
 * 管理者「メッセージ送信」画面。
 * 本文（＋任意リンク1つ）を作成し、宛先 role（オフィス契約者/エイト社員/ゲスト）を選択して
 * 指定 role の登録ユーザーのみへ LINE 配信する。登録ユーザー以外の第三者には届かない。
 */

const ROLE_OPTIONS: { role: UserRole; label: string; desc: string }[] = [
  { role: "member", label: "オフィス契約者", desc: "会員（全機能）" },
  { role: "staff", label: "エイト社員", desc: "社員" },
  { role: "guest", label: "ゲスト", desc: "ゲーム機能のみ" },
];

const MAX_TEXT = 5000;

export default function AdminMessagesPage() {
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [roles, setRoles] = useState<Set<UserRole>>(new Set());
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleList = ROLE_OPTIONS.filter((o) => roles.has(o.role)).map((o) => o.role);

  // 宛先が変わるたびに対象人数を取得（送信前の確認用）。
  useEffect(() => {
    if (roleList.length === 0) {
      setCount(null);
      return;
    }
    let alive = true;
    setCountLoading(true);
    fetch(`/api/admin/messages?roles=${roleList.join(",")}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setCount(typeof d.count === "number" ? d.count : null);
      })
      .catch(() => {
        if (alive) setCount(null);
      })
      .finally(() => {
        if (alive) setCountLoading(false);
      });
    return () => {
      alive = false;
    };
    // roleList はレンダーごとに新配列なので join した文字列を依存に使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleList.join(",")]);

  function toggleRole(role: UserRole) {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function openConfirm() {
    setError(null);
    setResult(null);
    if (!text.trim()) return setError("本文を入力してください");
    if (roleList.length === 0) return setError("宛先を1つ以上選択してください");
    if (linkUrl.trim() && !/^https?:\/\//.test(linkUrl.trim())) {
      return setError("リンクは http(s) のURLで入力してください");
    }
    setConfirming(true);
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text: text.trim(), linkUrl: linkUrl.trim() || undefined, roles: roleList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "送信に失敗しました");
      } else {
        setResult(`${data.sent ?? 0}名へ送信しました`);
        setText("");
        setLinkUrl("");
        setRoles(new Set());
      }
    } catch {
      setError("送信に失敗しました");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <h1 className="text-xl font-bold text-[#231714] mb-1">メッセージ送信</h1>
      <p className="text-sm text-[#231714]/50 mb-6">
        LINE公式アカウントから、選んだ区分の登録ユーザーのみへメッセージを送信します。
        登録ユーザー以外の第三者には届きません。
      </p>

      {result && (
        <div className="mb-4 rounded-xl bg-[#eef6f0] border border-[#cfe6d8] px-4 py-3 text-sm font-bold text-[#2f7d57]">
          {result}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl bg-[#fdece8] border border-[#f4c9bd] px-4 py-3 text-sm font-bold text-[#d8533a]">
          {error}
        </div>
      )}

      {/* 本文 */}
      <label className="block text-sm font-bold text-[#231714] mb-1.5">本文</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_TEXT}
        rows={6}
        placeholder="送信するメッセージを入力"
        className="w-full px-3 py-2.5 text-sm border border-[#231714]/15 rounded-lg resize-y focus:outline-none focus:border-[#231714]"
      />
      <div className="text-right text-[11px] text-[#231714]/40 mt-1">{text.length} / {MAX_TEXT}</div>

      {/* リンク（任意） */}
      <label className="block text-sm font-bold text-[#231714] mb-1.5 mt-3">リンク（任意）</label>
      <input
        type="url"
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
        placeholder="https://…（入力するとボタンが付きます）"
        className="w-full px-3 py-2.5 text-sm border border-[#231714]/15 rounded-lg focus:outline-none focus:border-[#231714]"
      />

      {/* 宛先 */}
      <label className="block text-sm font-bold text-[#231714] mb-1.5 mt-5">宛先（区分・複数選択可）</label>
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLE_OPTIONS.map((o) => {
          const on = roles.has(o.role);
          return (
            <button
              key={o.role}
              type="button"
              onClick={() => toggleRole(o.role)}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                on ? "border-[#231714] bg-[#231714] text-white" : "border-[#231714]/15 bg-white text-[#231714]/70 hover:bg-gray-50"
              }`}
            >
              <div className="text-sm font-bold">{o.label}</div>
              <div className={`text-[11px] ${on ? "text-white/60" : "text-[#231714]/40"}`}>{o.desc}</div>
            </button>
          );
        })}
      </div>

      {/* 対象人数 */}
      <div className="mt-3 text-sm text-[#231714]/60">
        送信対象:{" "}
        <span className="font-bold text-[#231714]">
          {roleList.length === 0 ? "—" : countLoading ? "…" : count != null ? `${count}名` : "取得失敗"}
        </span>
      </div>

      <button
        type="button"
        onClick={openConfirm}
        disabled={sending}
        className="mt-5 px-6 py-2.5 text-sm font-bold text-white bg-[#231714] rounded-lg hover:bg-[#231714]/85 disabled:opacity-50"
      >
        送信する
      </button>

      {/* 確認ダイアログ */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setConfirming(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-[#231714] mb-2">送信の確認</h3>
            <p className="text-sm text-[#231714]/70 mb-1">
              宛先: <b>{ROLE_OPTIONS.filter((o) => roles.has(o.role)).map((o) => o.label).join(" / ")}</b>
            </p>
            <p className="text-sm text-[#231714]/70 mb-3">
              対象: <b>{count != null ? `${count}名` : "—"}</b>
            </p>
            <div className="rounded-lg bg-gray-50 border border-[#231714]/10 px-3 py-2 text-xs text-[#231714]/70 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {text.trim()}
              {linkUrl.trim() && <div className="mt-1 text-[#1172a5]">🔗 {linkUrl.trim()}</div>}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="flex-1 py-2.5 text-sm font-medium text-[#231714]/60 border border-[#231714]/15 rounded-xl hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={send}
                disabled={sending || count === 0}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-[#231714] rounded-xl hover:bg-[#231714]/85 disabled:opacity-50"
              >
                {sending ? "送信中…" : `送信（${count ?? 0}名）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
