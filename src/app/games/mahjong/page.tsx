"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import type { MahjongStanding } from "@/types";

/**
 * ミニアプリ 麻雀リーグ ページ（本番・LINEログイン必須）
 * 通算アベレージのピラミッド順位表を表示。自分を動的にハイライト。
 */
export default function MahjongLeaguePage() {
  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/mahjong/standings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setStandings(d.standings ?? []);
        setCurrentUserId(d.currentUserId);
      })
      .catch(() => setStandings([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <header className="px-4 pt-5 pb-3 flex items-center gap-2">
        <Link href="/games" className="text-sm text-[#231714]/50 hover:text-[#231714]/80">
          ←
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#231714]">麻雀リーグ</h1>
          <p className="text-xs text-[#231714]/50 mt-0.5">通算アベレージ順位</p>
        </div>
      </header>

      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
          </div>
        ) : standings.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
            まだ成績が登録されていません
          </div>
        ) : (
          <LeaguePyramid standings={standings} currentUserId={currentUserId} />
        )}
      </div>
    </div>
  );
}
