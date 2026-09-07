"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { GlassCard, PageBg } from "@/components/ui/eb";

interface CompletedReservation {
  facilityName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
  );
}

function CompleteInner() {
  const params = useSearchParams();
  // 予約専用リンクの redirect_url に埋め込んだ予約ID（rid）。決済の照合はサーバー側で予約に
  // 保存済みの注文IDを使って行う（Square はリダイレクトに識別子を付与しないため）。
  const rid = params.get("rid") || "";

  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [reservation, setReservation] = useState<CompletedReservation | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [passcodePending, setPasscodePending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!rid) {
      setState("error");
      setErrorMsg("決済情報が取得できませんでした。「マイ予約」をご確認ください。");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/reservations/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ rid }),
        });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setState("error");
          setErrorMsg(data.message || "予約の確定に失敗しました。");
          return;
        }
        setReservation(data.reservation ?? null);
        setPasscode(data.passcode ?? null);
        setPasscodePending(!!data.passcodePending);
        setState("done");
      } catch {
        if (alive) {
          setState("error");
          setErrorMsg("通信エラーが発生しました。");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [rid]);

  return (
    <PageBg className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        {state === "loading" && (
          <GlassCard className="flex flex-col items-center gap-4 py-10">
            <Spinner />
            <p className="text-[15px] text-[color:var(--eb-ink-muted)]">決済を確認しています…</p>
          </GlassCard>
        )}

        {state === "error" && (
          <GlassCard tone="coral" className="flex flex-col items-center gap-4 py-6 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 48, height: 48, background: "rgba(217,72,58,.14)" }}
            >
              <span className="text-[22px] font-bold text-[color:var(--eb-coral-text)]">!</span>
            </div>
            <p className="text-[15px] text-[color:var(--eb-ink)]">{errorMsg}</p>
            <Link
              href="/my-reservations"
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-[color:var(--eb-green)] text-[17px] font-bold text-white"
            >
              マイ予約を見る
            </Link>
          </GlassCard>
        )}

        {state === "done" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <div
                className="flex items-center justify-center rounded-full"
                style={{ width: 64, height: 64, background: "rgba(35,147,94,.14)" }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              <h1 className="text-[22px] font-bold text-[color:var(--eb-ink)]">予約が完了しました</h1>
            </div>

            {reservation && (
              <GlassCard padding="md">
                <div className="space-y-1">
                  <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">{reservation.facilityName}</div>
                  <div className="text-[15px] text-[color:var(--eb-ink-muted)]">
                    {reservation.date} {reservation.startTime}〜{reservation.endTime}
                  </div>
                </div>
              </GlassCard>
            )}

            {/* 解錠コード */}
            {passcode ? (
              <div className="rounded-2xl p-4 text-center" style={{ background: "var(--eb-tint)" }}>
                <div className="text-[12px] font-bold tracking-wide text-[color:var(--eb-green-text)]">解錠コード</div>
                <div className="my-1 text-[26px] font-black tabular-nums tracking-[0.15em] text-[color:var(--eb-ink)]">
                  {passcode}
                </div>
                <div className="space-y-0.5 text-[12px] text-[color:var(--eb-ink-muted)]">
                  <p>
                    予約開始時刻になると、このコードでドアを解錠できます
                    {reservation?.startTime ? `（${reservation.startTime}〜${reservation.endTime}のみ有効）` : "（予約時間中のみ有効）"}。
                  </p>
                  <p>コードは「マイ予約」からいつでも確認できます。</p>
                </div>
              </div>
            ) : passcodePending ? (
              <GlassCard tone="gold" padding="md" className="text-center">
                <p className="text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
                  解錠コードは準備が整い次第、<b>管理者からご連絡</b>します。<br />
                  発行後は「マイ予約」にも表示されます。お急ぎの場合は管理者へお問い合わせください。
                </p>
              </GlassCard>
            ) : null}

            <Link
              href="/my-reservations"
              className="flex h-14 w-full items-center justify-center rounded-2xl border-2 border-[color:var(--eb-green)] bg-white/60 text-[17px] font-bold text-[color:var(--eb-green)]"
            >
              マイ予約を見る
            </Link>
          </div>
        )}
      </div>
    </PageBg>
  );
}

export default function ReservationCompletePage() {
  return (
    <Suspense
      fallback={
        <PageBg className="flex min-h-screen items-center justify-center">
          <Spinner />
        </PageBg>
      }
    >
      <CompleteInner />
    </Suspense>
  );
}
