"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";

interface DatePickerProps {
  /** "YYYY-MM-DD" */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const WEEK = ["月", "火", "水", "木", "金", "土", "日"];

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

/** 月曜始まり: Mon=0 … Sun=6 */
function startDow(y: number, m: number) {
  const d = new Date(y, m, 1).getDay(); // 0=Sun
  return d === 0 ? 6 : d - 1;
}

function formatDisplay(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

export default function DatePicker({
  value,
  onChange,
  placeholder = "日付を選択",
  required,
  className = "",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Current calendar view month
  const [viewYear, setViewYear] = useState(() => {
    if (value) return Number(value.split("-")[0]);
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return Number(value.split("-")[1]) - 1;
    return new Date().getMonth();
  });

  // Sync view to value when value changes externally
  useEffect(() => {
    if (value) {
      const [y, m] = value.split("-").map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const cells = useMemo(() => {
    const dow = startDow(viewYear, viewMonth);
    const total = daysInMonth(viewYear, viewMonth);
    const arr: (number | null)[] = [];
    for (let i = 0; i < dow; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [viewYear, viewMonth]);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  function selectDay(day: number) {
    const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    onChange(iso);
    setOpen(false);
  }

  function goToday() {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    onChange(today);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={{ zIndex: open ? 9999 : "auto" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`
          flex h-14 w-full items-center justify-between gap-2
          rounded-2xl border px-4 text-[17px] transition-all
          ${open ? "border-2 border-[color:var(--eb-green)]" : "border-[color:var(--eb-line)]"}
          ${!value ? "text-[#9AA39E]" : "text-[color:var(--eb-ink)]"}
          cursor-pointer bg-white
        `}
      >
        <div className="flex min-w-0 items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--eb-green)]">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </svg>
          <span className="whitespace-nowrap">{formatDisplay(value) || placeholder}</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-[color:var(--eb-ink-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Calendar Dropdown */}
      {open && (
        <div
          className="eb-glass absolute left-0 mt-1 w-[280px] rounded-[20px] p-4 shadow-lg shadow-black/10"
          style={{ zIndex: 99999, background: "rgba(255,255,255,.98)" }}
        >
          {/* Header: month nav */}
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--eb-tint)] text-[color:var(--eb-ink)] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">
              {viewYear}年{viewMonth + 1}月
            </span>
            <button type="button" onClick={nextMonth} className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--eb-tint)] text-[color:var(--eb-ink)] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          {/* Weekday header */}
          <div className="mb-1 grid grid-cols-7">
            {WEEK.map((w, i) => (
              <div key={w} className={`py-1 text-center text-[11px] font-medium ${i >= 5 ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink-muted)]"}`}>
                {w}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;

              const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
              const isSelected = iso === value;
              const isToday = iso === today;
              // Sat=5, Sun=6 in our Mon-start grid
              const colIndex = i % 7;
              const isWeekend = colIndex >= 5;

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`
                    flex aspect-square w-full items-center justify-center rounded-full text-[14px] transition-all
                    ${isSelected
                      ? "bg-[color:var(--eb-green)] font-bold text-white"
                      : isToday
                        ? "font-bold text-[color:var(--eb-green-text)]"
                        : isWeekend
                          ? "text-[color:var(--eb-green-text)] hover:bg-[color:var(--eb-tint)]"
                          : "text-[color:var(--eb-ink)] hover:bg-[color:var(--eb-tint)]"
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer: today shortcut */}
          <div className="mt-2 flex justify-center border-t border-[color:var(--eb-line)] pt-2">
            <button
              type="button"
              onClick={goToday}
              className="text-[13px] font-bold text-[color:var(--eb-green-text)] transition-colors"
            >
              今日
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
