"use client";

import { useRouter } from "next/navigation";

/**
 * Square 決済画面 — 現在無効
 * 決済機能が有効化されるまで、このページはアクセス不可として扱う。
 */
export default function PaymentPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-xs">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5">
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h1 className="text-base font-bold text-[#231714] mb-2">オンライン決済は現在準備中です</h1>
        <p className="text-xs text-[#231714]/85 leading-relaxed mb-6">
          有料施設のオンライン予約は現在ご利用いただけません。ご利用をご希望の場合は管理者にお問い合わせください。
        </p>
        <button
          onClick={() => router.replace("/reservation")}
          className="w-full py-3 rounded-xl text-sm font-medium bg-[#231714] text-white"
        >
          施設予約に戻る
        </button>
      </div>
    </div>
  );
}
