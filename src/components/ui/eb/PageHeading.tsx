"use client";

import type React from "react";

export interface EbPageHeadingProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function PageHeading({ title, subtitle, right }: EbPageHeadingProps): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1
          className="truncate whitespace-nowrap text-[22px] max-[360px]:text-[20px] font-bold text-[color:var(--eb-ink)]"
          style={{ fontFamily: '"Space Grotesk", "Noto Sans JP", sans-serif', fontWeight: 700 }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 truncate text-[13px] text-[color:var(--eb-ink-muted)]">{subtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
