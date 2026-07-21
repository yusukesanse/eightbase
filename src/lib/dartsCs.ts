/**
 * ダーツ チャンピオンシップ（CS・§5）— GMなし完全自動進行の純ロジック。
 * 麻雀 mahjongCs を読み替え。差分:
 *  - 種目=カウントアップ固定。申告は score（数値）のみ。順位は score 降順で派生。
 *  - リーグ上位4名は**予選免除シード**（round1 の byes として保持し、予選通過者と合流）。
 *  - 予選/本戦は各組カウントアップ1位が通過。組内で1位が同点なら追加スロー（tiebreakScore）で決着。
 *  - 決勝（残り≤4）は 1位=金/2位=銀/3位=銅。
 *
 * すべて純関数（Firestore 非依存）。進行は「1ラウンドずつ・完了したら次を append」方式。
 */

import type {
  DartsCsEntrant,
  DartsCsMatch,
  DartsCsMatchPlayer,
  DartsCsRound,
} from "@/types/darts";

const LABELS = "ABCDEFGH".split("");

/** シード（予選免除）人数。リーグ上位この人数はエントリー順で本戦から。 */
export const DARTS_CS_SEED_COUNT = 4;

let matchSeq = 0;
function newMatchId(): string {
  matchSeq += 1;
  return `dm${Date.now().toString(36)}_${matchSeq}`;
}

function toMatchPlayer(e: DartsCsEntrant): DartsCsMatchPlayer {
  return { lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl, score: null, rank: null };
}

/**
 * プレイヤーを 2〜4 名のバランス組に分割（各組1位通過）。
 * 「4人組・端数は下位側で実施」を、1人組を避けるため 3〜4 中心の均等割りで解釈（§6端数組の実装確定）。
 * len<=1 は呼び出し側で bye 扱い（ここには渡さない前提だが安全に [players] を返す）。
 */
export function chunkIntoGroups<T>(players: T[]): T[][] {
  const n = players.length;
  if (n <= 4) return [players];
  const groupCount = Math.ceil(n / 4);
  const base = Math.floor(n / groupCount);
  const extra = n % groupCount; // 先頭 extra 組が base+1 人
  const groups: T[][] = [];
  let idx = 0;
  for (let g = 0; g < groupCount; g++) {
    const size = base + (g < extra ? 1 : 0);
    groups.push(players.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

/**
 * カウントアップの申告から順位を派生（score 降順・同点は tiebreakScore 降順を第2キー）。
 * 全員 score が入っている前提。rank は競技順位（同着は同順位・次は飛ぶ）。
 */
export function rankByScore(players: DartsCsMatchPlayer[]): DartsCsMatchPlayer[] {
  const key = (p: DartsCsMatchPlayer): [number, number] => [p.score ?? -Infinity, p.tiebreakScore ?? -Infinity];
  const ordered = [...players].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1];
  });
  const eq = (a: DartsCsMatchPlayer, b: DartsCsMatchPlayer) => key(a)[0] === key(b)[0] && key(a)[1] === key(b)[1];
  const out: DartsCsMatchPlayer[] = [];
  let rank = 1;
  ordered.forEach((p, i) => {
    if (i > 0 && !eq(ordered[i - 1], p)) rank = i + 1;
    out.push({ ...p, rank });
  });
  return out;
}

/**
 * 1試合の状態を評価する（申告反映後に呼ぶ）。
 * - 未申告あり: reporting（待機）
 * - 表彰対象の順位（通常ラウンド=1位のみ / 決勝=金銀銅）が一意に決まる: completed
 * - 表彰対象の順位に同点が残る: tiebreak（同点者の lineUserId を tiebreakIds で返す）
 *
 * podiumSize で「一意に決めるべき上位の数」を指定する（既定=1＝通過者のみ＝通常ラウンド）。
 * 決勝は finalPodiumSize(人数) を渡し、金・銀・銅が一意に決まるまで completed にしない。
 * 同点判定は (score, tiebreakScore) の複合キー。追加スローで score 同点を割る（§5.4）。
 */
export function evaluateCsMatch(
  match: DartsCsMatch,
  opts: { podiumSize?: number } = {}
): {
  status: "reporting" | "tiebreak" | "completed";
  players: DartsCsMatchPlayer[];
  tiebreakIds: string[];
} {
  const players = match.players;
  if (players.some((p) => p.score == null)) {
    return { status: "reporting", players, tiebreakIds: [] };
  }
  const podiumSize = Math.max(1, opts.podiumSize ?? 1);
  const ranked = rankByScore(players); // (score desc, tiebreak desc) で rank 付与

  // (score, tiebreak) が完全一致する組＝まだ割れていない同点。
  const keyOf = (p: DartsCsMatchPlayer) => `${p.score}|${p.tiebreakScore ?? "n"}`;
  const groups = new Map<string, DartsCsMatchPlayer[]>();
  for (const p of ranked) {
    const k = keyOf(p);
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }

  const tiebreakIds: string[] = [];
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    const groupRank = Math.min(...g.map((p) => p.rank ?? Number.POSITIVE_INFINITY));
    // 表彰対象の順位帯（1..podiumSize）に食い込む同点は解消が必要。
    if (groupRank <= podiumSize) tiebreakIds.push(...g.map((p) => p.lineUserId));
  }

  if (tiebreakIds.length === 0) return { status: "completed", players: ranked, tiebreakIds: [] };
  return { status: "tiebreak", players: ranked, tiebreakIds };
}

/** 決勝で一意に決めるべき表彰順位数（金銀銅・人数で頭打ち）。 */
export function finalPodiumSize(playerCount: number): number {
  return Math.min(3, Math.max(1, playerCount));
}

/**
 * 決勝の表彰台を確定済み players（rank 付与済み）から求める。find(rank===n) に頼らず順序で取る。
 * 人数が少なく銅（3位）が出せない場合は null（仕様どおり許容）。
 */
export function resolveFinalPodium(players: DartsCsMatchPlayer[]): {
  gold: string | null;
  silver: string | null;
  bronze: string | null;
} {
  const sorted = [...players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return {
    gold: sorted[0]?.lineUserId ?? null,
    silver: sorted[1]?.lineUserId ?? null,
    bronze: sorted.length >= 3 ? sorted[2]?.lineUserId ?? null : null,
  };
}

/** 完了試合の1位（勝ち上がり）。 */
export function winnerOf(match: DartsCsMatch): DartsCsMatchPlayer | null {
  const ranked = match.players.every((p) => p.rank != null) ? match.players : [];
  return ranked.find((p) => p.rank === 1) ?? null;
}

export function isRoundComplete(round: DartsCsRound): boolean {
  return round.matches.every((m) => m.status === "completed");
}

function makeMatch(label: string, players: DartsCsMatchPlayer[]): DartsCsMatch {
  // 1名のみの組は不戦（自動確定・rank1）。
  if (players.length === 1) {
    return { matchId: newMatchId(), label, players: [{ ...players[0], rank: 1 }], status: "completed" };
  }
  return { matchId: newMatchId(), label, players, status: "reporting" };
}

/**
 * プール＋byes から1ラウンドを生成。
 * - 合計≤1: null（決着）
 * - 合計≤4: 決勝（byes＋pool を1組）
 * - それ以外: pool を組分け（byes は不戦で次へ）。次が≤4なら準決勝、そうでなければ予選。
 */
export function buildRoundFromPool(
  pool: DartsCsMatchPlayer[],
  byes: DartsCsMatchPlayer[] = []
): DartsCsRound | null {
  const total = pool.length + byes.length;
  if (total <= 1) return null;
  if (total <= 4) {
    return {
      type: "final",
      label: "決勝",
      byes: [],
      matches: [makeMatch("決勝", [...byes, ...pool])],
    };
  }
  // 1名だけのプールは bye に昇格して次へ回す（1人組の試合を作らない）。
  let workPool = pool;
  let workByes = byes;
  if (workPool.length === 1) {
    workByes = [...byes, workPool[0]];
    workPool = [];
  }
  if (workPool.length === 0) {
    // 全員 bye → 次ラウンドを直接組む。
    return buildRoundFromPool(workByes, []);
  }
  const groups = chunkIntoGroups(workPool);
  const advancers = groups.length + workByes.length;
  const isSemi = advancers <= 4;
  const label = isSemi ? "準決勝" : "予選";
  const matches = groups.map((g, i) => makeMatch(groups.length === 1 ? label : `${label}${LABELS[i] ?? i + 1}`, g));
  return { type: isSemi ? "semi" : "prelim", label, matches, byes: workByes };
}

/** 直前ラウンド（完了済み）から次ラウンドを生成。決勝後は null。 */
export function advanceCsRound(prevRound: DartsCsRound): DartsCsRound | null {
  if (prevRound.type === "final") return null;
  const winners = prevRound.matches.map((m) => winnerOf(m)).filter((p): p is DartsCsMatchPlayer => !!p);
  const pool = [...winners, ...(prevRound.byes ?? [])].map((p) => ({ ...p, score: null, rank: null, tiebreakScore: null }));
  return buildRoundFromPool(pool, []);
}

/**
 * 初期ラウンドを組む（§5.3）。2名未満は null。
 * リーグ順位（rank昇順）に整列 → 上位4名はシード（byes・予選免除）、5位以下を予選に組む。
 * 4名以下なら即決勝。※くじ引き（shuffle）はせず、リーグ順位でそのまま組む（決定的）。
 */
export function buildInitialDartsCsRounds(entrants: DartsCsEntrant[]): DartsCsRound[] | null {
  if (entrants.length < 2) return null;
  const sorted = [...entrants].sort((a, b) => a.rank - b.rank);
  if (sorted.length <= 4) {
    const round = buildRoundFromPool(sorted.map(toMatchPlayer), []);
    return round ? [round] : null;
  }
  const seeds = sorted.slice(0, DARTS_CS_SEED_COUNT).map(toMatchPlayer);
  const rest = sorted.slice(DARTS_CS_SEED_COUNT).map(toMatchPlayer);
  const round = buildRoundFromPool(rest, seeds);
  return round ? [round] : null;
}

/**
 * 生成/進行後、末尾ラウンドが（不戦のみで）すでに完了していれば連鎖的に次を積む。
 * 決勝に到達したらそこで止める。rounds を破壊的に伸ばして返す。
 */
export function settleCsRounds(rounds: DartsCsRound[]): DartsCsRound[] {
  let guard = 0;
  while (guard++ < 32) {
    const last = rounds[rounds.length - 1];
    if (!last || last.type === "final" || !isRoundComplete(last)) break;
    const next = advanceCsRound(last);
    if (!next) break;
    rounds.push(next);
  }
  return rounds;
}

/**
 * 確定日（eventDate）到来で初期ラウンドを自動生成（setup→running）。純関数（today は JST を渡す）。
 */
export function startDartsCsIfDue(
  event: { status: string; eventDate: string; rounds: DartsCsRound[]; entrants: DartsCsEntrant[] },
  today: string
): { rounds: DartsCsRound[]; status: "running" } | null {
  if (event.status !== "setup" || event.rounds.length > 0) return null;
  if (event.eventDate > today) return null;
  const rounds = buildInitialDartsCsRounds(event.entrants);
  if (!rounds) return null;
  return { rounds: settleCsRounds(rounds), status: "running" };
}
