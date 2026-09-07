"use client";

import type React from "react";
import clsx from "clsx";

export interface EbGlassCardProps {
  tone?: "default" | "green" | "gold" | "coral";
  padding?: "md" | "lg";
  className?: string;
  children: React.ReactNode;
}

const TONE_STYLES: Record<Exclude<NonNullable<EbGlassCardProps["tone"]>, "default">, React.CSSProperties> = {
  green: { borderColor: "var(--eb-green)", borderWidth: "2px" },
  gold: { borderColor: "var(--eb-gold)", borderWidth: "2px" },
  coral: { borderColor: "var(--eb-coral)", borderWidth: "2px" },
};

export function GlassCard({
  tone = "default",
  padding = "lg",
  className,
  children,
}: EbGlassCardProps): JSX.Element {
  return (
    <div
      className={clsx("eb-glass rounded-[20px]", padding === "md" ? "p-4" : "p-5", className)}
      style={tone === "default" ? undefined : TONE_STYLES[tone]}
    >
      {children}
    </div>
  );
}
