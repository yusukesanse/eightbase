"use client";

import { useRouter } from "next/navigation";
import { DartsLeagueView } from "@/components/darts/DartsLeagueView";
import { PageBg, PageHeading } from "@/components/ui/eb";

/**
 * ダーツリーグ画面（利用者・RichMenu / ディープリンク主導線）。
 * 実体は正典UIの DartsLeagueView を再利用する薄いラッパー（/games ハブと同じ）。
 */
export default function DartsLeaguePage() {
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
        <PageHeading title="DARTS" subtitle="ダーツリーグ" />
      </header>
      <div className="px-4 pb-4">
        <DartsLeagueView />
      </div>
    </PageBg>
  );
}
