/**
 * ポーカーの順位・当日集計（純関数・サーバー/クライアント共用）。
 * 要件: docs/games/poker/ポーカー-ルール草案.md §4〜§5。
 *
 * - 1試合の順位 = 終了時チップ数の降順（同チップは同順位＝競技順位。1,2,2,4）。
 * - 当日/シーズンは各試合の終了時チップを **合計**（totalChips）。順位はその合計の降順。
 * - 集計は reports にいる人だけを数える。ディーラーもプレイヤーなので reports に入る（2026-11-26〜）。
 *   それより前の試合の reports はディーラー抜きで、その人のその試合は数えない（過去データはそのまま正しい）。
 */

export interface PokerRankInput {
  id: string;
  chips: number;
  name: string;
}

/**
 * チップ数で順位付け（降順・同点同順位＝競技順位）。
 * name はタイブレークではなく並びの安定化のみに使う（順位は chips のみで決まる）。
 * @returns id → rank（1始まり。同チップは同順位、その分だけ次の順位が飛ぶ）
 */
export function rankByChips(players: PokerRankInput[]): { id: string; rank: number }[] {
  return players.map((p) => ({
    id: p.id,
    rank: 1 + players.filter((q) => q.chips > p.chips).length,
  }));
}

export interface PokerGameInput {
  gameIndex: number;
  dealerId: string;
  /** プレイヤーの終了時チップ。キー=lineUserId（ディーラーも含む。過去の試合はディーラー抜き）。 */
  reports: Record<string, number>;
}

export interface PokerPlayerDay {
  lineUserId: string;
  totalChips: number;
  gamesPlayed: number;
  games: { gameIndex: number; chips: number; rank: number }[];
}

/**
 * 当日の全試合（confirmed のもの）から、参加者ごとの当日成績を算出。
 * - totalChips = 参加した試合の終了時チップの合計。
 * - 各試合の rank はその試合の reports にいる人の中で算出。
 * - reports にいない試合（過去データでディーラーだった試合）はその人の集計に含めない（gamesPlayed も加算しない）。
 */
export function computePokerDay(
  games: PokerGameInput[],
  participants: { lineUserId: string; displayName: string }[]
): PokerPlayerDay[] {
  const nameById = new Map(participants.map((p) => [p.lineUserId, p.displayName]));
  const acc = new Map<string, PokerPlayerDay>();
  const ensure = (id: string): PokerPlayerDay => {
    let p = acc.get(id);
    if (!p) {
      p = { lineUserId: id, totalChips: 0, gamesPlayed: 0, games: [] };
      acc.set(id, p);
    }
    return p;
  };
  for (const p of participants) ensure(p.lineUserId);

  for (const g of games) {
    const inputs: PokerRankInput[] = Object.entries(g.reports).map(([id, chips]) => ({
      id,
      chips,
      name: nameById.get(id) ?? id,
    }));
    const rankById = new Map(rankByChips(inputs).map((r) => [r.id, r.rank]));
    for (const { id, chips } of inputs) {
      const p = ensure(id);
      p.totalChips += chips;
      p.gamesPlayed += 1;
      p.games.push({ gameIndex: g.gameIndex, chips, rank: rankById.get(id) ?? 0 });
    }
  }
  return Array.from(acc.values());
}
