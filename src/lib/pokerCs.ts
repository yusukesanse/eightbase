/**
 * ポーカー チャンピオンシップ（CS）— GMなし完全自動進行の純ロジック。
 * ダーツ `dartsCs` の読み替え（構造は同一）。差分:
 *  - 申告は **終了時チップ**（数値・大きいほど上位）。順位は chips 降順で派生。
 *  - 「組」ではなく**卓**（3〜4名）。各卓のチップ1位が勝ち上がる。
 *  - 同点は「追加ハンド」（tiebreakChips）で決着（ダーツの追加スローに相当）。
 *  - リーグ上位4名は**予選免除シード**（round1 の byes として保持し、予選通過者と合流）。
 *  - 決勝卓（残り≤4）は 1位=金/2位=銀/3位=銅。
 *
 * ※ CSは**ディーラーを固定しない**（卓の中で交代しながら回す運用）。したがって
 *   リーグと違い「ディーラーは無得点」ではなく、卓の全員がチップを申告する。
 *
 * すべて純関数（Firestore 非依存）。進行は「1ラウンドずつ・完了したら次を append」方式。
 */

import type { PokerCsEntrant, PokerCsMatch, PokerCsMatchPlayer, PokerCsRound } from "@/types/poker";

const LABELS = "ABCDEFGH".split("");

/** シード（予選免除）人数。リーグ上位この人数は本戦から。 */
export const POKER_CS_SEED_COUNT = 4;

let matchSeq = 0;
function newMatchId(): string {
  matchSeq += 1;
  return `pcm${Date.now().toString(36)}_${matchSeq}`;
}

function toMatchPlayer(e: PokerCsEntrant): PokerCsMatchPlayer {
  return { lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl, chips: null, rank: null };
}

/**
 * プレイヤーを 2〜4 名のバランス卓に分割（各卓1位通過）。
 * 1人卓を作らないよう 3〜4 中心の均等割りにする（2名卓＝ヘッズアップは成立するので許容）。
 */
export function chunkIntoTables<T>(players: T[]): T[][] {
  const n = players.length;
  if (n <= 4) return [players];
  const tableCount = Math.ceil(n / 4);
  const base = Math.floor(n / tableCount);
  const extra = n % tableCount; // 先頭 extra 卓が base+1 人
  const tables: T[][] = [];
  let idx = 0;
  for (let g = 0; g < tableCount; g++) {
    const size = base + (g < extra ? 1 : 0);
    tables.push(players.slice(idx, idx + size));
    idx += size;
  }
  return tables;
}

/**
 * 終了時チップの申告から順位を派生（chips 降順・同点は tiebreakChips 降順を第2キー）。
 * 全員 chips が入っている前提。rank は競技順位（同着は同順位・次は飛ぶ）。
 */
export function rankByChipsCs(players: PokerCsMatchPlayer[]): PokerCsMatchPlayer[] {
  const key = (p: PokerCsMatchPlayer): [number, number] => [p.chips ?? -Infinity, p.tiebreakChips ?? -Infinity];
  const ordered = [...players].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1];
  });
  const eq = (a: PokerCsMatchPlayer, b: PokerCsMatchPlayer) => key(a)[0] === key(b)[0] && key(a)[1] === key(b)[1];
  const out: PokerCsMatchPlayer[] = [];
  let rank = 1;
  ordered.forEach((p, i) => {
    if (i > 0 && !eq(ordered[i - 1], p)) rank = i + 1;
    out.push({ ...p, rank });
  });
  return out;
}

/**
 * 1卓の状態を評価する（申告反映後に呼ぶ）。
 * - 未申告あり: reporting（待機）
 * - 表彰対象の順位（通常ラウンド=1位のみ / 決勝=金銀銅）が一意に決まる: completed
 * - 表彰対象の順位に同点が残る: tiebreak（同点者の lineUserId を tiebreakIds で返す）
 */
export function evaluatePokerCsMatch(
  match: PokerCsMatch,
  opts: { podiumSize?: number } = {}
): {
  status: "reporting" | "tiebreak" | "completed";
  players: PokerCsMatchPlayer[];
  tiebreakIds: string[];
} {
  const players = match.players;
  if (players.some((p) => p.chips == null)) {
    return { status: "reporting", players, tiebreakIds: [] };
  }
  const podiumSize = Math.max(1, opts.podiumSize ?? 1);
  const ranked = rankByChipsCs(players);

  // (chips, tiebreakChips) が完全一致する組＝まだ割れていない同点。
  const keyOf = (p: PokerCsMatchPlayer) => `${p.chips}|${p.tiebreakChips ?? "n"}`;
  const groups = new Map<string, PokerCsMatchPlayer[]>();
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
    if (groupRank <= podiumSize) tiebreakIds.push(...g.map((p) => p.lineUserId));
  }

  if (tiebreakIds.length === 0) return { status: "completed", players: ranked, tiebreakIds: [] };
  return { status: "tiebreak", players: ranked, tiebreakIds };
}

/** 決勝卓で一意に決めるべき表彰順位数（金銀銅・人数で頭打ち）。 */
export function finalPodiumSize(playerCount: number): number {
  return Math.min(3, Math.max(1, playerCount));
}

/** 決勝卓の表彰台を確定済み players（rank 付与済み）から求める。 */
export function resolveFinalPodium(players: PokerCsMatchPlayer[]): {
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

/** 完了卓の1位（勝ち上がり）。 */
export function winnerOf(match: PokerCsMatch): PokerCsMatchPlayer | null {
  const ranked = match.players.every((p) => p.rank != null) ? match.players : [];
  return ranked.find((p) => p.rank === 1) ?? null;
}

export function isRoundComplete(round: PokerCsRound): boolean {
  return round.matches.every((m) => m.status === "completed");
}

function makeMatch(label: string, players: PokerCsMatchPlayer[]): PokerCsMatch {
  // 1名のみの卓は不戦（自動確定・rank1）。
  if (players.length === 1) {
    return { matchId: newMatchId(), label, players: [{ ...players[0], rank: 1 }], status: "completed" };
  }
  return { matchId: newMatchId(), label, players, status: "reporting" };
}

/**
 * プール＋byes から1ラウンドを生成。
 * - 合計≤1: null（決着）
 * - 合計≤4: 決勝卓（byes＋pool を1卓）
 * - それ以外: pool を卓分け（byes は不戦で次へ）。次が≤4なら準決勝、そうでなければ予選。
 */
export function buildRoundFromPool(
  pool: PokerCsMatchPlayer[],
  byes: PokerCsMatchPlayer[] = []
): PokerCsRound | null {
  const total = pool.length + byes.length;
  if (total <= 1) return null;
  if (total <= 4) {
    return {
      type: "final",
      label: "決勝卓",
      byes: [],
      matches: [makeMatch("決勝卓", [...byes, ...pool])],
    };
  }
  // 1名だけのプールは bye に昇格して次へ回す（1人卓を作らない）。
  let workPool = pool;
  let workByes = byes;
  if (workPool.length === 1) {
    workByes = [...byes, workPool[0]];
    workPool = [];
  }
  if (workPool.length === 0) {
    return buildRoundFromPool(workByes, []);
  }
  const tables = chunkIntoTables(workPool);
  const advancers = tables.length + workByes.length;
  const isSemi = advancers <= 4;
  const label = isSemi ? "準決勝卓" : "予選卓";
  const matches = tables.map((g, i) => makeMatch(tables.length === 1 ? label : `${label}${LABELS[i] ?? i + 1}`, g));
  return { type: isSemi ? "semi" : "prelim", label, matches, byes: workByes };
}

/** 直前ラウンド（完了済み）から次ラウンドを生成。決勝後は null。 */
export function advanceCsRound(prevRound: PokerCsRound): PokerCsRound | null {
  if (prevRound.type === "final") return null;
  const winners = prevRound.matches.map((m) => winnerOf(m)).filter((p): p is PokerCsMatchPlayer => !!p);
  const pool = [...winners, ...(prevRound.byes ?? [])].map((p) => ({ ...p, chips: null, rank: null, tiebreakChips: null }));
  return buildRoundFromPool(pool, []);
}

/**
 * 初期ラウンドを組む。2名未満は null。
 * リーグ順位（rank昇順）に整列 → 上位4名はシード（byes・予選免除）、5位以下を予選卓に組む。
 * 4名以下なら即決勝卓。※くじ引きはせず、リーグ順位でそのまま組む（決定的）。
 */
export function buildInitialPokerCsRounds(entrants: PokerCsEntrant[]): PokerCsRound[] | null {
  if (entrants.length < 2) return null;
  const sorted = [...entrants].sort((a, b) => a.rank - b.rank);
  if (sorted.length <= 4) {
    const round = buildRoundFromPool(sorted.map(toMatchPlayer), []);
    return round ? [round] : null;
  }
  const seeds = sorted.slice(0, POKER_CS_SEED_COUNT).map(toMatchPlayer);
  const rest = sorted.slice(POKER_CS_SEED_COUNT).map(toMatchPlayer);
  const round = buildRoundFromPool(rest, seeds);
  return round ? [round] : null;
}

/**
 * 生成/進行後、末尾ラウンドが（不戦のみで）すでに完了していれば連鎖的に次を積む。
 * 決勝卓に到達したらそこで止める。rounds を破壊的に伸ばして返す。
 */
export function settleCsRounds(rounds: PokerCsRound[]): PokerCsRound[] {
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

/** 確定日（eventDate）到来で初期ラウンドを自動生成（setup→running）。today は JST を渡す。 */
export function startPokerCsIfDue(
  event: { status: string; eventDate: string; rounds: PokerCsRound[]; entrants: PokerCsEntrant[] },
  today: string
): { rounds: PokerCsRound[]; status: "running" } | null {
  if (event.status !== "setup" || event.rounds.length > 0) return null;
  if (event.eventDate > today) return null;
  const rounds = buildInitialPokerCsRounds(event.entrants);
  if (!rounds) return null;
  return { rounds: settleCsRounds(rounds), status: "running" };
}
