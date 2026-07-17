"use client";

import { useState } from "react";
import type { User } from "./types";

/** ワンタイムパスワード再発行モーダル（既存招待の再送 / 旧ユーザーは新規作成） */
export function ReissuePasscodeModal({
  user,
  onClose,
  onReissued,
}: {
  user: User;
  onClose: () => void;
  onReissued: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleReissue() {
    setError(null);
    setLoading(true);
    try {
      if (user.invitationId) {
        const res = await fetch("/api/admin/invitations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: user.invitationId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPasscode(data.passcode ?? null);
        setEmailSent(data.emailSent ?? false);
      } else {
        // invitationId がない旧ユーザー → 新規招待作成（emailが必要）
        if (!user.email) {
          throw new Error("メールアドレスが未登録のため再発行できません");
        }
        const res = await fetch("/api/admin/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ displayName: user.displayName, email: user.email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPasscode(data.passcode ?? null);
        setEmailSent(data.emailSent ?? false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "再発行に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        {(emailSent || passcode) ? (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">
              {emailSent ? "招待メールを再送しました" : "パスワードを再発行しました"}
            </h3>
            <p className="text-xs text-[#231714]/85 mb-4">
              {emailSent
                ? `${user.email} 宛にパスワードをメール送信しました`
                : `${user.displayName} さんに新しいパスワードを伝えてください`}
            </p>
            {!emailSent && user.email && (
              <p className="text-xs text-orange-500 mb-2">※ メール送信に失敗しました。手動でパスワードをお伝えください。</p>
            )}
            {passcode && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
                <p className="text-2xl font-bold font-mono tracking-[0.2em] text-[#231714]">{passcode}</p>
              </div>
            )}
            <div className="flex gap-2">
              {passcode && (
                <button
                  onClick={async () => { await navigator.clipboard.writeText(passcode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex-1 py-2.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors"
                >
                  {copied ? "コピーしました" : "コピー"}
                </button>
              )}
              <button
                onClick={() => onReissued(`${user.displayName} さん${emailSent ? "に招待メールを再送" : "のパスワードを再発行"}しました`)}
                className={`${passcode ? "px-4" : "flex-1"} py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/80 hover:bg-[#231714]/5 transition-colors`}
              >
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-[#231714] mb-1">パスワードを再発行</h3>
            <p className="text-sm text-[#231714]/80 mb-4">{user.displayName} さんのワンタイムパスワードを再発行します。以前のパスワードは無効になります。</p>
            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/80 hover:bg-[#231714]/5">
                キャンセル
              </button>
              <button onClick={handleReissue} disabled={loading} className="flex-1 py-2.5 text-sm bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50">
                {loading ? "再発行中..." : "再発行する"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
