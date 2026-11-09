/**
 * ポーカーの通算順位の並べ方（standings API と CS の優先枠・段で共用。2か所に書かない）。
 * 通算チップ（scores.totalScore の合計）→ 1位回数（details.dayRank===1）→ 参加日数 → 名前。
 */
export interface PokerScoreLike {
  lineUserId: string; totalScore?: unknown; gameCategory?: unknown; displayName?: unknown; details?: { dayRank?: unknown };
}

export function rankPokerSeason(docs: PokerScoreLike[], nameOf?: (uid: string) => string): string[] {
  const agg = new Map<string, { chips: number; firsts: number; days: number; name: string }>();
  for (const x of docs) {
    if (x.gameCategory !== "poker") continue;
    const a = agg.get(x.lineUserId) ?? { chips: 0, firsts: 0, days: 0, name: typeof x.displayName === "string" ? x.displayName : "" };
    a.chips += Number(x.totalScore) || 0;
    a.days += 1;
    if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
    agg.set(x.lineUserId, a);
  }
  const name = (uid: string) => nameOf?.(uid) ?? agg.get(uid)!.name;
  return [...agg.keys()].sort((u, v) => {
    const a = agg.get(u)!, b = agg.get(v)!;
    return b.chips - a.chips || b.firsts - a.firsts || b.days - a.days || name(u).localeCompare(name(v), "ja");
  });
}
