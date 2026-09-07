"use client";

import clsx from "clsx";
import type { Facility } from "@/types";

/** 施設選択のピル（予約画面の施設タブ）。 */
export function FacilityPill({
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
        "h-12 rounded-[14px] px-4 text-[14px] font-bold transition-transform active:scale-95",
        selected
          ? "text-white"
          : "bg-white/60 text-[color:var(--eb-ink)]"
      )}
      style={selected ? { background: "var(--eb-green)" } : undefined}
    >
      {facility.name}
      <span
        className="ml-1.5 text-[12px] font-medium"
        style={{ color: selected ? "rgba(255,255,255,.7)" : "var(--eb-ink-muted)" }}
      >
        {facility.capacity}名
      </span>
    </button>
  );
}
