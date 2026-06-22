"use client";

import { useEffect, useState } from "react";

/**
 * demo 環境（NEXT_PUBLIC_APP_ENV=demo）でのみ画面上部に表示する固定バナー。
 * 「いま見ているのは demo であって本番ではない」という人間側の取り違えを防ぐ。
 *
 * NEXT_PUBLIC_APP_ENV はビルド時に焼き込まれるため、demo プロジェクトの
 * ビルドにだけバナーが含まれる（本番ビルドには一切出ない）。
 */
export function DemoBanner() {
  // ビルド時に値が確定するので state 初期値で判定（チラつき防止）
  const [hidden, setHidden] = useState(false);

  // iframe 内（プレビューの iPhone フレーム等）では表示しない
  useEffect(() => {
    if (typeof window !== "undefined" && window.self !== window.top) {
      setHidden(true);
    }
  }, []);

  if (process.env.NEXT_PUBLIC_APP_ENV !== "demo") return null;
  if (hidden) return null;

  return (
    <div
      className="sticky top-0 z-[100] text-center text-[11px] py-1.5 font-bold tracking-wide"
      style={{
        background: "#b48f13",
        color: "#fff",
        borderBottom: "2px solid #231714",
      }}
    >
      DEMO 環境（テスト用 / 本番ではありません）
    </div>
  );
}
