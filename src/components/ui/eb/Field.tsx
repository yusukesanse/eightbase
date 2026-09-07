"use client";

import type React from "react";

export const inputClass: string =
  "h-14 w-full rounded-2xl bg-white px-4 text-[17px] text-[color:var(--eb-ink)] placeholder:text-[#9AA39E] border border-[color:var(--eb-line)] focus:outline-none focus:border-[color:var(--eb-green)] focus:border-2";

export interface EbFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, required = false, error, hint, children }: EbFieldProps): JSX.Element {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[14px] font-bold text-[color:var(--eb-ink)]">{label}</span>
        {required && (
          <span className="rounded-md bg-[rgba(217,72,58,.14)] px-1.5 py-0.5 text-[10px] font-bold text-[color:var(--eb-coral-text)]">
            必須
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
