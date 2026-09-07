"use client";

import { useState } from "react";
import Image from "next/image";
import { getAuthAccessToken } from "@/lib/liff";
import { Button, Field, GlassCard, PageBg, inputClass } from "@/components/ui/eb";

/**
 * 未登録ユーザーの利用申請フォーム（氏名・メール・会社名）。
 * 送信すると管理者に通知され、承認されるとメールに招待URLのボタンが届く。
 * （この時点ではメールを送らない＝管理者の承認が前提）
 */
/** 社員（staff）申請時に自動で入る会社名。入力欄は出さない。 */
const STAFF_COMPANY_NAME = "エイトデザイン株式会社";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserType = "member" | "staff" | "guest";

/** ご利用形態の選択カード（見出し＋副題の2行）。 */
const USER_TYPES: { key: UserType; label: string; note: string }[] = [
  { key: "member", label: "オフィス契約者", note: "入居している" },
  { key: "staff", label: "社員", note: "エイトデザイン" },
  { key: "guest", label: "ゲスト", note: "麻雀リーグのみ" },
];

export interface AccessRequestInitialValues {
  displayName?: string;
  email?: string;
  requestedRole?: UserType;
}

export default function AccessRequestForm({
  initialValues,
}: {
  /** 「メールアドレスを直す」から開いたときの初期値（申請中の内容を上書き送信する）。 */
  initialValues?: AccessRequestInitialValues;
} = {}) {
  const [name, setName] = useState(initialValues?.displayName ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [company, setCompany] = useState("");
  const [userType, setUserType] = useState<UserType>(initialValues?.requestedRole ?? "member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; company?: string }>({});
  const [done, setDone] = useState(false);

  // 社員は会社名を固定するので入力欄を出さない。ゲストは会社に属さない人もいるので任意。
  const isStaff = userType === "staff";
  const isGuest = userType === "guest";
  const companyName = isStaff ? STAFF_COMPANY_NAME : company.trim();

  /** 入力チェック。問題があれば該当 Field に文言を出して false を返す。 */
  const validate = (): boolean => {
    const next: { name?: string; email?: string; company?: string } = {};
    if (!name.trim()) next.name = "お名前を入力してください。";
    if (!email.trim()) next.email = "メールアドレスを入力してください。";
    else if (!EMAIL_REGEX.test(email.trim())) next.email = "メールアドレスの形式が正しくありません。";
    if (!isStaff && !isGuest && !companyName) next.company = "会社名を入力してください。";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (submitting) return;
    setError("");
    if (!validate()) return;
    setSubmitting(true);
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
          companyName,
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
    // 承認後は**全ロールとも招待URL（メールのボタン）**が届く（src/lib/invitations.ts）。
    // ワンタイムパスワード方式は廃止したので、コード入力の案内は出さない。
    return (
      <PageBg className="flex items-center justify-center px-5">
        <div className="w-full max-w-sm">
          <GlassCard>
            <div className="text-center">
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                style={{ background: "rgba(35,147,94,.14)" }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">申請を受け付けました</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
                管理者が確認したあと、ご入力のメールアドレスにご案内メールが届きます。メールの中のボタンから、そのまま始められます。
              </p>
              <p className="mt-3 text-[13px] text-[color:var(--eb-ink-muted)]">
                ボタンは LINE で開いてください。
              </p>
            </div>
          </GlassCard>
        </div>
      </PageBg>
    );
  }

  return (
    <PageBg className="px-5 pt-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/logo.svg" alt="EIGHT BASE" width={64} height={64} priority className="mb-3" />
          <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">利用申請</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            はじめての方は、以下を入力してください。管理者が確認したあと、メールでご案内します。
          </p>
        </div>

        <div className="space-y-5">
          <Field label="お名前" required error={fieldErrors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className={inputClass}
            />
          </Field>

          <Field label="メールアドレス" required error={fieldErrors.email}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              className={inputClass}
            />
          </Field>

          <Field label="ご利用形態" required>
            <div className="space-y-2">
              {USER_TYPES.map((opt) => {
                const selected = userType === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setUserType(opt.key)}
                    className="flex h-16 w-full flex-col justify-center rounded-2xl px-4 text-left transition-colors"
                    style={
                      selected
                        ? {
                            background: "var(--eb-green)",
                            border: "2px solid var(--eb-green)",
                            color: "#fff",
                          }
                        : {
                            background: "rgba(255,255,255,.6)",
                            border: "1px solid var(--eb-line)",
                            color: "var(--eb-ink)",
                          }
                    }
                  >
                    <span className="text-[14px] font-bold leading-tight">{opt.label}</span>
                    <span
                      className="mt-0.5 text-[11px] leading-tight"
                      style={{ color: selected ? "rgba(255,255,255,.85)" : "var(--eb-ink-muted)" }}
                    >
                      {opt.note}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* 社員は会社名が自明なので入力欄を出さず、STAFF_COMPANY_NAME を送る。 */}
          {isStaff ? (
            <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              会社名は「{STAFF_COMPANY_NAME}」で申請します。
            </p>
          ) : (
            <Field
              label={isGuest ? "会社名（任意）" : "会社名"}
              required={!isGuest}
              error={fieldErrors.company}
            >
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="エイトデザイン株式会社"
                className={inputClass}
              />
            </Field>
          )}
        </div>

        {error && (
          <p className="mt-4 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>
        )}

        <Button variant="ink" className="mt-6" loading={submitting} onClick={submit}>
          申請する
        </Button>
      </div>
    </PageBg>
  );
}
