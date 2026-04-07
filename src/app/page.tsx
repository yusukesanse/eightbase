"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { initLiff } from "@/lib/liff";

/**
 * ホームページ。
 * LIFF URL のエンドポイントとして最初に開かれるため、
 * liff.init() を完了させてから /reservation へ遷移する。
 *
 * ⚠️ サーバーサイドの redirect() を使うと、LINE が付与する
 *   liff.state 等のクエリパラメータが失われ、LIFF SDK の
 *   OAuth フローが完了できずリダイレクトループになる。
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    initLiff()
      .then(() => {
        router.replace("/reservation");
      })
      .catch((err) => {
        console.error("[HomePage] LIFF init failed:", err);
        // LIFF 初期化に失敗しても予約ページへ遷移（ログイン画面に転送される）
        router.replace("/reservation");
      });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-10 h-10 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
