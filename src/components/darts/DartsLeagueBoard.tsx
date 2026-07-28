"use client";

import { useEffect, useState } from "react";
import { GamePlayerHistorySheet } from "@/components/GamePlayerHistorySheet";
import { GameLeagueBoard, type GameLeagueStanding } from "@/components/games/GameLeagueBoard";
import { DARTS_ACCENT } from "@/components/darts/dartsShared";

/**
 * ダーツ リーグボード（通算pt順・tier D1(1-4)/D2(5-8)/D3(9+)）。
 * 表示は **全種目共通の `GameLeagueBoard`（麻雀と同じ3Dピラミッド）**。種目独自のヒーローは持たない。
 * データは /api/darts/standings。
 */

type Tier = "D1" | "D2" | "D3";

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
  trend: number[]; // 開催日順の累積pt推移（スパークライン）
}
interface StandingsResp {
  standings: Standing[];
  me: { rank: number; tier: Tier; totalPt: number; games: number; firsts: number; gapToD1: number } | null;
  counts: { D1: number; D2: number; D3: number };
}

export function DartsLeagueBoard() {
  const [data, setData] = useState<StandingsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/darts/standings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive && !d.error) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  // ⚠️ 通算順位はポーリングしない。
  // /api/{game}/standings は **scores をシーズン全件スキャン**するため、15秒ポーリングだと
  // 閲覧者×開催数に比例して読み取りが膨張する（過去に無料枠5万件/日を焼き切った実績あり）。
  // 順位が動くのは「本日終了」を押した瞬間だけなので、マウント時の取得で十分。

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }

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
        tierKeys={["D1", "D2", "D3"]}
        unit="pt"
        ariaLabel="ダーツリーグの3Dピラミッド"
        footnote="順位は各ゲームの着順ptを通算。同ptの場合は1位回数 → 出場数 → 名前順。1開催8名・ゼロワン → カウントアップ → クリケット。"
        onSelectPlayer={setHistoryId}
      />
      {historyId && (
        <GamePlayerHistorySheet
          lineUserId={historyId}
          gameCategory="darts"
          accent={DARTS_ACCENT}
          onClose={() => setHistoryId(null)}
        />
      )}
    </>
  );
}
