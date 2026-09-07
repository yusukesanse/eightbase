"use client";

import type React from "react";
import clsx from "clsx";

export type EbStatusTone = "green" | "gold" | "coral" | "muted";

export interface EbStatusPillProps {
  tone: EbStatusTone;
  children: React.ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<EbStatusTone, string> = {
  green: "bg-[rgba(35,147,94,.14)] text-[color:var(--eb-green-text)]",
  gold: "bg-[rgba(217,169,58,.18)] text-[color:var(--eb-gold-text)]",
  coral: "bg-[rgba(217,72,58,.14)] text-[color:var(--eb-coral-text)]",
  muted: "bg-[color:var(--eb-tint)] text-[#5F6663]",
};

export function StatusPill({ tone, children, className }: EbStatusPillProps): JSX.Element {
  return (
    <span
      className={clsx(
        "inline-block shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] max-[400px]:text-[12px] max-[360px]:text-[11px] font-bold",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
