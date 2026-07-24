"use client";

import { useRouter } from "next/navigation";
import { MahjongLeagueView } from "@/components/mahjong/MahjongLeagueView";

/**
 * 麻雀リーグ画面（利用者・RichMenu 主導線）。
 * 実体は正典UIの MahjongLeagueView（リーグ/参加/卓確認・申告/CS を内包）を再利用する薄いラッパー。
 * ※ /games ハブと同じコンポーネントを使い、重複実装を排除。
 */
export default function MahjongLeaguePage() {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/games");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white px-5 pt-12 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={goBack} aria-label="戻る" className="text-[#231714]/85 hover:text-[#231714]/90">
            ←
          </button>
          <div>
            <h1 className="text-[17px] font-medium text-[#231714]">麻雀リーグ</h1>
            <p className="text-[11px] text-[#231714]/80 mt-0.5">M.LEAGUE</p>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4">
        <MahjongLeagueView />
      </div>
    </div>
  );
}
