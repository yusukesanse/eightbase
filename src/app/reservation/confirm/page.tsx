"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import type { Facility } from "@/types";
import { getLineProfile } from "@/lib/liff";

import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

type Step = "confirm" | "loading" | "done" | "error";

function ConfirmContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facilityId") ?? "";
  const date       = params.get("date") ?? "";
  const startTime  = params.get("startTime") ?? "";
  const endTime    = params.get("endTime") ?? "";

  const [facility, setFacility] = useState<Facility | null>(null);
  const dateLabel = dayjs(date).format("M月D日（ddd）");

  const [step, setStep] = useState<Step>("confirm");
  const [displayName, setDisplayName] = useState<string>("");
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [profileLoaded, setProfileLoaded] = useState(false);

  // 施設情報を取得
  useEffect(() => {
    if (!facilityId) return;
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((data) => {
        const found = (data.facilities as Facility[])?.find((f) => f.id === facilityId);
        setFacility(found ?? null);
      })
      .catch(() => {});
  }, [facilityId]);

  useEffect(() => {
    // LINE プロフィールは表示名取得のみ使用（認証はセッションCookieで行う）
    getLineProfile()
      .then((p) => {
        setDisplayName(p.displayName);
      })
      .catch(() => {
        // LIFF 環境外では表示名を空のままにする（サーバー側でFirestoreから取得）
        setDisplayName("");
      })
      .finally(() => setProfileLoaded(true));
  }, []);

  async function handleReserve() {
    setStep("loading");

    try {
      // Cookie は自動送信されるため、x-line-user-id ヘッダーは不要
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ facilityId, date, startTime, endTime, displayName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message ?? "予約に失敗しました。もう一度お試しください。");
        setStep("error");
        return;
      }

      setReservationId(data.reservationId);
      setStep("done");
    } catch {
      setErrorMsg("通信エラーが発生しました。");
      setStep("error");
    }
  }

  if (step === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-2 border-[#8BB5BF] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">予約処理中...</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div>
        {/* 完了ヘッダー */}
        <div className="bg-[#8BB5BF] px-4 py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M4 13l6 6L22 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-white font-medium text-base mb-1">予約が完了しました</p>
          <p className="text-white/80 text-xs">
            {facility?.name} — {dateLabel} {startTime}〜{endTime}
          </p>
        </div>

        <div className="p-3 space-y-3">
          {/* 通知済みバッジ */}
          <div className="bg-[#B0E401]/10 border border-[#B0E401]/20 rounded-xl p-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
              <path d="M8 2C5.24 2 3 4.02 3 6.5c0 1.7.97 3.18 2.4 4.02L4.5 13l2.5-1.2c.33.07.66.1 1 .1 2.76 0 5-2.02 5-4.5S10.76 2 8 2z" fill="#8BB5BF"/>
            </svg>
            <p className="text-xs text-[#7BA801]">LINE にて予約完了通知を送信しました</p>
          </div>

          {/* 予約詳細 */}
          <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2.5">
            <DetailRow label="施設" value={facility?.name ?? ""} />
            <DetailRow label="日付" value={dateLabel} />
            <DetailRow label="時間" value={`${startTime} 〜 ${endTime}`} />
            <DetailRow label="予約者" value={displayName} />
          </div>

          {/* アクションボタン */}
          <button
            onClick={() => router.push("/my-reservations")}
            className="w-full py-3 rounded-xl text-sm font-medium bg-[#B0E401] text-[#231714]"
          >
            マイ予約を確認する
          </button>
          <button
            onClick={() => router.push("/reservation")}
            className="w-full py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-600"
          >
            続けて予約する
          </button>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="p-4 space-y-3">
        <TopBar title="予約エラー" />
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-sm text-red-600 mb-1 font-medium">予約できませんでした</p>
          <p className="text-xs text-red-400">{errorMsg}</p>
        </div>
        <button
          onClick={() => router.back()}
          className="w-full py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-600"
        >
          戻って選び直す
        </button>
      </div>
    );
  }

  // confirm ステップ
  return (
    <div>
      <TopBar title="EIGHT BASE UNGA 施設予約" subtitle="予約内容の確認" />

      <div className="p-3 space-y-3">
        <StepIndicator step={2} total={2} />

        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <p className="text-xs font-medium text-gray-400 mb-1">予約内容</p>
          <DetailRow label="施設" value={facility?.name ?? ""} />
          <DetailRow label="日付" value={dateLabel} />
          <DetailRow label="時間" value={`${startTime} 〜 ${endTime}`} />
          <DetailRow label="予約者" value={displayName || "読み込み中..."} />
        </div>

        <p className="text-xs text-gray-400 text-center">
          予約確定後はLINEにて通知が届きます
        </p>

        <button
          onClick={handleReserve}
          disabled={!profileLoaded}
          className={clsx(
            "w-full py-3 rounded-xl text-sm font-medium transition-colors",
            profileLoaded
              ? "bg-[#B0E401] text-[#231714]"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          )}
        >
          予約を確定する
        </button>
        <button
          onClick={() => router.back()}
          className="w-full py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-600"
        >
          戻る
        </button>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-sm text-gray-400">読み込み中...</div>}>
      <ConfirmContent />
    </Suspense>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center my-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={clsx(
            "h-1 w-5 rounded-full",
            i < step ? "bg-[#8BB5BF]" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
