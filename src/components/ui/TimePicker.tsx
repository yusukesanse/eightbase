"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

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
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  // SSR guard — createPortal needs document.body
  useEffect(() => { setMounted(true); }, []);

  // Generate time options
  const options: string[] = [];
  const minM = toMin(minTime);
  const maxM = toMin(maxTime);
  for (let m = minM; m <= maxM; m += step) {
    options.push(fromMin(m));
  }

  // Calculate position when opened
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownH = Math.min(options.length * 36 + 8, 260);

      // Show above if not enough space below
      if (spaceBelow < dropdownH && rect.top > spaceBelow) {
        setPos({ top: rect.top - dropdownH - 4, left: rect.left, width: rect.width });
      } else {
        setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    }
  }, [open, options.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on scroll / resize (reposition would be janky)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    // Capture phase so we catch modal scroll too
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Scroll list to selected value
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

  const dropdown =
    mounted &&
    open &&
    createPortal(
      <div
        ref={listRef}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 99999,
        }}
        className="
          max-h-[260px] overflow-y-auto
          bg-white border border-gray-200 rounded-xl
          shadow-xl shadow-black/12
          py-1
        "
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
                ${
                  isSelected
                    ? "bg-gray-900 text-white font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }
              `}
            >
              {t}
            </button>
          );
        })}
      </div>,
      document.body
    );

  return (
    <div className={className}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 border rounded-xl text-sm transition-all
          ${
            open
              ? "border-gray-800 ring-2 ring-gray-800/10"
              : "border-gray-200 hover:border-gray-400"
          }
          ${!value ? "text-gray-400" : "text-gray-900"}
          bg-white cursor-pointer
        `}
      >
        <div className="flex items-center gap-2">
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

      {dropdown}
    </div>
  );
}
