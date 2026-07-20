"use client";

import { useRouter } from "next/navigation";
import { BilliardsLeagueView } from "@/components/billiards/BilliardsLeagueView";

/**
 * ビリヤードリーグ画面（利用者・RichMenu / ディープリンク主導線）。
 * 実体は正典UIの BilliardsLeagueView を再利用する薄いラッパー（/info のゲームセクションと同じ）。
 */
export default function BilliardsLeaguePage() {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/info");
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
            <h1 className="text-[17px] font-medium text-[#231714]">ビリヤードリーグ</h1>
            <p className="text-[11px] text-[#231714]/80 mt-0.5">BILLIARDS LEAGUE</p>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4">
        <BilliardsLeagueView />
      </div>
    </div>
  );
}
