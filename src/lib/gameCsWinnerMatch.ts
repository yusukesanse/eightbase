/**
 * 勝った人を申告する種目（ビリヤード）のCSの1卓の判定。純関数（Firestore 非依存）。
 * 卓の2人がそれぞれ「勝ったのは誰か」を申告し、一致したら確定。食い違ったら確認待ち（disputed）で卓が止まる。
 * 確定するまでは出し直せる（disputed からでも。一致すればそのまま確定）。
 * 確定した卓は 勝者 points 1・rank 1 / 敗者 points 0・rank 2 を入れ、勝ち上がりは他種目と同じ処理（札）に渡す。
 */
import type { MahjongCsMatch, MahjongCsMatchPlayer, MahjongCsRound } from "@/types";

type P = MahjongCsMatchPlayer;

/** 勝者を決めて結果を入れる（申告の一致・管理者の確定・デモの自動進行で共用）。 */
export function settleWinner(players: P[], winnerId: string): P[] {
  return players.map((p) => (p.lineUserId === winnerId ? { ...p, points: 1, rank: 1 } : { ...p, points: 0, rank: 2 }));
}

export type ClaimResult =
  | { ok: true; match: MahjongCsMatch }
  | { ok: false; reason: "completed" | "notInMatch" | "badWinner" };

/** reporterId が「勝ったのは winnerId」と申告した後の卓を返す（元の卓は書き換えない）。 */
export function claimWinner(match: MahjongCsMatch, reporterId: string, winnerId: string): ClaimResult {
  if (match.status === "completed") return { ok: false, reason: "completed" };
  const ids = match.players.map((p) => p.lineUserId);
  if (!ids.includes(reporterId)) return { ok: false, reason: "notInMatch" };
  if (!ids.includes(winnerId)) return { ok: false, reason: "badWinner" };
  const claims = { ...(match.claims ?? {}), [reporterId]: winnerId };
  const said = ids.map((id) => claims[id]);
  if (said.some((w) => w === undefined)) return { ok: true, match: { ...match, claims, status: "reporting" } };
  if (said.some((w) => w !== said[0])) return { ok: true, match: { ...match, claims, status: "disputed" } };
  return { ok: true, match: { ...match, claims, status: "completed", players: settleWinner(match.players, winnerId) } };
}

/** 表彰: 決勝（最後のラウンド）の勝者が金・敗者が銀、3位決定戦の勝者が銅。3位決定戦が無ければ銅は null。 */
export function winnerPodium(rounds: MahjongCsRound[]): { gold: string | null; silver: string | null; bronze: string | null } {
  const at = (match: MahjongCsMatch | undefined, rank: number) => match?.players.find((p) => p.rank === rank)?.lineUserId ?? null;
  const final = rounds[rounds.length - 1]?.matches[0];
  const third = rounds.find((r) => r.type === "third")?.matches[0];
  return { gold: at(final, 1), silver: at(final, 2), bronze: at(third, 1) };
}

/**
 * 旧形式（capacity なし）のビリヤードCSの選手の着順。結果は won にあり、rank はリーグのシード順位なので使わない。
 * won が無い（新形式の）選手は undefined。表示だけに使う。
 */
export function legacyWinRank(p: object): number | null | undefined {
  if (!("won" in p)) return undefined;
  return p.won === true ? 1 : p.won === false ? 2 : null;
}
