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
        "px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-95",
        selected
          ? "bg-[#231714] text-white shadow-sm"
          : "bg-[#FAFAFA] text-[#231714] border border-gray-100 hover:border-[#A5C1C8]/40"
      )}
    >
      {facility.name}
      <span className={clsx("ml-1.5 text-[10px]", selected ? "text-white/60" : "text-[#231714]/30")}>
        {facility.capacity}名
      </span>
    </button>
  );
}
