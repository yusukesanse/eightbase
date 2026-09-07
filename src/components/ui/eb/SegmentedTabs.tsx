"use client";

import clsx from "clsx";

export interface EbSegmentedTabItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface EbSegmentedTabsProps {
  items: EbSegmentedTabItem[];
  value: string;
  onChange: (id: string) => void;
  size?: "lg" | "md";
  className?: string;
}

export function SegmentedTabs({
  items,
  value,
  onChange,
  size = "lg",
  className,
}: EbSegmentedTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      className={clsx(
        "flex gap-1 rounded-[14px] bg-transparent p-1",
        // 狭い画面では文字を小さくして折り返しを防ぐ（改行させない・ユーザー指示）
        size === "lg"
          ? "h-12 text-[15px] max-[400px]:text-[14px] max-[360px]:text-[13px]"
          : "h-11 text-[14px] max-[400px]:text-[13px] max-[360px]:text-[12px]",
        className
      )}
    >
      {items.map((item) => {
        const selected = value === item.id;

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) onChange(item.id);
            }}
            className={clsx(
              "flex-1 min-w-0 whitespace-nowrap px-1 rounded-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "bg-white font-bold text-[color:var(--eb-ink)] shadow-[0_2px_8px_rgba(20,41,31,.10)]"
                : "bg-transparent font-medium text-[rgba(26,29,27,.6)]"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
