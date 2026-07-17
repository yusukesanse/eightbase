"use client";

import { useEffect } from "react";

/**
 * デザインハンドオフ準拠のボトムシート。
 * スクリム rgba(28,31,33,0.38)、上スライド（ebSheetUp）。メンバー一覧・掲示板の詳細シートで共用。
 */

const SCRIM = "rgba(28,31,33,0.38)";

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="閉じる"
      className="w-8 h-8 -mr-1.5 rounded-full flex items-center justify-center text-[#45484d] hover:bg-[#f6f8f9] transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export function BottomSheet({
  open,
  title,
  onClose,
  footer,
  children,
  closeButton = true,
  dismissible = true,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeButton?: boolean;
  /** false ならスクリム/Escでは閉じない（明示ボタンのみ）。 */
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: SCRIM, animation: "ebFadeIn 160ms ease-out" }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-2xl shadow-xl flex flex-col"
        style={{ maxHeight: "88vh", animation: "ebSheetUp 280ms cubic-bezier(0.2,0,0.2,1)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pt-2.5 px-5 shrink-0">
          <div className="mx-auto h-1 w-9 rounded-full bg-[#e4e7e9]" />
          {(title || closeButton) && (
            <div className="flex items-center justify-between mt-3">
              <h2 className="text-[16px] font-bold text-[#1c1f21]">{title}</h2>
              {closeButton && <CloseButton onClose={onClose} />}
            </div>
          )}
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div
            className="px-5 py-3 border-t border-[#eceff1] flex gap-3 shrink-0"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
