"use client";

import { memo } from "react";
import type { PointerEvent, ReactNode } from "react";
import type { PickedChip } from "./useCsBracketDrag";

// 再マウントせずに指でつまめる参加者または札を表示する。
export const Chip = memo(function Chip({ picked, label, tier, seed, selected, dragging, locked,
  onPointerDown, onSelect, onUnseed,
}: {
  picked: PickedChip;
  label: string;
  tier?: string;
  seed: boolean;
  selected: boolean;
  dragging: boolean;
  locked: boolean;
  onPointerDown: (event: PointerEvent, picked: PickedChip) => void;
  onSelect: (picked: PickedChip) => void;
  onUnseed?: () => void;
}) {
  return (
    <div className={`flex min-w-0 max-w-full items-center gap-1 ${dragging ? "opacity-30" : ""}`}>
      <button
        type="button"
        disabled={locked}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail === 0) onSelect(picked);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown(event, picked);
        }}
        className="min-h-12 min-w-0 flex-1 rounded-xl border bg-white px-2 py-1 text-xs font-bold select-none"
        style={{
          touchAction: "none",
          borderColor: selected ? "var(--eb-green)" : "var(--eb-line)",
          boxShadow: selected ? "0 0 0 2px var(--eb-green)" : undefined,
          cursor: locked ? "default" : "grab",
        }}
      >
        <span className="break-all">{label}</span>{" "}
        {tier && <span className="inline-block rounded-full bg-amber-50 px-1 text-amber-800">{tier}</span>}
        {seed && <span className="ml-1 text-[10px] text-[color:var(--eb-green-text)]">SEED</span>}
      </button>
      {seed && onUnseed && (
        <button
          type="button"
          aria-label={`${label}のシードを解除`}
          disabled={locked}
          className="min-h-11 min-w-8 rounded-lg border text-sm"
          onClick={(event) => {
            event.stopPropagation();
            onUnseed();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
});

// ドラッグとタップに共通の置き場を表示する。
export const DropZone = memo(function DropZone({ zone, label, lit, locked, onZoneClick, children }: {
  zone: string;
  label: string;
  lit: boolean;
  locked: boolean;
  onZoneClick: (zone: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      data-zone={zone}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-label={label}
      aria-disabled={locked}
      onClick={() => !locked && onZoneClick(zone)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || locked) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onZoneClick(zone);
        }
      }}
      className="min-h-14 min-w-0 rounded-xl border border-dashed p-2 space-y-2"
      style={{
        borderColor: lit ? "var(--eb-green)" : "var(--eb-line)",
        background: lit ? "var(--eb-tint)" : "rgba(255,255,255,.6)",
      }}
    >
      {children}
    </div>
  );
});
