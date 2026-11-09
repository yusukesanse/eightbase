/** CSの参加資格・本人の段と順位・優先枠を種目ごとに求める（サーバー専用）。 */
import { getDb } from "@/lib/firebaseAdmin";
import { hasPlayedMahjongLeague } from "@/lib/mahjongCsServer";
import { rankPokerSeason, type PokerScoreLike } from "@/lib/pokerStandings";
import { pokerTierForRank } from "@/types/poker";
import type { CsGame } from "@/lib/gameCsRules";
import type { MahjongLeagueAssignment } from "@/types";

/** リーグの順位が無い人の順位（並びの末尾） */
export const NON_LEAGUE_RANK = 100000;

const byIsoDesc = (a?: string, b?: string) => (b ?? "").localeCompare(a ?? "");

async function latestMahjongAssignment(seasonId: string): Promise<MahjongLeagueAssignment | undefined> {
  const snap = await getDb().collection("mahjongLeagueAssignments").where("seasonId", "==", seasonId).get();
  return snap.docs.map((d) => d.data() as MahjongLeagueAssignment).sort((a, b) => byIsoDesc(a.confirmedAt, b.confirmedAt))[0];
}

// ponytail: シーズンの scores を全件読む。参加表明と作成のときだけ呼ぶ（ポーリングでは呼ばない）
async function pokerOrder(seasonId: string): Promise<string[]> {
  const snap = await getDb().collection("scores").where("seasonId", "==", seasonId).get();
  return rankPokerSeason(snap.docs.map((d) => d.data() as PokerScoreLike));
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
  const i = (await pokerOrder(seasonId)).indexOf(lineUserId);
  return i < 0 ? { tier: "P3", rank: NON_LEAGUE_RANK } : { tier: pokerTierForRank(i + 1), rank: i + 1 };
}

export async function fetchPriorityUserIds(game: CsGame, seasonId: string): Promise<string[]> {
  if (game === "mahjong") {
    return ((await latestMahjongAssignment(seasonId))?.entries ?? [])
      .filter((e) => e.tier === "M1" || e.tier === "M2").map((e) => e.lineUserId);
  }
  return (await pokerOrder(seasonId)).slice(0, 8);
}
