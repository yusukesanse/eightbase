"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TimePickerProps {
  value: string;            // "HH:MM"
  onChange: (v: string) => void;
  minTime?: string;         // optional lower bound
  maxTime?: string;         // optional upper bound
  step?: number;            // minutes interval (default 30)
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
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Generate time options
  const options: string[] = [];
  const minM = toMin(minTime);
  const maxM = toMin(maxTime);
  for (let m = minM; m <= maxM; m += step) {
    options.push(fromMin(m));
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  // Scroll to selected value when opened
  useEffect(() => {
    if (open && listRef.current && value) {
      const idx = options.indexOf(value);
      if (idx >= 0) {
        const el = listRef.current.children[idx] as HTMLElement;
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "instant" });
        }
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
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 border rounded-xl text-sm transition-all
          ${open
            ? "border-gray-800 ring-2 ring-gray-800/10"
            : "border-gray-200 hover:border-gray-400"
          }
          ${!value ? "text-gray-400" : "text-gray-900"}
          bg-white cursor-pointer
        `}
      >
        <div className="flex items-center gap-2">
          {/* Clock icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-400 shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{displayValue || placeholder}</span>
        </div>
        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          className="
            absolute z-50 left-0 right-0 mt-1
            max-h-[220px] overflow-y-auto
            bg-white border border-gray-200 rounded-xl
            shadow-lg shadow-black/8
            py-1
            scrollbar-thin
          "
          style={{ scrollbarWidth: "thin" }}
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
                  ${isSelected
                    ? "bg-gray-900 text-white font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                  }
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
