"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { getFacilityById } from "@/lib/facilities";
import type { AvailabilityResponse } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// 15分単位のスロット生成 (09:00〜18:00)
function generateSlots(): string[] {
  const slots: string[] = [];
  for (let h = 9; h < 18; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

const ALL_SLOTS = generateSlots();

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

type CellState = "booked" | "free" | "sel-start" | "sel-range" | "sel-end";

function TimeslotContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facilityId") ?? "";
  const date = params.get("date") ?? "";

  const facility = getFacilityById(facilityId);
  const dateLabel = dayjs(date).format("M月D日（ddd）");

  const [bookedSlots, setBookedSlots] = useState<{ start: string; end: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [checking, setChecking] = useState(false);

  // 予約済みスロット取得
  useEffect(() => {
    if (!facilityId || !date) return;
    fetch(`/api/reservations/availability?facilityId=${facilityId}&date=${date}`)
      .then((r) => r.json())
      .then((data: AvailabilityResponse) => {
        setBookedSlots(data.bookedSlots ?? []);
      })
      .finally(() => setLoading(false));
  }, [facilityId, date]);

  function isBooked(slot: string): boolean {
    const sm = timeToMin(slot);
    return bookedSlots.some(
      (b) => sm >= timeToMin(b.start) && sm < timeToMin(b.end)
    );
  }

  function getCellState(slot: string): CellState {
    if (isBooked(slot)) return "booked";
    if (selStart) {
      if (slot === selStart) return "sel-start";
      if (selEnd && slot === selEnd) return "sel-end";
      if (
        selEnd &&
        timeToMin(slot) > timeToMin(selStart) &&
        timeToMin(slot) < timeToMin(selEnd)
      )
        return "sel-range";
    }
    return "free";
  }

  function handleCellClick(slot: string) {
    if (isBooked(slot)) return;

    if (!selStart || (selStart && selEnd)) {
      setSelStart(slot);
      setSelEnd(null);
      setAvailability(null);
      return;
    }

    if (timeToMin(slot) <= timeToMin(selStart)) {
      setSelStart(slot);
      setSelEnd(null);
      setAvailability(null);
      return;
    }

    // 範囲内の衝突チェック
    const hasConflict = bookedSlots.some((b) => {
      const bs = timeToMin(b.start);
      const be = timeToMin(b.end);
      const ss = timeToMin(selStart);
      const se = timeToMin(slot);
      return bs < se && be > ss;
    });

    if (hasConflict) {
      alert("選択範囲に予約済みの時間が含まれています。");
      return;
    }

    setSelEnd(slot);
    setAvailability(null);
  }

  const endTime = selEnd ?? null;

  async function handleCheck() {
    if (!selStart || !endTime) return;
    setChecking(true);
    try {
      const res = await fetch(
        `/api/reservations/availability?facilityId=${facilityId}&date=${date}&startTime=${selStart}&endTime=${endTime}`
      );
      const data: AvailabilityResponse = await res.json();
      setAvailability(data);
    } finally {
      setChecking(false);
    }
  }

  function handleConfirm() {
    if (!selStart || !endTime || !availability?.available) return;
    router.push(
      `/reservation/confirm?facilityId=${facilityId}&date=${date}&startTime=${selStart}&endTime=${endTime}`
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopBar
        title="EIGHT CANAL BASE 施設予約"
        subtitle={`${facility?.name ?? ""} ー ${dateLabel}`}
      />

      <div className="p-3 space-y-3 flex-1">
        {/* ステップ */}
        <StepIndicator step={3} total={4} />

        <section className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <p className="text-xs font-medium text-gray-400 px-3 pt-3 pb-2">
            開始時刻・終了時刻を順にタップ（15分単位）
          </p>

          {/* 空き状況テーブル */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-[10px] font-medium text-gray-400 px-3 py-2 text-left w-20 border-r border-gray-100">
                    受付時刻
                  </th>
                  <th className="text-[10px] font-medium text-gray-600 px-3 py-2 text-center">
                    {loading ? "読み込み中..." : "空き状況"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ALL_SLOTS.map((slot) => {
                  const state = getCellState(slot);
                  const isHourBoundary = slot.endsWith(":00");
                  return (
                    <tr
                      key={slot}
                      className={clsx(
                        "border-b border-gray-50",
                        isHourBoundary && "border-t border-gray-100"
                      )}
                    >
                      {/* 時刻ラベル */}
                      <td
                        className={clsx(
                          "text-[11px] px-3 py-1.5 border-r border-gray-100 w-20",
                          isHourBoundary ? "font-semibold text-gray-600" : "text-gray-400"
                        )}
                      >
                        {slot}
                      </td>

                      {/* ○/× セル */}
                      <td
                        onClick={() => !loading && handleCellClick(slot)}
                        className={clsx(
                          "text-center py-1.5 select-none transition-colors",
                          !loading && state !== "booked" && "cursor-pointer",
                          state === "free" && "hover:bg-green-50",
                          state === "booked" && "cursor-not-allowed",
                          state === "sel-start" && "bg-[#06C755]",
                          state === "sel-range" && "bg-green-100",
                          state === "sel-end" && "bg-[#05A847]"
                        )}
                      >
                        {loading ? (
                          <span className="text-gray-200 text-sm">…</span>
                        ) : state === "booked" ? (
                          <span className="text-gray-300 text-base font-medium">×</span>
                        ) : state === "free" ? (
                          <span className="text-[#06C755] text-base font-medium">○</span>
                        ) : state === "sel-start" ? (
                          <span className="text-white text-base font-bold">●</span>
                        ) : state === "sel-range" ? (
                          <span className="text-green-600 text-base font-medium">○</span>
                        ) : (
                          <span className="text-white text-base font-bold">●</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 凡例 */}
          <div className="flex gap-5 px-3 py-2 border-t border-gray-100">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="text-[#06C755] font-medium">○</span> 空き
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="text-gray-300 font-medium">×</span> 予約済み
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="text-[#06C755] font-bold">●</span> 選択中
            </span>
          </div>
        </section>
      </div>

      {/* フッターアクションエリア */}
      <div className="px-3 pb-3 bg-white border-t border-gray-100 pt-3">
        {selStart && endTime && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-400">選択中</span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-800">
                {selStart} 〜 {endTime}
              </span>
              {availability?.available === true && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                  空きあり
                </span>
              )}
              {availability?.available === false && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                  予約不可
                </span>
              )}
            </div>
          </div>
        )}

        {!availability && selStart && endTime && (
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-3 rounded-xl text-sm font-medium bg-[#06C755] text-white disabled:opacity-60"
          >
            {checking ? "確認中..." : "空きを確認する"}
          </button>
        )}

        {availability?.available === true && (
          <button
            onClick={handleConfirm}
            className="w-full py-3 rounded-xl text-sm font-medium bg-[#06C755] text-white"
          >
            予約内容を確認する
          </button>
        )}

        {availability?.available === false && (
          <button
            onClick={() => { setSelStart(null); setSelEnd(null); setAvailability(null); }}
            className="w-full py-3 rounded-xl text-sm font-medium bg-gray-200 text-gray-600"
          >
            別の時間帯を選び直す
          </button>
        )}

        {!selStart && (
          <p className="text-center text-xs text-gray-400 py-2">
            開始時刻をタップし、次に終了時刻をタップしてください
          </p>
        )}

        {selStart && !endTime && (
          <p className="text-center text-xs text-gray-400 py-2">
            <span className="font-medium text-gray-600">{selStart}</span> を選択中 — 次に終了時刻をタップ
          </p>
        )}
      </div>
    </div>
  );
}

export default function TimeslotPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-sm text-gray-400">読み込み中...</div>}>
      <TimeslotContent />
    </Suspense>
  );
}

// ─── サブコンポーネント ────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center my-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={clsx(
            "h-1 w-5 rounded-full",
            i < step ? "bg-[#06C755]" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
