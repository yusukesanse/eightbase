"use client";

import { useEffect, useState } from "react";
import { GamePlayerHistorySheet } from "@/components/GamePlayerHistorySheet";
import { GameLeagueBoard, type GameLeagueStanding } from "@/components/games/GameLeagueBoard";
import { POKER_ACCENT } from "@/components/poker/pokerShared";
import { type PokerTier } from "@/types/poker";

/**
 * ポーカー リーグボード（通算チップ合計順・tier P1(1-4)/P2(5-8)/P3(9+)）。
 * 表示は **全種目共通の `GameLeagueBoard`（麻雀と同じ3Dピラミッド）**。種目独自のヒーローは持たない。
 * データは GET /api/poker/standings。
 */

interface Standing {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalChips: number;
  days: number;
  firsts: number;
  tier: PokerTier;
  isMe: boolean;
  trend: number[];
}

export function PokerLeagueBoard() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/poker/standings", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStandings(d.standings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const rows: GameLeagueStanding[] = standings.map((s) => ({
    rank: s.rank,
    lineUserId: s.lineUserId,
    displayName: s.displayName,
    pictureUrl: s.pictureUrl,
    isMe: s.isMe,
    value: s.totalChips,
    subText: `出場 ${s.days}回 ・ 1位 ${s.firsts}回`,
    trend: s.trend,
  }));

  return (
    <>
      <GameLeagueBoard
        standings={rows}
        tierKeys={["P1", "P2", "P3"]}
        unit="Chips"
        ariaLabel="ポーカーリーグの3Dピラミッド"
        emptyText="まだ成績がありません。開催日に参加してチップを集めましょう。"
        footnote="順位は各開催の獲得チップを通算。同チップの場合は1位回数 → 出場数 → 名前順。"
        onSelectPlayer={setHistoryId}
      />
      {historyId && (
        <GamePlayerHistorySheet
          lineUserId={historyId}
          gameCategory="poker"
          accent={POKER_ACCENT}
          onClose={() => setHistoryId(null)}
        />
      )}
    </>
  );
}
