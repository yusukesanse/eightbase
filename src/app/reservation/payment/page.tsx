"use client";

import { useRouter } from "next/navigation";
import { Button, GlassCard, PageBg } from "@/components/ui/eb";

/**
 * Square 決済画面 — 現在無効
 * 決済機能が有効化されるまで、このページはアクセス不可として扱う。
 */
export default function PaymentPage() {
  const router = useRouter();

  return (
    <PageBg className="flex min-h-screen flex-col items-center justify-center px-6">
      <GlassCard tone="gold" className="max-w-xs text-center">
        <div
          className="mx-auto mb-4 flex items-center justify-center rounded-2xl"
          style={{ width: 64, height: 64, background: "rgba(217,169,58,.18)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--eb-gold-text)" strokeWidth="1.5">
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h1 className="mb-2 text-[17px] font-bold text-[color:var(--eb-ink)]">オンライン決済は現在準備中です</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
          有料施設のオンライン予約は現在ご利用いただけません。ご利用をご希望の場合は管理者にお問い合わせください。
        </p>
        <Button variant="ink" onClick={() => router.replace("/reservation")}>
          施設予約に戻る
        </Button>
      </GlassCard>
    </PageBg>
  );
}
