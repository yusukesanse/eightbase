/**
 * scores を合算する種目（ポーカー・ダーツ・ビリヤード）の通算順位の並べ方。順位表 API と CS の優先枠・段で共用する（2か所に書かない）。
 * 通算（scores.totalScore の合計）→ 1位回数（details.dayRank===1）→ 出場数 → 名前。
 */
export interface SeasonScoreLike {
  lineUserId: string; totalScore?: unknown; gameCategory?: unknown; displayName?: unknown; details?: { dayRank?: unknown };
}

export function rankSeasonScores(docs: SeasonScoreLike[], game: "poker" | "darts" | "billiards", nameOf?: (uid: string) => string): string[] {
  const agg = new Map<string, { total: number; firsts: number; days: number; name: string }>();
  for (const x of docs) {
    if (x.gameCategory !== game) continue;
    const a = agg.get(x.lineUserId) ?? { total: 0, firsts: 0, days: 0, name: typeof x.displayName === "string" ? x.displayName : "" };
    a.total += Number(x.totalScore) || 0;
    a.days += 1;
    if (x.details && Number(x.details.dayRank) === 1) a.firsts += 1;
    agg.set(x.lineUserId, a);
  }
  const name = (uid: string) => nameOf?.(uid) ?? agg.get(uid)!.name;
  return [...agg.keys()].sort((u, v) => {
    const a = agg.get(u)!, b = agg.get(v)!;
    return b.total - a.total || b.firsts - a.firsts || b.days - a.days || name(u).localeCompare(name(v), "ja");
  });
}
