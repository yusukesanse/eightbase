"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import type { Reservation } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

export default function MyReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Cookie は自動送信されるため、ヘッダー追加不要
    fetch("/api/reservations", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setReservations(data.reservations ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[my-reservations] fetch error:", err);
          setError("予約の取得に失敗しました。ページを再読み込みしてください。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCancel(reservationId: string) {
    if (!confirm("この予約をキャンセルしますか？")) return;

    setCancellingId(reservationId);
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message ?? "キャンセルに失敗しました。");
        return;
      }

      setReservations((prev) =>
        prev.filter((r) => r.reservationId !== reservationId)
      );
    } catch {
      alert("通信エラーが発生しました。");
    } finally {
      setCancellingId(null);
    }
  }

  const today = dayjs().format("YYYY-MM-DD");
  const upcoming = reservations.filter((r) => r.date >= today);
  const past = reservations.filter((r) => r.date < today);

  return (
    <div>
      <TopBar title="マイ予約" subtitle="予約の確認・キャンセル" />

      <div className="p-3 space-y-3">
        {/* 施設予約へ戻るリンク */}
        <Link
          href="/reservation"
          className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          施設予約に戻る
        </Link>

        {loading ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-700 mt-2">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#EF4444" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-xs text-[#4f757e] underline"
            >
              再読み込み
            </button>
          </div>
        ) : upcoming.length === 0 && past.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-700">今後の予約</p>
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

            {upcoming.length === 0 && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-700 text-center">
                今後の予約はありません
              </div>
            )}

            {past.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-700 pt-1">過去の予約</p>
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

  // キャンセル期限（終了時刻まで可能）
  const endDt = dayjs(`${r.date}T${r.endTime}:00`);
  const canCancel = !isPast && dayjs().isBefore(endDt);

  // トレーラー等（決済済み）: 解錠コードと取消ラベルを出し分け
  const isTrailer = !!(r.switchBotPasscode || r.paymentTransactionId);
  const showPasscode = !isPast && !!r.switchBotPasscode;
  // 発行失敗(failed)／SwitchBot未連携(manual) は「管理者連絡待ち」を表示。
  const passcodePending =
    !isPast &&
    !r.switchBotPasscode &&
    (r.switchBotStatus === "failed" || r.switchBotStatus === "manual");

  return (
    <div
      className={clsx(
        "bg-white rounded-xl border p-3",
        isPast ? "border-gray-100 opacity-60" : "border-gray-100"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            "w-2 h-2 rounded-full flex-shrink-0",
            isPast ? "bg-gray-300" : "bg-[#A5C1C8]"
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{r.facilityName}</p>
          <p className="text-xs text-gray-700 mt-0.5">
            {dateLabel}　{r.startTime}〜{r.endTime}
          </p>
        </div>
        {canCancel && (
          <button
            onClick={() => onCancel(r.reservationId)}
            disabled={cancelling}
            className="text-[11px] text-red-500 border border-red-200 rounded-lg px-2.5 py-1.5 flex-shrink-0 disabled:opacity-50"
          >
            {cancelling ? "処理中..." : isTrailer ? "予約取消（返金）" : "キャンセル"}
          </button>
        )}
      </div>

      {showPasscode && (
        <div className="mt-3 rounded-xl border border-[#2f7d57]/40 bg-[#2f7d57]/5 px-3 py-2.5 text-center">
          <div className="text-[10px] font-extrabold text-[#2f7d57]">解錠コード</div>
          <div className="text-[22px] font-black tabular-nums tracking-[0.15em] text-[#1c1f21]">
            {r.switchBotPasscode}
          </div>
          <div className="text-[10px] text-gray-700">
            {r.startTime}〜{r.endTime} のみ有効
          </div>
        </div>
      )}
      {passcodePending && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-center">
          <p className="text-[11px] text-amber-700">
            解錠コードは準備が整い次第、管理者からご連絡します。お急ぎの場合は管理者へお問い合わせください。
          </p>
        </div>
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
      <p className="text-sm text-gray-700">予約はありません</p>
      <p className="text-xs text-gray-700 mt-1">施設予約から予約を作成できます</p>
      <Link
        href="/reservation"
        className="mt-4 inline-block text-xs text-[#4f757e] border border-[#A5C1C8] rounded-xl px-4 py-2"
      >
        施設を予約する
      </Link>
    </div>
  );
}
