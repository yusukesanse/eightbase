"use client";

import type React from "react";
import clsx from "clsx";

export type EbButtonVariant = "primary" | "ink" | "pay" | "secondary" | "danger" | "ghost";

export interface EbButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: EbButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<EbButtonVariant, string> = {
  primary: "bg-[color:var(--eb-green)] text-white",
  ink: "bg-[color:var(--eb-ink)] text-white",
  pay: "bg-[color:var(--eb-gold)] text-[color:var(--eb-ink)]",
  secondary:
    "border-2 border-[color:var(--eb-green)] bg-white/60 text-[color:var(--eb-green)]",
  danger: "bg-[color:var(--eb-coral)] text-white",
  ghost: "border border-[color:var(--eb-line)] bg-white/60 text-[color:var(--eb-ink)]",
};

export function Button({
  variant = "primary",
  loading = false,
  fullWidth = true,
  disabled,
  className,
  children,
  ...buttonProps
}: EbButtonProps): JSX.Element {
  const isDisabled = disabled || loading;

  return (
    <button
      {...buttonProps}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={clsx(
        "h-14 items-center justify-center rounded-2xl px-4 text-[17px] font-bold transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        fullWidth ? "flex w-full" : "inline-flex",
        VARIANT_CLASSES[variant],
        className
      )}
    >
      {loading ? "…" : children}
    </button>
  );
}
