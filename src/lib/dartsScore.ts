/**
 * ダーツの順位ポイント算出（純関数・サーバー/クライアント共用）。
 * 要件: docs/games/darts/ダーツ-ルール草案.md §3。
 *
 * - 各種目の申告値 → 順位（同値は同順位）→ 正規化ポイント（同点は平均分配 = §3.1）。
 * - クリケットはチームをポイント順に並べ、各チームが占める個人順位帯の平均を全員に付与（§3.3）。
 * - 欠席・棄権は 0pt（§3.2）で、その種目の人数(n)には数えない。
 */

import { DARTS_POINT_TABLE } from "@/types/darts";

/** 人数 n・順位 rank(1始まり) の正規化ポイント。範囲外は端に丸める。 */
export function rankPoint(n: number, rank: number): number {
  const table = DARTS_POINT_TABLE[Math.min(8, Math.max(1, n))];
  const idx = Math.min(table.length, Math.max(1, rank)) - 1;
  return table[idx];
}

export interface ScoreInput {
  id: string;
  /** 申告値。null は欠席・棄権（0pt・人数に数えない）。 */
  value: number | null;
}

export interface EventPoint {
  id: string;
  /** 種目内順位（1始まり・同順位あり）。棄権は null。 */
  rank: number | null;
  points: number;
}

/**
 * 種目の申告値から順位と正規化ポイントを算出。
 * @param higherIsBetter CU/クリケット=true、ゼロワン(残り点)=false。
 */
export function computeEventPoints(inputs: ScoreInput[], higherIsBetter: boolean): EventPoint[] {
  // 棄権（value=null）は 0pt・人数外。
  const out: EventPoint[] = inputs
    .filter((x) => x.value == null)
    .map((x) => ({ id: x.id, rank: null, points: 0 }));

  const active = inputs.filter((x): x is { id: string; value: number } => x.value != null);
  const n = active.length;
  if (n === 0) return out;

  const sorted = [...active].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));

  let i = 0;
  while (i < n) {
    // 同値のかたまり sorted[i..j] は同順位（占有順位帯 rank..rank+size-1）。
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const rank = i + 1;
    let sum = 0;
    for (let r = rank; r <= j + 1; r++) sum += rankPoint(n, r);
    const points = sum / (j - i + 1);
    for (let k = i; k <= j; k++) out.push({ id: sorted[k].id, rank, points });
    i = j + 1;
  }
  return out;
}

export interface CricketTeam {
  teamId: string;
  /** チーム最終ポイント。null は棄権（メンバー0pt）。 */
  points: number | null;
  memberIds: string[];
}

export interface CricketMemberPoint {
  id: string;
  teamId: string;
  /** チーム順位（1始まり・同順位あり）。棄権は null。 */
  teamRank: number | null;
  points: number;
}

/**
 * 多人数クリケット: チームをポイント降順に順位付けし、各チームが占める個人順位帯の平均を
 * メンバー全員に付与（§3.3）。チームの2人は同ポイント。同ポイントのチームは同順位。
 * 1人チームや8名未満でも「種目ごとの配点合計が揃う」ことが保たれる。
 */
export function computeCricketPoints(teams: CricketTeam[]): CricketMemberPoint[] {
  const out: CricketMemberPoint[] = [];
  for (const t of teams) {
    if (t.points == null) for (const id of t.memberIds) out.push({ id, teamId: t.teamId, teamRank: null, points: 0 });
  }

  const active = teams.filter((t): t is { teamId: string; points: number; memberIds: string[] } => t.points != null);
  const n = active.reduce((s, t) => s + t.memberIds.length, 0); // 総プレイヤー数
  if (n === 0) return out;

  const sorted = [...active].sort((a, b) => b.points - a.points);

  let cursor = 1; // 次に割り当てる個人順位（1始まり）
  let teamRank = 1;
  let ti = 0;
  while (ti < sorted.length) {
    // 同ポイントのチーム群 sorted[ti..tj] は同順位。合体した順位帯の平均を全員に配る。
    let tj = ti;
    while (tj + 1 < sorted.length && sorted[tj + 1].points === sorted[ti].points) tj++;
    const memberCount = sorted.slice(ti, tj + 1).reduce((s, t) => s + t.memberIds.length, 0);
    let sum = 0;
    for (let r = cursor; r < cursor + memberCount; r++) sum += rankPoint(n, r);
    const points = sum / memberCount;
    for (let k = ti; k <= tj; k++) {
      for (const id of sorted[k].memberIds) out.push({ id, teamId: sorted[k].teamId, teamRank, points });
    }
    cursor += memberCount;
    teamRank += tj - ti + 1;
    ti = tj + 1;
  }
  return out;
}

export interface PlayerDayInput {
  id: string;
  /** 3種目の合計ポイント。 */
  total: number;
  /** 種目ごとの順位（欠席は null）。クリケットはチーム順位。タイブレーク用（1位数→2位数…）。 */
  ranks: (number | null)[];
}

export interface PlayerDayRank {
  id: string;
  dayRank: number;
  /** 1位を取った種目数。 */
  firstCount: number;
}

/**
 * その日の総合順位を算出。総合ポイントの降順、同点は「1位数の多い順→2位数→…」（§3.4）。
 * クリケットのチーム1位は、そのチームの2人ともに1位として ranks に入っている前提。
 */
export function rankDay(players: PlayerDayInput[]): PlayerDayRank[] {
  const countRank = (ranks: (number | null)[], r: number) => ranks.filter((x) => x === r).length;

  const sorted = [...players].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // タイブレーク: 1位数→2位数→… の多い順（最大8種目分まで見れば十分）。
    for (let r = 1; r <= 8; r++) {
      const d = countRank(b.ranks, r) - countRank(a.ranks, r);
      if (d !== 0) return d;
    }
    return 0;
  });

  const out: PlayerDayRank[] = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    // 完全同着（総合・各順位数すべて同じ）は同順位。
    if (i > 0) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const tie =
        prev.total === cur.total &&
        Array.from({ length: 8 }, (_, k) => k + 1).every((r) => countRank(prev.ranks, r) === countRank(cur.ranks, r));
      if (!tie) rank = i + 1;
    }
    out.push({ id: sorted[i].id, dayRank: rank, firstCount: countRank(sorted[i].ranks, 1) });
  }
  return out;
}
