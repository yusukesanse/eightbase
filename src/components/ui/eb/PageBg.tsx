"use client";

import type React from "react";
import clsx from "clsx";

export interface EbPageBgProps {
  className?: string;
  children: React.ReactNode;
}

export function PageBg({ className, children }: EbPageBgProps): JSX.Element {
  return (
    <div className={clsx("min-h-screen pb-24", className)} style={{ background: "var(--eb-bg)" }}>
      {children}
    </div>
  );
}
