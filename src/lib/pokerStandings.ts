/**
 * ポーカーの通算順位の並べ方（standings API で使う）。本体は種目共通の rankSeasonScores（src/lib/seasonRanking.ts）。
 * 通算チップ（scores.totalScore の合計）→ 1位回数（details.dayRank===1）→ 参加日数 → 名前。
 */
import { rankSeasonScores, type SeasonScoreLike } from "@/lib/seasonRanking";

export type PokerScoreLike = SeasonScoreLike;

export const rankPokerSeason = (docs: PokerScoreLike[], nameOf?: (uid: string) => string): string[] =>
  rankSeasonScores(docs, "poker", nameOf);
