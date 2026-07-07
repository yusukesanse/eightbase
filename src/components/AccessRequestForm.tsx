"use client";

import { useState } from "react";
import Image from "next/image";
import { getAuthAccessToken } from "@/lib/liff";

/**
 * 未登録ユーザーの利用申請フォーム（氏名・メール・会社名）。
 * 送信すると管理者に通知され、承認されるとメールにワンタイムパスワードが届く。
 * （この時点ではメールを送らない＝管理者の承認が前提）
 */
export default function AccessRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [userType, setUserType] = useState<"member" | "guest">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const canSubmit = name.trim() && email.trim() && company.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const accessToken = await getAuthAccessToken();
      if (!accessToken) {
        setError("LINE認証が取得できませんでした。アプリを開き直してください。");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/auth/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accessToken,
          displayName: name.trim(),
          email: email.trim(),
          companyName: company.trim(),
          requestedRole: userType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.alreadyRegistered) {
        // 既に登録済み → ホームへ
        window.location.replace("/");
        return;
      }
      if (!res.ok) {
        setError(data?.error || "申請の送信に失敗しました。");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-[#EAF7C9] flex items-center justify-center mb-4">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6f9023" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h1 className="text-base font-bold text-[#1c1f21]">申請を受け付けました</h1>
        <p className="text-xs text-[#231714]/60 mt-2 leading-relaxed">
          管理者が承認すると、ご入力のメールアドレスに<br />
          ワンタイムパスワードが届きます。<br />
          届いたら「ログイン」からコードを入力してください。
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF9F6] px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <Image src="/logo.svg" alt="EIGHT BASE" width={64} height={64} priority className="opacity-80 mb-3" />
          <h1 className="text-base font-bold text-[#1c1f21]">利用申請</h1>
          <p className="text-xs text-[#231714]/55 mt-1 text-center">
            はじめての方は、以下をご入力ください。<br />管理者の承認後にご利用いただけます。
          </p>
        </div>

        <div className="space-y-3">
          <Field label="お名前">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-[#A5C1C8]"
            />
          </Field>
          <Field label="メールアドレス">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-[#A5C1C8]"
            />
          </Field>
          <Field label="ご利用形態">
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "member", label: "オフィス契約者" },
                { key: "guest", label: "ゲスト" },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setUserType(opt.key)}
                  className={`rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
                    userType === opt.key
                      ? "border-[#231714] bg-[#231714] text-white"
                      : "border-gray-200 bg-white text-[#231714]/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="会社名">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="エイトデザイン株式会社"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-[#A5C1C8]"
            />
          </Field>
        </div>

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-5 w-full py-3.5 rounded-2xl text-sm font-bold bg-[#231714] text-white disabled:opacity-40 active:scale-[0.99] transition-transform"
        >
          {submitting ? "送信中..." : "申請する"}
        </button>

        <p className="text-[11px] text-[#231714]/40 mt-4 text-center">
          既にワンタイムパスワードをお持ちの方は{" "}
          <a href="/login" className="underline text-[#231714]/60">ログイン</a>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-[#231714]/60 mb-1">{label}</span>
      {children}
    </label>
  );
}
