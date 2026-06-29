"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface CompletedReservation {
  facilityName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}

function Spinner() {
  return (
    <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
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
    <div className="min-h-screen bg-[#FAF9F6] flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
        {state === "loading" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Spinner />
            <p className="text-sm text-[#231714]/60">決済を確認しています…</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
              <span className="text-red-500 text-2xl">!</span>
            </div>
            <p className="text-sm text-[#231714]/70">{errorMsg}</p>
            <Link
              href="/my-reservations"
              className="mt-2 w-full py-3 rounded-2xl text-sm font-bold bg-[#A5C1C8] text-white text-center"
            >
              マイ予約を確認
            </Link>
          </div>
        )}

        {state === "done" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-12 h-12 rounded-full bg-[#EAF7C9] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6f9023" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              <h1 className="text-base font-bold text-[#1c1f21]">決済・予約が完了しました</h1>
            </div>

            {reservation && (
              <div className="rounded-2xl bg-[#f6f8f9] p-4 text-sm text-[#231714]/80 space-y-1">
                <div className="font-bold text-[#1c1f21]">{reservation.facilityName}</div>
                <div>
                  {reservation.date} {reservation.startTime}〜{reservation.endTime}
                </div>
              </div>
            )}

            {/* 解錠コード */}
            {passcode ? (
              <div className="rounded-2xl border-2 border-[#2f7d57] p-4 text-center">
                <div className="text-[11px] font-extrabold text-[#2f7d57] tracking-wide">解錠コード</div>
                <div className="text-[34px] font-black tabular-nums text-[#1c1f21] tracking-[0.15em] my-1">
                  {passcode}
                </div>
                <div className="text-[11px] text-[#231714]/50">
                  予約時間中のみ有効です。終了後は無効になります。
                </div>
              </div>
            ) : passcodePending ? (
              <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-center">
                <p className="text-xs text-amber-700">
                  解錠コードを発行中です。少し時間をおいて「マイ予約」をご確認ください。<br />
                  表示されない場合は管理者にお問い合わせください。
                </p>
              </div>
            ) : null}

            <Link
              href="/my-reservations"
              className="w-full py-3 rounded-2xl text-sm font-bold bg-[#A5C1C8] text-white text-center"
            >
              マイ予約を確認
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReservationCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]">
          <Spinner />
        </div>
      }
    >
      <CompleteInner />
    </Suspense>
  );
}
