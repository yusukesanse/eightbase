"use client";

import { useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { GamePlayerHistorySheet } from "@/components/GamePlayerHistorySheet";
import { GameLeagueBoard, type GameLeagueStanding } from "@/components/games/GameLeagueBoard";
import { BILLIARDS_ACCENT } from "@/components/billiards/billiardsShared";

/**
 * ビリヤード リーグボード（通算pt順・tier B1(1-4)/B2(5-8)/B3(9+)）。
 * 表示は **全種目共通の `GameLeagueBoard`（麻雀と同じ3Dピラミッド）**。種目独自のヒーローは持たない。
 * データは /api/billiards/standings。
 */

type Tier = "B1" | "B2" | "B3";

interface Standing {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  games: number;
  firsts: number;
  tier: Tier;
  isMe: boolean;
  trend: number[];
}
interface Me { rank: number; tier: Tier; totalPt: number; games: number; firsts: number; gapToB1: number }
interface Resp { standings: Standing[]; me: Me | null; counts: { B1: number; B2: number; B3: number } }

export function BilliardsLeagueBoard() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/billiards/standings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive && !d.error) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useAutoRefresh(() => fetch("/api/billiards/standings", { credentials: "include" }).then((r) => r.json()).then((d) => !d.error && setData(d)).catch(() => {}), 15000);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;

  const rows: GameLeagueStanding[] = (data?.standings ?? []).map((s) => ({
    rank: s.rank,
    lineUserId: s.lineUserId,
    displayName: s.displayName,
    pictureUrl: s.pictureUrl,
    isMe: s.isMe,
    value: s.totalPt,
    subText: `出場 ${s.games}回 ・ 1位 ${s.firsts}回`,
    trend: s.trend,
  }));

  return (
    <>
      <GameLeagueBoard
        standings={rows}
        tierKeys={["B1", "B2", "B3"]}
        unit="pt"
        ariaLabel="ビリヤードリーグの3Dピラミッド"
        footnote="順位は各試合の獲得ptを通算。同ptの場合は勝利数 → 対戦数 → 名前順。エイトボール1対1・勝者14pt / 敗者=落とした玉数。"
        onSelectPlayer={setHistoryId}
      />
      {historyId && <GamePlayerHistorySheet lineUserId={historyId} gameCategory="billiards" accent={BILLIARDS_ACCENT} onClose={() => setHistoryId(null)} />}
    </>
  );
}
