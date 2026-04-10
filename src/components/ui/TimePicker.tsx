"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TimePickerProps {
  value: string;
  onChange: (v: string) => void;
  minTime?: string;
  maxTime?: string;
  step?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMin(m: number) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export default function TimePicker({
  value,
  onChange,
  minTime = "00:00",
  maxTime = "23:30",
  step = 30,
  placeholder = "時間を選択",
  required,
  className = "",
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options: string[] = [];
  const minM = toMin(minTime);
  const maxM = toMin(maxTime);
  for (let m = minM; m <= maxM; m += step) {
    options.push(fromMin(m));
  }

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

  // Scroll to selected
  useEffect(() => {
    if (open && listRef.current && value) {
      const idx = options.indexOf(value);
      if (idx >= 0) {
        const el = listRef.current.children[idx] as HTMLElement;
        if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
      }
    }
  }, [open]);

  const displayValue = value
    ? (() => {
        const [h, m] = value.split(":").map(Number);
        return `${h}:${pad(m)}`;
      })()
    : "";

  const handleSelect = useCallback(
    (t: string) => {
      onChange(t);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={{ zIndex: open ? 9999 : "auto" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 border rounded-xl text-sm transition-all
          ${open ? "border-[#A5C1C8] ring-2 ring-[#A5C1C8]/30" : "border-[#231714]/15 hover:border-[#231714]/30"}
          ${!value ? "text-[#231714]/40" : "text-[#231714]"}
          bg-white cursor-pointer
        `}
      >
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#A5C1C8] shrink-0">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{displayValue || placeholder}</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-[#231714]/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown — inline, not portal */}
      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 mt-1 max-h-[240px] overflow-y-auto bg-white border border-[#231714]/10 rounded-xl shadow-lg shadow-black/10 py-1"
          style={{ zIndex: 99999 }}
        >
          {options.map((t) => {
            const isSelected = t === value;
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleSelect(t)}
                className={`
                  w-full text-left px-3 py-2 text-sm transition-colors
                  ${isSelected ? "bg-[#231714] text-white font-medium" : "text-[#231714] hover:bg-[#A5C1C8]/20"}
                `}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
