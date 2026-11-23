/** CSの参加資格・本人の段と順位・優先枠を種目ごとに求める（サーバー専用）。 */
import { getDb } from "@/lib/firebaseAdmin";
import { hasPlayedMahjongLeague } from "@/lib/mahjongCsServer";
import { rankSeasonScores, type SeasonScoreLike } from "@/lib/seasonRanking";
import { pokerTierForRank } from "@/types/poker";
import { dartsTierForRank } from "@/types/darts";
import { CS_RULES, type CsGame } from "@/lib/gameCsRules";
import type { MahjongLeagueAssignment } from "@/types";

/** リーグの順位が無い人の順位（並びの末尾） */
export const NON_LEAGUE_RANK = 100000;

const byIsoDesc = (a?: string, b?: string) => (b ?? "").localeCompare(a ?? "");

async function latestMahjongAssignment(seasonId: string): Promise<MahjongLeagueAssignment | undefined> {
  const snap = await getDb().collection("mahjongLeagueAssignments").where("seasonId", "==", seasonId).get();
  return snap.docs.map((d) => d.data() as MahjongLeagueAssignment).sort((a, b) => byIsoDesc(a.confirmedAt, b.confirmedAt))[0];
}

type ScoreGame = Exclude<CsGame, "mahjong">;
const TIER_FOR_RANK: Record<ScoreGame, (rank: number) => string> = { poker: pokerTierForRank, darts: dartsTierForRank };

// ponytail: シーズンの scores を全件読む。参加表明と作成のときだけ呼ぶ（ポーリングでは呼ばない）
async function seasonOrder(game: ScoreGame, seasonId: string): Promise<string[]> {
  const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();
  return rankSeasonScores(snap.docs.map((d) => d.data() as SeasonScoreLike), game);
}

export async function hasPlayedLeague(game: CsGame, seasonId: string, lineUserId: string): Promise<boolean> {
  if (game === "mahjong") return hasPlayedMahjongLeague(seasonId, lineUserId);
  const snap = await getDb().collection("scores")
    .where("seasonId", "==", seasonId).where("lineUserId", "==", lineUserId).limit(1).get();
  return !snap.empty;
}

export async function leagueStanding(game: CsGame, seasonId: string, lineUserId: string): Promise<{ tier: string; rank: number }> {
  if (game === "mahjong") {
    const mine = (await latestMahjongAssignment(seasonId))?.entries.find((e) => e.lineUserId === lineUserId);
    return mine ? { tier: mine.tier, rank: mine.rank } : { tier: "M3", rank: NON_LEAGUE_RANK };
  }
  const i = (await seasonOrder(game, seasonId)).indexOf(lineUserId);
  return i < 0 ? { tier: CS_RULES[game].tierLabels[2], rank: NON_LEAGUE_RANK } : { tier: TIER_FOR_RANK[game](i + 1), rank: i + 1 };
}

export async function fetchPriorityUserIds(game: CsGame, seasonId: string): Promise<string[]> {
  if (game === "mahjong") {
    return ((await latestMahjongAssignment(seasonId))?.entries ?? [])
      .filter((e) => e.tier === "M1" || e.tier === "M2").map((e) => e.lineUserId);
  }
  return (await seasonOrder(game, seasonId)).slice(0, 8);
}
