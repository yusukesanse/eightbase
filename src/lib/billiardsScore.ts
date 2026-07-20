/**
 * ビリヤードの得点・順位算出（純関数・サーバー/クライアント共用）。
 * 要件: docs/games/billiards/ビリヤード-ルール草案.md §3〜§4。
 *
 * - 1試合: 勝者=BILLIARDS_WINNER_POINTS(14) / 敗者=落とした玉数(0〜7)。
 * - 当日/シーズンは各試合の points を累積。順位=通算点の降順、同点は 勝利数→対戦数→名前順。
 */

import { BILLIARDS_WINNER_POINTS } from "@/types/billiards";

export interface BilliardsMatchInput {
  winnerId: string;
  loserId: string;
  loserBalls: number;
}

export interface BilliardsPlayerDay {
  lineUserId: string;
  points: number;
  wins: number;
  losses: number;
  matches: { result: "win" | "lose"; points: number; opponentId: string }[];
}

/**
 * 当日の試合ログから、参加者ごとの当日成績（点/勝敗/試合明細）を算出。
 * participantIds に居ない選手がログに出た場合も安全に集計する（保険）。
 */
export function computeBilliardsDay(
  matches: BilliardsMatchInput[],
  participantIds: string[]
): BilliardsPlayerDay[] {
  const map = new Map<string, BilliardsPlayerDay>();
  const ensure = (id: string): BilliardsPlayerDay => {
    let p = map.get(id);
    if (!p) {
      p = { lineUserId: id, points: 0, wins: 0, losses: 0, matches: [] };
      map.set(id, p);
    }
    return p;
  };
  for (const id of participantIds) ensure(id);

  for (const m of matches) {
    const w = ensure(m.winnerId);
    const l = ensure(m.loserId);
    const lb = Math.max(0, Math.floor(m.loserBalls));
    w.points += BILLIARDS_WINNER_POINTS;
    w.wins += 1;
    w.matches.push({ result: "win", points: BILLIARDS_WINNER_POINTS, opponentId: m.loserId });
    l.points += lb;
    l.losses += 1;
    l.matches.push({ result: "lose", points: lb, opponentId: m.winnerId });
  }
  return Array.from(map.values());
}

export interface BilliardsRankInput {
  id: string;
  points: number;
  wins: number;
  games: number;
  name: string;
}

/**
 * 順位付け。通算点の降順 → 勝利数 → 対戦数 → 名前(ja) 順。
 * 名前まで含めて必ず一意に決まるため、順位は連番（同順位を作らない）。
 * @returns id → rank（1始まり）
 */
export function rankBilliards(players: BilliardsRankInput[]): { id: string; rank: number }[] {
  const sorted = [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.games !== a.games) return b.games - a.games;
    return a.name.localeCompare(b.name, "ja");
  });
  return sorted.map((p, i) => ({ id: p.id, rank: i + 1 }));
}
