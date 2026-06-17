"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * プレビューモード時に画面上部に表示される固定バナー
 * httpOnly Cookie を専用 API で確認して表示/非表示を切り替え
 */
export function PreviewBanner() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // iframe 内では表示しない（プレビューのiPhoneフレーム内など）
    if (window.self !== window.top) return;

    let cancelled = false;
    fetch("/api/preview/activate", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setVisible(data.active === true);
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!visible) return null;

  const isAdmin = pathname.startsWith("/admin");

  return (
    <div
      className="sticky top-0 z-[100] text-center text-[11px] py-1.5 font-medium"
      style={{
        background: isAdmin ? "#1a1a2e" : "#231714",
        color: "#fff",
        borderBottom: "2px solid #B0E401",
      }}
    >
      プレビューモード（読み取り専用 / サンプルデータ）
      <button
        onClick={async () => {
          await fetch("/api/preview/activate", { method: "DELETE" });
          setVisible(false);
          window.location.href = "/preview";
        }}
        className="ml-3 underline opacity-70 hover:opacity-100"
      >
        終了
      </button>
    </div>
  );
}
