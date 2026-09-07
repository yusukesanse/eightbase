"use client";

import { useRouter } from "next/navigation";
import { MahjongLeagueView } from "@/components/mahjong/MahjongLeagueView";
import { PageBg, PageHeading } from "@/components/ui/eb";

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
    <PageBg>
      <header className="px-5 pt-[52px] pb-3 flex items-center gap-3">
        <button
          onClick={goBack}
          aria-label="戻る"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--eb-tint)] text-[color:var(--eb-ink)]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <PageHeading title="MAHJONG" subtitle="麻雀リーグ" />
      </header>
      <div className="px-4 pb-4">
        <MahjongLeagueView />
      </div>
    </PageBg>
  );
}
