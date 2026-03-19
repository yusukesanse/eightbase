"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/ui/TopBar";
import { getLineUserId } from "@/lib/liff";
import type { Reservation } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

export default function MyReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    getLineUserId()
      .then((id) => {
        setLineUserId(id);
        return fetch("/api/reservations", {
          headers: { "x-line-user-id": id },
        });
      })
      .then((r) => r.json())
      .then((data) => setReservations(data.reservations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCancel(reservationId: string) {
    if (!lineUserId) return;
    if (!confirm("この予約をキャンセルしますか？")) return;

    setCancellingId(reservationId);
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: "DELETE",
        headers: { "x-line-user-id": lineUserId },
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message ?? "キャンセルに失敗しました。");
        return;
      }

      setReservations((prev) => prev.filter((r) => r.reservationId !== reservationId));
    } catch {
      alert("通信エラーが発生しました。");
    } finally {
      setCancellingId(null);
    }
  }

  const upcoming = reservations.filter(
    (r) => r.date >= dayjs().format("YYYY-MM-DD")
  );
  const past = reservations.filter(
    (r) => r.date < dayjs().format("YYYY-MM-DD")
  );

  return (
    <div>
      <TopBar title="マイ予約" subtitle="予約の確認・キャンセル" />

      <div className="p-3 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-sm text-gray-400">読み込み中...</div>
        ) : upcoming.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <p className="text-xs font-medium text-gray-400">今後の予約</p>
            {upcoming.map((r) => (
              <ReservationCard
                key={r.reservationId}
                reservation={r}
                onCancel={handleCancel}
                cancelling={cancellingId === r.reservationId}
              />
            ))}
          </>
        )}

        {past.length > 0 && (
          <>
            <p className="text-xs font-medium text-gray-400 pt-1">過去の予約</p>
            {past.map((r) => (
              <ReservationCard
                key={r.reservationId}
                reservation={r}
                onCancel={handleCancel}
                cancelling={false}
                isPast
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ReservationCard({
  reservation: r,
  onCancel,
  cancelling,
  isPast = false,
}: {
  reservation: Reservation;
  onCancel: (id: string) => void;
  cancelling: boolean;
  isPast?: boolean;
}) {
  const dateLabel = dayjs(r.date).format("M月D日（ddd）");

  // キャンセル期限（開始30分前）
  const startDt = dayjs(`${r.date}T${r.startTime}:00`);
  const canCancel = !isPast && startDt.diff(dayjs(), "minute") >= 30;

  return (
    <div className={clsx(
      "bg-white rounded-xl border p-3 flex items-center gap-3",
      isPast ? "border-gray-100 opacity-60" : "border-gray-100"
    )}>
      <div className={clsx(
        "w-2 h-2 rounded-full flex-shrink-0",
        isPast ? "bg-gray-300" : "bg-[#06C755]"
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{r.facilityName}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {dateLabel}　{r.startTime}〜{r.endTime}
        </p>
      </div>
      {canCancel && (
        <button
          onClick={() => onCancel(r.reservationId)}
          disabled={cancelling}
          className="text-[11px] text-red-500 border border-red-200 rounded-lg px-2.5 py-1.5 flex-shrink-0 disabled:opacity-50"
        >
          {cancelling ? "処理中..." : "キャンセル"}
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="17" rx="3" stroke="#9CA3AF" strokeWidth="1.5"/>
          <path d="M8 3v2M16 3v2M3 9h18" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M8 13h4M8 17h6" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <p className="text-sm text-gray-400">予約はありません</p>
      <p className="text-xs text-gray-300 mt-1">施設予約から予約を作成できます</p>
    </div>
  );
}
