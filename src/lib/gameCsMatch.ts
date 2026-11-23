/**
 * 点数を申告する種目（ポーカー・ダーツ）のCSの1卓の判定。純関数（Firestore 非依存）。
 * 点数が高いほど上位。同点の追加勝負は「境目」をまたぐ同点だけ（2026-11-09 ユーザー決定）:
 *  - 決勝以外: 上位 n 名通過なら n 位と n+1 位の境目だけ（cuts = [n]）
 *  - 決勝: 1-2位・2-3位・3-4位の境目（cuts = [1, 2, 3]）
 * 追加勝負の値は tiebreakPoints[回-1]。また同点なら、その人たちだけ次の回を入れる。
 * 麻雀は持ち点と着順を申告するので使わない。
 */
import type { MahjongCsMatchPlayer } from "@/types";

type P = MahjongCsMatchPlayer;

export function cutsFor(isFinal: boolean, advanceCount: number): number[] {
  return isFinal ? [1, 2, 3] : [advanceCount];
}

export interface ScoreMatchResult {
  status: "reporting" | "tiebreak" | "completed";
  players: P[];
  tiebreakIds: string[];
  tiebreakLevel: Record<string, number>;
}

export function evaluateScoreMatch(players: P[], cuts: number[]): ScoreMatchResult {
  if (players.some((x) => x.points == null)) {
    return { status: "reporting", players, tiebreakIds: [], tiebreakLevel: {} };
  }
  // 位置 start（1始まり）から size 人の同点の組が、どれかの境目をまたぐか
  const crosses = (start: number, size: number) => cuts.some((k) => start <= k && k <= start + size - 2);
  const keyAt = (x: P, level: number): number | undefined =>
    level === 0 ? (x.points as number) : x.tiebreakPoints?.[level - 1];
  const out: P[] = [];
  const tiebreakLevel: Record<string, number> = {};

  // group は level-1 までの値がすべて等しい組
  const settle = (group: P[], pos: number, level: number) => {
    if (level > 0 && (group.length === 1 || !crosses(pos, group.length))) {
      for (const x of group) out.push({ ...x, rank: pos });
      return;
    }
    if (group.some((x) => keyAt(x, level) == null)) {
      for (const x of group) {
        tiebreakLevel[x.lineUserId] = level;
        out.push({ ...x, rank: pos });
      }
      return;
    }
    const sorted = [...group].sort((a, b) => (keyAt(b, level) as number) - (keyAt(a, level) as number));
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j < sorted.length && keyAt(sorted[j], level) === keyAt(sorted[i], level)) j++;
      settle(sorted.slice(i, j), pos + i, level + 1);
      i = j;
    }
  };
  settle(players, 1, 0);

  const tiebreakIds = Object.keys(tiebreakLevel);
  return tiebreakIds.length > 0
    ? { status: "tiebreak", players: out, tiebreakIds, tiebreakLevel }
    : { status: "completed", players: out, tiebreakIds: [], tiebreakLevel: {} };
}

/** level 回目（1始まり）の追加勝負の値を入れる。それより後の回は捨てる（入れ直し）。 */
export function withTiebreak(players: P[], lineUserId: string, level: number, value: number): P[] {
  return players.map((x) => {
    if (x.lineUserId !== lineUserId) return x;
    const tiebreakPoints = (x.tiebreakPoints ?? []).slice(0, level - 1);
    tiebreakPoints[level - 1] = value;
    return { ...x, tiebreakPoints };
  });
}

export function podiumOf(players: P[]): { gold: string | null; silver: string | null; bronze: string | null } {
  const sorted = [...players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return {
    gold: sorted[0]?.lineUserId ?? null,
    silver: sorted[1]?.lineUserId ?? null,
    bronze: sorted.length >= 3 ? sorted[2].lineUserId : null,
  };
}

/** 旧形式（capacity なし）の選手の値。ポーカーは chips、ダーツは score に入っている。表示だけに使う。 */
export function legacyPoints(p: object): number | undefined {
  const legacy = p as { chips?: number | null; score?: number | null };
  return legacy.chips ?? legacy.score ?? undefined;
}
