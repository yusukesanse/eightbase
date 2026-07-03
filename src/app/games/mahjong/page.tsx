"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MahjongLeagueView } from "@/components/mahjong/MahjongLeagueView";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";

/**
 * 麻雀リーグ画面（利用者・RichMenu 主導線）。
 * 実体は正典UIの共通コンポーネントを再利用する薄いラッパー:
 *  - リーグ（順位/参加/申告・参加費決済） … MahjongLeagueView
 *  - チャンピオンシップ                    … MahjongCsView
 * ※ /info のゲームセクションと同じコンポーネントを使い、重複実装を排除。
 */

type Tab = "league" | "cs";

const TABS: { id: Tab; label: string }[] = [
  { id: "league", label: "リーグ" },
  { id: "cs", label: "チャンピオンシップ" },
];

export default function MahjongLeaguePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("league");

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/info");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white px-5 pt-12 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={goBack} aria-label="戻る" className="text-[#231714]/50 hover:text-[#231714]/80">
            ←
          </button>
          <div>
            <h1 className="text-[17px] font-medium text-[#231714]">麻雀リーグ</h1>
            <p className="text-[11px] text-[#231714]/40 mt-0.5">M.LEAGUE</p>
          </div>
        </div>
        {/* タブ */}
        <nav className="flex mt-3 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 pb-2.5 text-[13px] font-medium transition-colors ${
                tab === t.id ? "text-[#231714]" : "text-[#231714]/40"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-[15%] right-[15%] h-[2px] bg-[#A5C1C8] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-4 pt-4">
        {tab === "league" ? <MahjongLeagueView /> : <MahjongCsView />}
      </div>
    </div>
  );
}
