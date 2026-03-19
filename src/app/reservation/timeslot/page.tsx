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

type SlotState = "free" | "taken" | "sel-start" | "sel-range" | "sel-end";

function getSlotState(
  slot: string,
  bookedSlots: { start: string; end: string }[],
  selStart: string | null,
  selEnd: string | null
): SlotState {
  const sm = timeToMin(slot);

  // 予約済み判定
  for (const b of bookedSlots) {
    if (sm >= timeToMin(b.start) && sm < timeToMin(b.end)) return "taken";
  }

  if (!selStart) return "free";

  if (slot === selStart) return "sel-start";
  if (selEnd && slot === selEnd) return "sel-end";
  if (
    selEnd &&
    sm > timeToMin(selStart) &&
    sm < timeToMin(selEnd)
  )
    return "sel-range";

  return "free";
}

function TimeSlotContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facilityId") ?? "";
  const date = params.get("date") ?? "";

  const facility = getFacilityById(facilityId);

  const [bookedSlots, setBookedSlots] = useState<{ start: string; end: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const dateLabel = dayjs(date).format("M月D日（ddd）");

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

  // 開始・終了スロット選択
  function handleSlotClick(slot: string) {
    const state = getSlotState(slot, bookedSlots, null, null);
    if (state === "taken") return;

    if (!selStart || (selStart && selEnd)) {
      // 新規選択開始
      setSelStart(slot);
      setSelEnd(null);
      setAvailability(null);
      return;
    }

    // 終了スロット選択（selStart より後のスロット）
    if (timeToMin(slot) <= timeToMin(selStart)) {
      setSelStart(slot);
      setSelEnd(null);
      setAvailability(null);
      return;
    }

    // 選択範囲内に予約済みスロットがないか確認
    const hasConflict = bookedSlots.some((b) => {
      const bs = timeToMin(b.start);
      const be = timeToMin(b.end);
      const ss = timeToMin(selStart);
      const se = timeToMin(slot) + 15; // 終了の1スロット後
      return bs < se && be > ss;
    });

    if (hasConflict) {
      alert("選択範囲内に予約済みの時間が含まれています。");
      return;
    }

    setSelEnd(slot);
    setAvailability(null);
  }

  // 終了時刻（selEnd の次の15分）
  const endTime = selEnd
    ? (() => {
        const m = timeToMin(selEnd) + 15;
        return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      })()
    : null;

  // 空き確認
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

  // 予約確認画面へ
  function handleConfirm() {
    if (!selStart || !endTime || !availability?.available) return;
    router.push(
      `/reservation/confirm?facilityId=${facilityId}&date=${date}&startTime=${selStart}&endTime=${endTime}`
    );
  }

  const morningSlots = ALL_SLOTS.filter((s) => timeToMin(s) < 13 * 60);
  const afternoonSlots = ALL_SLOTS.filter((s) => timeToMin(s) >= 13 * 60);

  return (
    <div>
      <TopBar
        title="NUF 施設予約"
        subtitle={`${facility?.name ?? ""} — ${dateLabel}`}
      />

      <div className="p-3 space-y-3">
        {/* ステップ */}
        <StepIndicator step={3} total={4} />

        <section className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-xs font-medium text-gray-400 mb-2">
            時間帯を選択（15分単位）
          </p>

          {loading ? (
            <div className="text-center text-xs text-gray-400 py-6">読み込み中...</div>
          ) : (
            <>
              <p className="text-xs text-gray-400 font-medium mb-1.5">午前</p>
              <SlotGrid
                slots={morningSlots}
                bookedSlots={bookedSlots}
                selStart={selStart}
                selEnd={selEnd}
                onSlotClick={handleSlotClick}
              />

              <p className="text-xs text-gray-400 font-medium mt-3 mb-1.5">午後</p>
              <SlotGrid
                slots={afternoonSlots}
                bookedSlots={bookedSlots}
                selStart={selStart}
                selEnd={selEnd}
                onSlotClick={handleSlotClick}
              />
            </>
          )}

          {/* 凡例 */}
          <div className="flex gap-3 mt-3">
            <Legend color="bg-[#06C755]" label="選択中" />
            <Legend color="bg-gray-100 border border-gray-200" label="予約済み" />
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
            予約を確定する
          </button>
        )}

        {availability?.available === false && (
          <button
            onClick={() => { setSelStart(null); setSelEnd(null); setAvailability(null); }}
            className="w-full py-3 rounded-xl text-sm font-medium bg-gray-200 text-gray-600"
          >
            別の時間帯を選択する
          </button>
        )}

        {!selStart && (
          <p className="text-center text-xs text-gray-400 py-2">
            開始スロットをタップして選択してください
          </p>
        )}
      </div>
    </div>
  );
}

export default function TimeSlotPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-sm text-gray-400">読み込み中...</div>}>
      <TimeSlotContent />
    </Suspense>
  );
}

// ─── サブコンポーネント ─────────────────────────────────────────────────────────

function SlotGrid({
  slots,
  bookedSlots,
  selStart,
  selEnd,
  onSlotClick,
}: {
  slots: string[];
  bookedSlots: { start: string; end: string }[];
  selStart: string | null;
  selEnd: string | null;
  onSlotClick: (s: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {slots.map((slot) => {
        const state = getSlotState(slot, bookedSlots, selStart, selEnd);
        return (
          <button
            key={slot}
            onClick={() => onSlotClick(slot)}
            disabled={state === "taken"}
            className={clsx(
              "text-[10px] py-1.5 rounded-md border text-center transition-colors",
              state === "free"      && "border-gray-200 text-gray-700 hover:border-gray-400",
              state === "taken"     && "bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed",
              state === "sel-start" && "bg-[#06C755] text-white border-[#06C755]",
              state === "sel-range" && "bg-green-50 text-green-700 border-green-300",
              state === "sel-end"   && "bg-[#05A847] text-white border-[#05A847]"
            )}
          >
            {slot}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[9px] text-gray-400">
      <span className={clsx("w-2.5 h-2.5 rounded-sm", color)} />
      {label}
    </span>
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
            i < step ? "bg-[#06C755]" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
