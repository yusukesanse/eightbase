"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Facility } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// ─── 定数 ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function generateSlots(openTime: string, closeTime: string): string[] {
  const start = timeToMin(openTime);
  const end = timeToMin(closeTime);
  const slots: string[] = [];
  for (let t = start; t < end; t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

// ─── メインページ ────────────────────────────────────────────────────────────

export default function ReservationPage() {
  const router = useRouter();

  // データ
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);

  // カレンダー
  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf("month"));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 空き状況
  const [weekData, setWeekData] = useState<Record<string, { start: string; end: string }[]>>({});
  const [daySlots, setDaySlots] = useState<{ start: string; end: string }[]>([]);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);

  // 時間選択
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  const today = dayjs().format("YYYY-MM-DD");
  const maxDate = dayjs().add(30, "day").format("YYYY-MM-DD");

  // ─── 施設取得 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.facilities ?? []) as Facility[];
        setFacilities(list);
      })
      .catch(() => {});
  }, []);

  // ─── 月の空きデータ取得（週ごとに取得して合算）─────────────────────────────
  useEffect(() => {
    if (!selectedFacility) return;
    setLoadingWeek(true);
    setWeekData({});

    // 月の開始〜終了をカバーする週を計算
    const monthStart = currentMonth.startOf("month");
    const monthEnd = currentMonth.endOf("month");
    const weeks: string[] = [];

    let w = monthStart.startOf("week").add(1, "day"); // 月曜始まり
    if (w.isAfter(monthStart)) w = w.subtract(1, "week");
    while (w.isBefore(monthEnd) || w.isSame(monthEnd, "day")) {
      weeks.push(w.format("YYYY-MM-DD"));
      w = w.add(1, "week");
    }

    Promise.all(
      weeks.map((ws) =>
        fetch(`/api/reservations/week-availability?facilityId=${selectedFacility.id}&weekStart=${ws}`)
          .then((r) => r.json())
          .catch(() => ({}))
      )
    ).then((results) => {
      const merged: Record<string, { start: string; end: string }[]> = {};
      results.forEach((r) => {
        Object.entries(r).forEach(([date, slots]) => {
          merged[date] = slots as { start: string; end: string }[];
        });
      });
      setWeekData(merged);
      setLoadingWeek(false);
    });
  }, [selectedFacility?.id, currentMonth.format("YYYY-MM")]);

  // ─── 選択日の空き取得 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedFacility || !selectedDate) {
      setDaySlots([]);
      return;
    }
    setLoadingDay(true);
    setSelStart(null);
    setSelEnd(null);
    fetch(`/api/reservations/availability?facilityId=${selectedFacility.id}&date=${selectedDate}`)
      .then((r) => r.json())
      .then((d) => setDaySlots(d.bookedSlots ?? []))
      .finally(() => setLoadingDay(false));
  }, [selectedFacility?.id, selectedDate]);

  // ─── カレンダーデータ ─────────────────────────────────────────────────────
  const calendarDays = useMemo(() => {
    const first = currentMonth.startOf("month");
    const last = currentMonth.endOf("month");

    // 月曜始まり → day(): 0=日 → 月曜=1, 日曜=0→7
    const rawDow = first.day();
    const startDow = rawDow === 0 ? 7 : rawDow;
    const leadingBlanks = startDow - 1;

    const days: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) days.push(null);
    for (let d = 1; d <= last.date(); d++) days.push(first.add(d - 1, "day"));

    // 末尾を7の倍数に
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentMonth.format("YYYY-MM")]);

  // ─── 日付の状態判定 ────────────────────────────────────────────────────────
  const getDateState = useCallback(
    (d: dayjs.Dayjs) => {
      const dateStr = d.format("YYYY-MM-DD");
      const isPast = dateStr < today;
      const isBeyond = dateStr > maxDate;
      const availDays = selectedFacility?.availableDays ?? [1, 2, 3, 4, 5];
      const isUnavailableDay = !availDays.includes(d.day());

      if (isPast || isBeyond || isUnavailableDay) return "disabled" as const;

      // 空きデータがあれば、その日が完全に埋まっているか判定
      const booked = weekData[dateStr];
      if (booked && selectedFacility) {
        const open = timeToMin(selectedFacility.openTime ?? "09:00");
        const close = timeToMin(selectedFacility.closeTime ?? "18:00");
        const totalMin = close - open;
        let bookedMin = 0;
        booked.forEach((b) => {
          const s = Math.max(timeToMin(b.start), open);
          const e = Math.min(timeToMin(b.end), close);
          if (e > s) bookedMin += e - s;
        });
        if (bookedMin >= totalMin) return "full" as const;
        if (bookedMin > 0) return "partial" as const;
      }
      return "available" as const;
    },
    [today, maxDate, selectedFacility, weekData]
  );

  // ─── タイムスロット生成 ────────────────────────────────────────────────────
  const timeSlots = useMemo(() => {
    if (!selectedFacility) return [];
    return generateSlots(
      selectedFacility.openTime ?? "09:00",
      selectedFacility.closeTime ?? "18:00"
    );
  }, [selectedFacility?.openTime, selectedFacility?.closeTime]);

  const isSlotBooked = useCallback(
    (slot: string) => {
      const sm = timeToMin(slot);
      return daySlots.some((b) => sm >= timeToMin(b.start) && sm < timeToMin(b.end));
    },
    [daySlots]
  );

  const isPastSlot = useCallback(
    (slot: string) => {
      if (selectedDate !== today) return false;
      const now = dayjs();
      const slotTime = dayjs(`${selectedDate}T${slot}`);
      return slotTime.isBefore(now);
    },
    [selectedDate, today]
  );

  // ─── 時間選択ハンドラ ──────────────────────────────────────────────────────
  function handleSlotClick(slot: string) {
    if (isSlotBooked(slot) || isPastSlot(slot)) return;

    if (!selStart || selEnd) {
      // 1回目または再選択 → 開始時刻
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 2回目 → 終了時刻
    if (timeToMin(slot) <= timeToMin(selStart)) {
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 範囲内に予約済みスロットがないか確認
    const hasConflict = daySlots.some((b) => {
      const bs = timeToMin(b.start);
      const be = timeToMin(b.end);
      const ss = timeToMin(selStart);
      const se = timeToMin(slot) + 30; // スロット末尾
      return bs < se && be > ss;
    });

    if (hasConflict) {
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 終了時刻 = 選択スロット + 30分
    const endMin = timeToMin(slot) + 30;
    const eh = Math.floor(endMin / 60);
    const em = endMin % 60;
    setSelEnd(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
  }

  function getSlotState(slot: string) {
    if (isSlotBooked(slot)) return "booked" as const;
    if (isPastSlot(slot)) return "past" as const;
    if (!selStart) return "free" as const;
    if (slot === selStart) return "selected-start" as const;
    if (selEnd) {
      const sm = timeToMin(slot);
      const ss = timeToMin(selStart);
      const se = timeToMin(selEnd);
      if (sm >= ss && sm < se) return "selected-range" as const;
    }
    return "free" as const;
  }

  // ─── 予約確定へ ────────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!selectedFacility || !selectedDate || !selStart || !selEnd) return;
    router.push(
      `/reservation/confirm?facilityId=${selectedFacility.id}&date=${selectedDate}&startTime=${selStart}&endTime=${selEnd}`
    );
  }

  const canConfirm = !!(selectedFacility && selectedDate && selStart && selEnd);
  const meetingRooms = facilities.filter((f) => f.type === "meeting_room");
  const booths = facilities.filter((f) => f.type === "booth");

  // ─── レンダリング ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ── ヘッダー ── */}
      <header className="bg-[#A5C1C8] px-5 pt-4 pb-5">
        <div>
          <h1 className="text-base font-bold text-[#414141] tracking-wide">施設予約</h1>
          <p className="text-[11px] text-[#414141]/50 mt-0.5">EIGHT BASE UNGA</p>
        </div>
      </header>

      {/* ── マイ予約リンク ── */}
      <div className="px-5 pt-3">
        <Link
          href="/my-reservations"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#414141]/70"
        >
          マイ予約
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      </div>

      {/* ── 施設選択 ── */}
      <section className="px-5 pt-4 pb-2">
        <p className="text-[11px] font-bold text-[#414141]/40 uppercase tracking-widest mb-3">施設を選択</p>

        {meetingRooms.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-[#414141]/40 mb-1.5">会議室</p>
            <div className="flex gap-2 flex-wrap">
              {meetingRooms.map((f) => (
                <FacilityPill
                  key={f.id}
                  facility={f}
                  selected={selectedFacility?.id === f.id}
                  onSelect={() => {
                    setSelectedFacility(f);
                    setSelectedDate(null);
                    setSelStart(null);
                    setSelEnd(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {booths.length > 0 && (
          <div>
            <p className="text-[10px] text-[#414141]/40 mb-1.5">リモートブース</p>
            <div className="flex gap-2 flex-wrap">
              {booths.map((f) => (
                <FacilityPill
                  key={f.id}
                  facility={f}
                  selected={selectedFacility?.id === f.id}
                  onSelect={() => {
                    setSelectedFacility(f);
                    setSelectedDate(null);
                    setSelStart(null);
                    setSelEnd(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 区切り ── */}
      <div className="mx-5 h-px bg-gray-100" />

      {/* ── カレンダー ── */}
      {selectedFacility ? (
        <section className="px-5 pt-4 pb-2">
          {/* 月ナビ */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCurrentMonth((m) => m.subtract(1, "month"))}
              disabled={currentMonth.isSame(dayjs().startOf("month"), "month")}
              className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                currentMonth.isSame(dayjs().startOf("month"), "month")
                  ? "text-gray-200"
                  : "text-[#414141] hover:bg-gray-50"
              )}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <h2 className="text-sm font-bold text-[#414141]">
              {currentMonth.format("YYYY年 M月")}
            </h2>
            <button
              onClick={() => setCurrentMonth((m) => m.add(1, "month"))}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#414141] hover:bg-gray-50 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_LABELS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-[#414141]/30 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {calendarDays.map((d, i) => {
              if (!d) return <div key={`blank-${i}`} />;
              const dateStr = d.format("YYYY-MM-DD");
              const state = getDateState(d);
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === today;

              return (
                <button
                  key={dateStr}
                  disabled={state === "disabled" || state === "full"}
                  onClick={() => setSelectedDate(dateStr)}
                  className={clsx(
                    "relative flex flex-col items-center py-1.5 rounded-xl transition-all",
                    state === "disabled" && "opacity-20",
                    state === "full" && "opacity-30",
                    isSelected && "bg-[#414141]",
                    !isSelected && state !== "disabled" && state !== "full" && "hover:bg-gray-50 active:scale-95"
                  )}
                >
                  <span
                    className={clsx(
                      "text-[13px] font-medium",
                      isSelected ? "text-white" : isToday ? "text-[#B0E401] font-bold" : "text-[#414141]"
                    )}
                  >
                    {d.date()}
                  </span>
                  {/* 空きインジケーター */}
                  <span
                    className={clsx(
                      "w-1 h-1 rounded-full mt-0.5 transition-colors",
                      isSelected
                        ? "bg-[#B0E401]"
                        : state === "available"
                        ? "bg-[#B0E401]"
                        : state === "partial"
                        ? "bg-[#A5C1C8]"
                        : "bg-transparent"
                    )}
                  />
                </button>
              );
            })}
          </div>

          {loadingWeek && (
            <div className="flex justify-center py-2">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
            </div>
          )}

          {/* 凡例 */}
          <div className="flex items-center gap-4 mt-2 justify-center">
            <span className="flex items-center gap-1 text-[9px] text-[#414141]/40">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B0E401]" /> 空きあり
            </span>
            <span className="flex items-center gap-1 text-[9px] text-[#414141]/40">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A5C1C8]" /> 一部予約
            </span>
          </div>
        </section>
      ) : (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#A5C1C8]/10 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A5C1C8" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm text-[#414141]/40 leading-relaxed">
              施設を選択すると<br />空き状況が表示されます
            </p>
          </div>
        </div>
      )}

      {/* ── タイムスロット ── */}
      {selectedDate && selectedFacility && (
        <>
          <div className="mx-5 h-px bg-gray-100" />
          <section className="px-5 pt-4 pb-2 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-bold text-[#414141]/40 uppercase tracking-widest">
                時間を選択
              </h3>
              <span className="text-xs font-medium text-[#414141]">
                {dayjs(selectedDate).format("M月D日（ddd）")}
              </span>
            </div>

            {loadingDay ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <p className="text-[10px] text-[#414141]/40 mb-2">
                  {!selStart ? "開始時刻をタップ" : !selEnd ? "終了時刻をタップ" : "選択完了"}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {timeSlots.map((slot) => {
                    const state = getSlotState(slot);
                    return (
                      <button
                        key={slot}
                        disabled={state === "booked" || state === "past"}
                        onClick={() => handleSlotClick(slot)}
                        className={clsx(
                          "py-2.5 rounded-xl text-xs font-medium transition-all",
                          state === "booked" && "bg-gray-50 text-gray-200 line-through cursor-not-allowed",
                          state === "past" && "bg-gray-50 text-gray-200 cursor-not-allowed",
                          state === "free" && "bg-[#FAFAFA] text-[#414141] hover:bg-[#A5C1C8]/10 active:scale-95 border border-gray-100",
                          state === "selected-start" && "bg-[#B0E401] text-[#414141] font-bold shadow-sm shadow-[#B0E401]/25 scale-[1.02]",
                          state === "selected-range" && "bg-[#B0E401]/15 text-[#414141] border border-[#B0E401]/20"
                        )}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* ── フローティングフッター ── */}
      <div className="sticky bottom-0 bg-white/80 backdrop-blur-lg border-t border-gray-100 px-5 py-3 safe-area-pb">
        {canConfirm ? (
          <div className="space-y-2">
            {/* 選択サマリー */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#A5C1C8]/10 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A5C1C8" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-[11px] text-[#414141]/50">{selectedFacility?.name}</p>
                  <p className="text-xs font-bold text-[#414141]">
                    {dayjs(selectedDate!).format("M/D（ddd）")} {selStart}〜{selEnd}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleConfirm}
              className="w-full py-3.5 rounded-2xl text-sm font-bold bg-[#B0E401] text-[#414141] active:scale-[0.98] transition-transform shadow-sm shadow-[#B0E401]/20"
            >
              予約内容を確認する
            </button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-[#414141]/30 py-1">
            {!selectedFacility
              ? "上から施設を選択してください"
              : !selectedDate
              ? "カレンダーから日付を選択してください"
              : !selStart
              ? "開始時刻をタップしてください"
              : "終了時刻をタップしてください"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── サブコンポーネント ──────────────────────────────────────────────────────

function FacilityPill({
  facility,
  selected,
  onSelect,
}: {
  facility: Facility;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-95",
        selected
          ? "bg-[#414141] text-white shadow-sm"
          : "bg-[#FAFAFA] text-[#414141] border border-gray-100 hover:border-[#A5C1C8]/30"
      )}
    >
      {facility.name}
      <span className={clsx("ml-1.5 text-[10px]", selected ? "text-white/60" : "text-[#414141]/30")}>
        {facility.capacity}名
      </span>
    </button>
  );
}
