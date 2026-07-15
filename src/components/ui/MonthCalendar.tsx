"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import clsx from "clsx";

/**
 * 月カレンダー（施設予約の日付グリッドと同じ体裁）。選択可能日は呼び出し側が決める。
 * 予約ページのインラインカレンダーを共通化したもの。
 */

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export default function MonthCalendar({
  value,
  onSelect,
  isSelectable,
  marked,
  accent = "#2f7d57",
  size = "sm",
  allowPast = false,
}: {
  value: string | null;
  onSelect: (dateStr: string) => void;
  isSelectable: (dateStr: string, d: dayjs.Dayjs) => boolean;
  /** 印を付ける日（参加中など） */
  marked?: (dateStr: string) => boolean;
  accent?: string;
  /** sm=コンパクト（既定）/ lg=大きめ（管理カレンダー用） */
  size?: "sm" | "lg";
  /** 過去の月へも戻れるようにする（管理画面の過去開催日の閲覧用）。既定は当月より前に戻れない。 */
  allowPast?: boolean;
}) {
  const lg = size === "lg";
  const today = dayjs().format("YYYY-MM-DD");
  const [month, setMonth] = useState(() => (value ? dayjs(value) : dayjs()).startOf("month"));
  const prevDisabled = !allowPast && month.isSame(dayjs().startOf("month"), "month");

  const days = useMemo(() => {
    const first = month.startOf("month");
    const rawDow = first.day();
    const lead = (rawDow === 0 ? 7 : rawDow) - 1; // 月曜始まり
    const arr: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < lead; i++) arr.push(null);
    for (let d = 1; d <= month.endOf("month").date(); d++) arr.push(first.add(d - 1, "day"));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [month]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setMonth((m) => m.subtract(1, "month"))}
          disabled={prevDisabled}
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
            prevDisabled ? "text-gray-200" : "text-[#231714] hover:bg-gray-50"
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h2 className="text-sm font-bold text-[#231714]">{month.format("YYYY年 M月")}</h2>
        <button
          onClick={() => setMonth((m) => m.add(1, "month"))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[#231714] hover:bg-gray-50 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[#231714]/30 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const dateStr = d.format("YYYY-MM-DD");
          const selectable = isSelectable(dateStr, d);
          const selected = dateStr === value;
          const isToday = dateStr === today;
          return (
            <button
              key={dateStr}
              disabled={!selectable}
              onClick={() => onSelect(dateStr)}
              className={clsx(
                "relative flex flex-col items-center rounded-xl transition-all",
                lg ? "py-4" : "py-1.5",
                !selectable && "opacity-20",
                selected && "text-white",
                !selected && selectable && "hover:bg-gray-50 active:scale-95"
              )}
              style={selected ? { background: accent } : undefined}
            >
              <span className={clsx(lg ? "text-[16px]" : "text-[13px]", "font-medium", selected ? "text-white" : isToday ? "font-bold" : "text-[#231714]")} style={!selected && isToday ? { color: accent } : undefined}>
                {d.date()}
              </span>
              {marked?.(dateStr) && (
                <span className={clsx("rounded-full", lg ? "w-1.5 h-1.5 mt-1" : "w-1 h-1 mt-0.5")} style={{ background: selected ? "#fff" : accent }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
