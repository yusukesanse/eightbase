/**
 * ビリヤード チャンピオンシップ（CS・8ボール 1対1）— GMなし完全自動進行の純ロジック。
 * ダーツ dartsCs（カウントアップ組分け）とは異なり、シングルエリミネーション。
 *  - 各試合はちょうど2名。勝者を申告（won=true）すると確定。
 *  - 端数はシード上位に不戦勝（bye）を与える（次ラウンドへ自動進出）。
 *  - 各ラウンドは勝者＋前ラウンドのbyeを「リーグ順位で再シード」して上位×下位で組む（決定的）。
 *  - 準決勝の敗者が2名なら3位決定戦を決勝ラウンドに同梱。金/銀/銅を確定。
 *
 * すべて純関数（Firestore 非依存）。進行は「1ラウンドずつ・完了したら次を append」方式。
 */

import type {
  BilliardsCsEntrant,
  BilliardsCsMatch,
  BilliardsCsMatchPlayer,
  BilliardsCsRound,
  BilliardsCsRoundType,
} from "@/types/billiards";

/** シード表示（上位バッジ）人数。実際の不戦勝は byeCountFor で人数に応じて決まる。 */
export const BILLIARDS_CS_SEED_COUNT = 4;

let matchSeq = 0;
function newMatchId(): string {
  matchSeq += 1;
  return `bcm${Date.now().toString(36)}_${matchSeq}`;
}

/** entrant → 未確定の対戦プレイヤー。rank をシード順の判定に使うため保持。 */
function toMatchPlayer(e: BilliardsCsEntrant): BilliardsCsMatchPlayer {
  return { lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl, won: null, rank: e.rank };
}

const rankOf = (p: BilliardsCsMatchPlayer): number => p.rank ?? 999;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** 2の冪でない人数のとき、上位シードに与える不戦勝の数。 */
export function byeCountFor(n: number): number {
  if (n < 2) return 0;
  return nextPow2(n) - n;
}

/** そのラウンドに入る人数からラウンド種別を決める。2=決勝 / 3〜4=準決勝 / それ以外=本戦。 */
function roundTypeFor(total: number): BilliardsCsRoundType {
  if (total <= 2) return "final";
  if (total <= 4) return "semi";
  return "round";
}

function roundLabelFor(type: BilliardsCsRoundType, roundNo: number): string {
  return type === "final" ? "決勝" : type === "semi" ? "準決勝" : `${roundNo}回戦`;
}

/** シード順（rank昇順）で並べたプレイヤーを上位×下位でペアリング（偶数前提）。 */
function seedPairings(players: BilliardsCsMatchPlayer[]): [BilliardsCsMatchPlayer, BilliardsCsMatchPlayer][] {
  const sorted = [...players].sort((a, b) => rankOf(a) - rankOf(b));
  const pairs: [BilliardsCsMatchPlayer, BilliardsCsMatchPlayer][] = [];
  for (let i = 0; i < sorted.length / 2; i++) {
    pairs.push([sorted[i], sorted[sorted.length - 1 - i]]);
  }
  return pairs;
}

function makeMatch(label: string, a: BilliardsCsMatchPlayer, b: BilliardsCsMatchPlayer): BilliardsCsMatch {
  return {
    matchId: newMatchId(),
    label,
    players: [{ ...a, won: null }, { ...b, won: null }],
    status: "reporting",
  };
}

/** 完了試合の勝者。 */
export function winnerOf(match: BilliardsCsMatch): BilliardsCsMatchPlayer | null {
  return match.players.find((p) => p.won === true) ?? null;
}
/** 完了試合の敗者。 */
export function loserOf(match: BilliardsCsMatch): BilliardsCsMatchPlayer | null {
  return match.players.find((p) => p.won === false) ?? null;
}

export function isRoundComplete(round: BilliardsCsRound): boolean {
  return round.matches.every((m) => m.status === "completed");
}

/**
 * プール（＋byes）から1ラウンドを生成。roundNo はラベル用（1始まり）。
 * - 合計 ≤1: null（決着）
 * - 端数は上位シードへ bye（次へ持ち越し）。残りを上位×下位でペア。
 */
export function buildRoundFromPool(
  pool: BilliardsCsMatchPlayer[],
  roundNo: number
): BilliardsCsRound | null {
  const total = pool.length;
  if (total <= 1) return null;

  const byes = byeCountFor(total);
  const sorted = [...pool].sort((a, b) => rankOf(a) - rankOf(b));
  const byePlayers = sorted.slice(0, byes);
  const rest = sorted.slice(byes); // 偶数
  const type = roundTypeFor(total);
  const label = roundLabelFor(type, roundNo);

  const pairs = seedPairings(rest);
  const matches = pairs.map((p, i) =>
    makeMatch(pairs.length === 1 ? label : `第${i + 1}試合`, p[0], p[1])
  );

  return { type, label, matches, byes: byePlayers };
}

/**
 * 直前ラウンド（完了済み）から次ラウンドを生成。決勝後は null。
 * 準決勝→決勝の遷移では、準決勝の敗者2名で3位決定戦を決勝ラウンドに同梱する。
 */
export function advanceCsRound(prevRound: BilliardsCsRound, nextRoundNo: number): BilliardsCsRound | null {
  if (prevRound.type === "final") return null;
  const winners = prevRound.matches
    .map((m) => winnerOf(m))
    .filter((p): p is BilliardsCsMatchPlayer => !!p)
    .map((p) => ({ ...p, won: null }));
  const carried = (prevRound.byes ?? []).map((p) => ({ ...p, won: null }));
  const pool = [...winners, ...carried];
  const next = buildRoundFromPool(pool, nextRoundNo);
  if (!next) return null;

  // 準決勝 → 決勝: 敗者2名で3位決定戦を同梱。
  if (next.type === "final" && prevRound.type === "semi") {
    const losers = prevRound.matches
      .map((m) => loserOf(m))
      .filter((p): p is BilliardsCsMatchPlayer => !!p);
    if (losers.length === 2) {
      next.matches.push(makeMatch("3位決定戦", losers[0], losers[1]));
    }
  }
  return next;
}

/**
 * 初期ラウンドを組む。2名未満は null。リーグ順位（rank昇順）でシードして第1ラウンドを生成。
 */
export function buildInitialBilliardsCsRounds(entrants: BilliardsCsEntrant[]): BilliardsCsRound[] | null {
  if (entrants.length < 2) return null;
  const round = buildRoundFromPool(entrants.map(toMatchPlayer), 1);
  return round ? [round] : null;
}

/**
 * 末尾ラウンドが完了していれば連鎖的に次を積む。決勝に到達したら止める。
 * rounds を破壊的に伸ばして返す。
 */
export function settleCsRounds(rounds: BilliardsCsRound[]): BilliardsCsRound[] {
  let guard = 0;
  while (guard++ < 32) {
    const last = rounds[rounds.length - 1];
    if (!last || last.type === "final" || !isRoundComplete(last)) break;
    const next = advanceCsRound(last, rounds.length + 1);
    if (!next) break;
    rounds.push(next);
  }
  return rounds;
}

/**
 * 決勝ラウンドが完了していれば表彰（champion/runnerUp/third）を返す。未完了なら null。
 * 決勝ラウンドは「決勝」試合＋任意で「3位決定戦」を含む。
 */
export function resolvePodium(rounds: BilliardsCsRound[]): { championId: string; runnerUpId: string; thirdId: string | null } | null {
  const final = rounds[rounds.length - 1];
  if (!final || final.type !== "final" || !isRoundComplete(final)) return null;
  const finalMatch = final.matches.find((m) => m.label === "決勝") ?? final.matches[0];
  const champ = winnerOf(finalMatch);
  const runner = loserOf(finalMatch);
  if (!champ || !runner) return null;
  const thirdMatch = final.matches.find((m) => m.label === "3位決定戦");
  const third = thirdMatch ? winnerOf(thirdMatch) : null;
  return { championId: champ.lineUserId, runnerUpId: runner.lineUserId, thirdId: third?.lineUserId ?? null };
}

/**
 * 確定日（eventDate）到来で初期ラウンドを自動生成（setup→running）。純関数（today は JST）。
 */
export function startBilliardsCsIfDue(
  event: { status: string; eventDate: string; rounds: BilliardsCsRound[]; entrants: BilliardsCsEntrant[] },
  today: string
): { rounds: BilliardsCsRound[]; status: "running" } | null {
  if (event.status !== "setup" || event.rounds.length > 0) return null;
  if (event.eventDate > today) return null;
  const rounds = buildInitialBilliardsCsRounds(event.entrants);
  if (!rounds) return null;
  return { rounds: settleCsRounds(rounds), status: "running" };
}
