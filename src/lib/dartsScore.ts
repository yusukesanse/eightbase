/**
 * ダーツの順位ポイント算出（純関数・サーバー/クライアント共用）。
 * 要件: docs/games/darts/ダーツ-ルール草案.md §3。
 *
 * - 各種目の申告値 → 順位（同値は同順位）→ 正規化ポイント（同点は平均分配 = §3.1）。
 * - クリケットはチームをポイント順に並べ、各チームが占める個人順位帯の平均を全員に付与（§3.3）。
 * - 欠席・棄権は 0pt（§3.2）で、その種目の人数(n)には数えない。
 */

import { DARTS_POINT_TABLE, DARTS_EVENT_ORDER } from "@/types/darts";
import { isSafeTeamId } from "@/lib/dartsEntryValidation";

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
/** 順位ポイントの取りうる範囲（最大 8）。 */
const POINTS_MAX = 8;

/**
 * 管理スコアAPIの darts details 検証（新スキーマ events[]/dayRank/firstCount と旧 rank/points）。
 * totalScore を渡すと points 合計との整合も検証する。妥当なら null、エラー時はメッセージ。
 *
 * 新スキーマの保証:
 *  - events は zeroOne / countUp / cricket が各1件（計3件・DARTS_EVENT_ORDER 順）
 *  - points は有限で 0〜8 / value は null か 0以上の整数 / rank は null か 1〜8 の整数
 *  - dayRank は 1〜8 / firstCount は 0〜3 の整数で、rank===1 の件数と一致
 *  - teamId は cricket のみ許可し、値は isSafeTeamId を満たす
 *  - totalScore（指定時）は points 合計と許容誤差内で一致
 */
export function validateDartsScoreDetails(details: Record<string, unknown>, totalScore?: number): string | null {
  if ("events" in details && details.events !== undefined) {
    const events = details.events;
    if (!Array.isArray(events)) return "ダーツ: events は配列が必要です";
    if (events.length !== DARTS_EVENT_ORDER.length) {
      return `ダーツ: events は3種目（${DARTS_EVENT_ORDER.join(" / ")}）が必要です`;
    }
    const seen = new Set<string>();
    let firstsFromRank = 0;
    let pointsSum = 0;
    for (const e of events as Array<Record<string, unknown>>) {
      if (!e || typeof e !== "object") return "ダーツ: 各種目はオブジェクトです";
      const kind = e.kind;
      if (typeof kind !== "string" || !(DARTS_EVENT_ORDER as readonly string[]).includes(kind)) {
        return `ダーツ: 不明な種目 kind です（${DARTS_EVENT_ORDER.join(" / ")} のみ）`;
      }
      if (seen.has(kind)) return `ダーツ: 種目 ${kind} が重複しています`;
      seen.add(kind);
      if (!isFiniteNum(e.points) || e.points < 0 || e.points > POINTS_MAX) {
        return `ダーツ: ${kind} の points は 0〜${POINTS_MAX} の数値が必要です`;
      }
      pointsSum += e.points;
      if (e.value !== null && e.value !== undefined && !isIntIn(e.value, 0, Number.MAX_SAFE_INTEGER)) {
        return `ダーツ: ${kind} の value は null か0以上の整数です`;
      }
      if (e.rank !== null && e.rank !== undefined) {
        if (!isIntIn(e.rank, 1, 8)) return `ダーツ: ${kind} の rank は null か1〜8の整数です`;
        if (e.rank === 1) firstsFromRank += 1;
      }
      // teamId は cricket のみ許可。
      if (e.teamId !== undefined && e.teamId !== null) {
        if (kind !== "cricket") return "ダーツ: teamId は cricket のみ設定できます";
        if (!isSafeTeamId(e.teamId)) return "ダーツ: cricket の teamId が不正です";
      }
    }
    // 3種目が揃っているか（重複が無く3件なので、全kindが1件ずつ）。
    for (const k of DARTS_EVENT_ORDER) if (!seen.has(k)) return `ダーツ: 種目 ${k} がありません`;

    if (!isIntIn(details.dayRank, 1, 8)) return "ダーツ: dayRank は 1〜8 の整数です";
    if (!isIntIn(details.firstCount, 0, 3)) return "ダーツ: firstCount は 0〜3 の整数です";
    if (details.firstCount !== firstsFromRank) {
      return `ダーツ: firstCount（${details.firstCount}）が rank===1 の件数（${firstsFromRank}）と一致しません`;
    }
    if (totalScore !== undefined && Math.abs(totalScore - pointsSum) > 0.01) {
      return `ダーツ: totalScore（${totalScore}）が points 合計（${pointsSum}）と一致しません`;
    }
    return null;
  }

  // 旧スキーマ（後方互換）: 単一 rank/points。
  if (!isIntIn(details.rank, 1, 8)) return "ダーツ: rank は 1〜8 の整数です";
  if (!isFiniteNum(details.points) || details.points < 0 || details.points > POINTS_MAX) {
    return `ダーツ: points は 0〜${POINTS_MAX} の数値です`;
  }
  if (totalScore !== undefined && Math.abs(totalScore - details.points) > 0.01) {
    return `ダーツ: totalScore が points と一致しません`;
  }
  return null;
}

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
