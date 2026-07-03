"use client";

import { useState } from "react";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

/** ユーザー招待モーダル（会員=OTP / ゲスト・エイト社員=ワンタイムURL） */
export function InviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  // ゲスト/エイト社員は「ワンタイムURL」方式（会員は OTP）
  const usesUrl = role === "guest" || role === "staff";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName: name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが発生しました");
      setPasscode(data.passcode ?? null);
      setGuestUrl(data.guestUrl ?? null);
      setEmailSent(data.emailSent ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function copyPasscode() {
    const value = passcode ?? guestUrl;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 完了画面（emailSent=true or 手動共有用の passcode/guestUrl 取得済み）
  const showResult = emailSent || passcode || guestUrl;
  const fallbackValue = passcode ?? guestUrl; // メール失敗時に手動共有する値

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {showResult ? (
          <>
            <div className="text-center mb-4">
              <div className={`w-12 h-12 rounded-full ${emailSent ? "bg-[#B0E401]/20" : "bg-orange-100"} flex items-center justify-center mx-auto mb-3`}>
                {emailSent ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M6 12l4 4 8-8" stroke="#B0E401" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v4M12 17h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#F59E0B" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <h3 className="text-base font-semibold text-[#231714]">
                {emailSent
                  ? usesUrl ? `${ROLE_LABELS[role]}招待メールを送信しました` : "招待メールを送信しました"
                  : usesUrl ? "招待URLを発行しました" : "ワンタイムパスワードを発行しました"}
              </h3>
              <p className="text-xs text-[#231714]/50 mt-1">
                {emailSent
                  ? usesUrl
                    ? `${email} 宛に参加用URLをメール送信しました（有効期限: 2日間）`
                    : `${email} 宛にパスワードをメール送信しました（有効期限: 7日間）`
                  : usesUrl
                    ? `${name} さんにこのURLをLINEで開いてもらってください（有効期限: 2日間）`
                    : `${name} さんにこのパスワードを伝えてください（有効期限: 7日間）`}
              </p>
              {!emailSent && (
                <p className="text-xs text-orange-500 mt-1">
                  ※ メール送信に失敗しました。手動で{usesUrl ? "URL" : "パスワード"}をお伝えください。
                </p>
              )}
            </div>

            {/* メール送信失敗時のみ手動共有用の値（member=パスコード / guest=URL）を表示 */}
            {fallbackValue && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
                {usesUrl ? (
                  <p className="text-xs font-mono text-[#231714] break-all">{fallbackValue}</p>
                ) : (
                  <p className="text-2xl font-bold font-mono tracking-[0.2em] text-[#231714]">{fallbackValue}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {fallbackValue && (
                <button
                  onClick={copyPasscode}
                  className="flex-1 py-2.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors"
                >
                  {copied ? "コピーしました" : "コピー"}
                </button>
              )}
              <button
                onClick={() => onCreated(`${name} さん${usesUrl ? `に${ROLE_LABELS[role]}招待` : emailSent ? "に招待メール" : "のワンタイムパスワード"}${emailSent ? "を送信" : "を発行"}しました`)}
                className={`${fallbackValue ? "px-4" : "flex-1"} py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors`}
              >
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">ユーザーを招待</h3>
            <p className="text-xs text-[#231714]/50 mb-4">
              {usesUrl
                ? role === "staff"
                  ? "エイト社員はゲーム機能のみ利用でき、麻雀の参加費は不要です。メールのワンタイムURLを開くと登録されます（予約・掲示板等は不可）。"
                  : "ゲストは麻雀リーグなどのゲーム機能のみ利用できます。メールのワンタイムURLを開くと参加登録されます（予約・掲示板等は不可）。"
                : "会員は全機能を利用できます。ワンタイムパスワードを発行し、利用者がLINEのログイン画面で入力してアカウントを作成します。"}
            </p>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">種別</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: "member", label: "会員", desc: "全機能" },
                    { v: "guest", label: "ゲスト", desc: "ゲームのみ" },
                    { v: "staff", label: "エイト社員", desc: "ゲームのみ・支払い不要" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setRole(opt.v)}
                      className={`py-2 rounded-xl text-sm border transition-colors ${
                        role === opt.v
                          ? "border-[#231714] bg-[#231714] text-white"
                          : "border-[#231714]/15 text-[#231714]/70 hover:bg-[#231714]/5"
                      }`}
                    >
                      {opt.label}
                      <span className={`block text-[10px] ${role === opt.v ? "text-white/70" : "text-[#231714]/40"}`}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">名前</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="山田 太郎"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="taro@example.com"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors">
                  キャンセル
                </button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 text-sm bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors">
                  {loading ? "発行中..." : usesUrl ? "招待URLを送信" : "パスワードを発行"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
