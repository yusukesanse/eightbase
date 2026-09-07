"use client";

import { Button, GlassCard, PageBg } from "@/components/ui/eb";

/** 認証失敗時は自動遷移せず、利用者の操作で再試行する。 */
export function AuthRecovery({ title, message, onRetry, retryLabel = "もう一度試す" }: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <PageBg className="flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <GlassCard>
          <div role="alert" className="text-center">
            <h1 className="text-xl font-bold text-[color:var(--eb-ink)]">{title}</h1>
            <p className="mt-3 mb-6 text-sm leading-relaxed text-[color:var(--eb-ink-muted)]">{message}</p>
            <Button type="button" onClick={onRetry}>{retryLabel}</Button>
          </div>
        </GlassCard>
      </div>
    </PageBg>
  );
}
