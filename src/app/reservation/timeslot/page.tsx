"use client";

import { useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Facility } from "@/types";
import type { AvailabilityResponse } from "@/types";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { timeToMin } from "@/lib/date";
import { Button, GlassCard, PageBg, PageHeading } from "@/components/ui/eb";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// 安定参照
const EMPTY_SLOTS: { start: string; end: string }[] = [];

// 15分単位のスロット生成
function generateSlots(startMin: number, endMin: number): string[] {
  const slots: string[] = [];
  for (let t = startMin; t < endMin; t += 15) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

type CellState = "booked" | "free" | "sel-start" | "sel-range" | "sel-end";

function TimeslotContent() {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facilityId") ?? "";
  const date = params.get("date") ?? "";

  const dateLabel = dayjs(date).format("M月D日（ddd）");

  // 施設（キャッシュ可・即表示）
  const { data: facilitiesData } = useStaleWhileRevalidate<{ facilities: Facility[] }>(
    "facilities:list",
    async () => {
      const r = await fetch("/api/facilities", { cache: "no-store" });
      return r.json();
    }
  );
  const facility = useMemo(
    () => facilitiesData?.facilities?.find((f) => f.id === facilityId) ?? null,
    [facilitiesData, facilityId]
  );
  const allSlots = useMemo(() => {
    if (!facility) return generateSlots(9 * 60, 18 * 60);
    const [oh, om] = (facility.openTime ?? "09:00").split(":").map(Number);
    const [ch, cm] = (facility.closeTime ?? "18:00").split(":").map(Number);
    return generateSlots(oh * 60 + om, ch * 60 + cm);
  }, [facility]);

  // 予約済みスロット（短時間キャッシュ＋前回表示を残して裏で更新）。
  // 予約確定時はサーバーが必ず空きを再検証するため、表示が多少古くてもダブルブッキングは防がれる。
  const dayKey = facilityId && date ? `avail:day:${facilityId}:${date}` : null;
  const {
    data: bookedRaw,
    isLoading: loading,
    isValidating,
  } = useStaleWhileRevalidate<{ start: string; end: string }[]>(
    dayKey,
    async () => {
      const r = await fetch(
        `/api/reservations/availability?facilityId=${facilityId}&date=${date}`,
        { cache: "no-store", credentials: "include" }
      );
      const d: AvailabilityResponse = await r.json();
      return d.bookedSlots ?? [];
    },
    { ttl: 30_000 }
  );
  const bookedSlots = bookedRaw ?? EMPTY_SLOTS;
  // 既存表示を出したまま裏で更新中（表示が古い可能性あり）
  const refreshing = isValidating && !loading;

  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [checking, setChecking] = useState(false);

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
        `/api/reservations/availability?facilityId=${facilityId}&date=${date}&startTime=${selStart}&endTime=${endTime}`,
        { cache: "no-store", credentials: "include" }
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
    <PageBg className="flex flex-col">
      <div className="px-5 pt-8">
        <PageHeading title="RESERVE" subtitle={`${facility?.name ?? ""} — ${dateLabel}`} />
      </div>

      <div className="flex-1 space-y-3 px-5 pt-6 pb-3">
        <GlassCard padding="md" className="overflow-hidden !p-0">
          <p className="px-4 pb-2 pt-4 text-[15px] text-[color:var(--eb-ink)]">
            開始時刻・終了時刻を順にタップ（15分単位）
          </p>

          {/* 空き状況テーブル */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[color:var(--eb-line)] bg-white/95">
                  <th className="w-20 border-r border-[color:var(--eb-line)] px-4 py-2 text-left text-[12px] font-medium text-[color:var(--eb-ink-muted)]">
                    受付時刻
                  </th>
                  <th className="px-4 py-2 text-center text-[12px] font-medium text-[color:var(--eb-ink-muted)]">
                    {loading
                      ? "読み込み中..."
                      : refreshing
                      ? "空き状況（更新中…）"
                      : "空き状況"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {allSlots.map((slot) => {
                  const state = getCellState(slot);
                  const isHourBoundary = slot.endsWith(":00");
                  return (
                    <tr
                      key={slot}
                      className={clsx(
                        "border-b border-[color:var(--eb-line)]",
                        isHourBoundary && "border-t border-[color:var(--eb-line)]"
                      )}
                    >
                      {/* 時刻ラベル */}
                      <td
                        className={clsx(
                          "w-20 border-r border-[color:var(--eb-line)] px-4 py-1.5 text-[12px]",
                          isHourBoundary ? "font-bold text-[color:var(--eb-ink)]" : "text-[color:var(--eb-ink-muted)]"
                        )}
                      >
                        {slot}
                      </td>

                      {/* ○/× セル */}
                      <td
                        onClick={() => !loading && handleCellClick(slot)}
                        className={clsx(
                          "select-none py-1.5 text-center transition-colors",
                          !loading && state !== "booked" && "cursor-pointer",
                          state === "booked" && "cursor-not-allowed"
                        )}
                        style={
                          state === "sel-start" || state === "sel-end"
                            ? { background: "var(--eb-green)" }
                            : state === "sel-range"
                              ? { background: "rgba(35,147,94,.14)" }
                              : state === "booked"
                                ? { background: "var(--eb-tint)" }
                                : undefined
                        }
                      >
                        {loading ? (
                          <span className="text-[14px] text-[color:var(--eb-ink-muted)]">…</span>
                        ) : state === "booked" ? (
                          <span className="text-[15px] font-bold text-[color:var(--eb-ink-muted)]">×</span>
                        ) : state === "free" ? (
                          <span className="text-[15px] font-bold text-[color:var(--eb-green-text)]">○</span>
                        ) : state === "sel-start" ? (
                          <span className="text-[15px] font-bold text-white">●</span>
                        ) : state === "sel-range" ? (
                          <span className="text-[15px] font-bold text-[color:var(--eb-green-text)]">○</span>
                        ) : (
                          <span className="text-[15px] font-bold text-white">●</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 凡例 */}
          <div className="flex gap-5 border-t border-[color:var(--eb-line)] px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">
              <span className="font-bold text-[color:var(--eb-green-text)]">○</span> 空き
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">
              <span className="font-bold">×</span> 予約済み
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">
              <span className="font-bold text-[color:var(--eb-green-text)]">●</span> 選択中
            </span>
          </div>
        </GlassCard>
      </div>

      {/* フッターアクションエリア */}
      <div className="border-t border-[color:var(--eb-line)] bg-white/80 px-5 pb-3 pt-3 backdrop-blur-lg">
        {selStart && endTime && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] text-[color:var(--eb-ink-muted)]">選択中</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">
                {selStart} 〜 {endTime}
              </span>
              {availability?.available === true && (
                <span className="rounded-full px-2 py-1 text-[12px] font-bold" style={{ background: "rgba(35,147,94,.14)", color: "var(--eb-green-text)" }}>
                  空きあり
                </span>
              )}
              {availability?.available === false && (
                <span className="rounded-full px-2 py-1 text-[12px] font-bold" style={{ background: "rgba(217,72,58,.14)", color: "var(--eb-coral-text)" }}>
                  予約不可
                </span>
              )}
            </div>
          </div>
        )}

        {!availability && selStart && endTime && (
          <Button onClick={handleCheck} loading={checking} variant="primary">
            空きを確認する
          </Button>
        )}

        {availability?.available === true && (
          <Button onClick={handleConfirm} variant="primary">
            予約内容を確認する
          </Button>
        )}

        {availability?.available === false && (
          <Button
            onClick={() => { setSelStart(null); setSelEnd(null); setAvailability(null); }}
            variant="ghost"
          >
            別の時間帯を選び直す
          </Button>
        )}

        {!selStart && (
          <p className="py-2 text-center text-[13px] text-[color:var(--eb-ink-muted)]">
            開始時刻をタップし、次に終了時刻をタップしてください
          </p>
        )}

        {selStart && !endTime && (
          <p className="py-2 text-center text-[13px] text-[color:var(--eb-ink-muted)]">
            <span className="font-bold text-[color:var(--eb-ink)]">{selStart}</span> を選択中 — 次に終了時刻をタップ
          </p>
        )}
      </div>
    </PageBg>
  );
}

export default function TimeslotPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-[13px] text-[color:var(--eb-ink-muted)]">読み込み中...</div>}>
      <TimeslotContent />
    </Suspense>
  );
}
