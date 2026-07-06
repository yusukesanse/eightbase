/**
 * 麻雀チャンピオンシップ（CS / トーナメント）ロジック — 半自動
 *
 * 構成（資料準拠）:
 * - 予選: 非シード（M2/M3）をくじ引きで4人卓に分割。各卓 1位通過
 * - 準決: 予選通過者 ＋ M1シード を4人卓に分割。各卓 上位2名通過
 * - 決勝: 準決通過者で1卓（4人）。1位が優勝
 *
 * 参戦人数は可変。人数に応じて卓数を調整し、管理者が必要なら手で直せる前提。
 */

import {
  MAHJONG_TABLE_TOTAL,
  type MahjongCsEntrant,
  type MahjongCsMatch,
  type MahjongCsMatchPlayer,
  type MahjongCsRound,
} from "@/types";

/** CS1試合の申告バリデーション（順位重複なし・整数・4人卓は合計100,000・点数と順位の整合）。 */
export function validateCsMatch(players: MahjongCsMatchPlayer[]): { ok: boolean; error?: string } {
  const n = players.length;
  if (players.some((p) => p.points === null || p.rank === null)) return { ok: false, error: "未入力があります" };
  if (players.some((p) => !Number.isInteger(p.points as number))) return { ok: false, error: "点数は整数で入力してください" };
  const ranks = players.map((p) => p.rank as number).sort((a, b) => a - b);
  if (ranks.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(",")) {
    return { ok: false, error: "順位は1〜Nを1人ずつ入力してください" };
  }
  if (n === 4) {
    const total = players.reduce((s, p) => s + (p.points as number), 0);
    if (total !== MAHJONG_TABLE_TOTAL) {
      return { ok: false, error: `4人卓の合計は${MAHJONG_TABLE_TOTAL.toLocaleString()}点にしてください（現在 ${total.toLocaleString()}）` };
    }
  }
  for (const a of players) {
    for (const b of players) {
      if ((a.points as number) > (b.points as number) && (a.rank as number) > (b.rank as number)) {
        return { ok: false, error: "点数と順位が一致していません" };
      }
    }
  }
  return { ok: true };
}

const PRELIM_LABELS = "ABCDEFGH".split("");

/** Fisher-Yates シャッフル（rng 差し替え可能でテストしやすく） */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** プレイヤー配列を size 人ずつの卓に分割（端数は最後の卓に寄せる） */
export function chunkTables<T>(players: T[], size = 4): T[][] {
  if (players.length === 0) return [];
  // 卓数は4人を基準に切り上げ。端数が1人だけ余る場合は最後の2卓で分け合う
  const tableCount = Math.max(1, Math.round(players.length / size));
  const tables: T[][] = Array.from({ length: tableCount }, () => []);
  players.forEach((p, i) => {
    tables[i % tableCount].push(p);
  });
  return tables;
}

function toMatchPlayer(e: MahjongCsEntrant): MahjongCsMatchPlayer {
  return {
    lineUserId: e.lineUserId,
    displayName: e.displayName,
    pictureUrl: e.pictureUrl,
    points: null,
    rank: null,
  };
}

let matchSeq = 0;
function newMatchId(): string {
  matchSeq += 1;
  return `m${Date.now().toString(36)}_${matchSeq}`;
}

/**
 * プレイヤーを「4人ちょうど」の卓に分割する。端数(<4)は byes として返す。
 * byes は先頭（＝上位シード）から取り、シードを優遇する（＝その回戦は不戦で次へ）。
 * これにより CS の卓は必ず4名になる。
 */
export function groupIntoFours(players: MahjongCsMatchPlayer[]): {
  tables: MahjongCsMatchPlayer[][];
  byes: MahjongCsMatchPlayer[];
} {
  const rem = players.length % 4;
  const byes = players.slice(0, rem);
  const rest = players.slice(rem);
  const tables: MahjongCsMatchPlayer[][] = [];
  for (let i = 0; i < rest.length; i += 4) tables.push(rest.slice(i, i + 4));
  return { tables, byes };
}

/**
 * プールから1ラウンドを生成する。
 * - 1名以下: null（決着）
 * - 4名以下: 決勝（1卓）
 * - それ以外: 4人卓（端数は byes で次へ）。次が決勝なら準決勝、そうでなければ予選。
 * 各卓 1着通過。
 */
function buildRoundFromPool(pool: MahjongCsMatchPlayer[]): MahjongCsRound | null {
  if (pool.length <= 1) return null;
  if (pool.length <= 4) {
    return {
      type: "final",
      label: "決勝",
      advanceCount: 1,
      byes: [],
      matches: [{ matchId: newMatchId(), label: "決勝", players: pool, status: "reporting" }],
    };
  }
  const { tables, byes } = groupIntoFours(pool);
  const nextCount = tables.length + byes.length; // 次ラウンドの人数
  const isSemi = nextCount <= 4;
  const label = isSemi ? "準決勝" : "予選";
  const matches: MahjongCsMatch[] = tables.map((tbl, i) => ({
    matchId: newMatchId(),
    label: tables.length === 1 ? label : `${label}${PRELIM_LABELS[i] ?? i + 1}`,
    players: tbl,
    status: "reporting",
  }));
  return { type: isSemi ? "semi" : "prelim", label, advanceCount: 1, byes, matches };
}

/** 1試合の上位 n 名（rank 昇順）を勝ち上がりとして返す */
export function advancersOf(
  match: MahjongCsMatch,
  n: number
): MahjongCsMatchPlayer[] {
  return [...match.players]
    .filter((p) => p.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .slice(0, n);
}

/** ラウンドの全試合が完了しているか */
export function isRoundComplete(round: MahjongCsRound): boolean {
  return round.matches.every((m) => m.status === "completed");
}

/** ラウンドの勝ち上がり者を集める */
export function collectAdvancers(round: MahjongCsRound): MahjongCsMatchPlayer[] {
  return round.matches.flatMap((m) => advancersOf(m, round.advanceCount));
}

/** CS仕様: 各試合の1着のみを勝ち上がりとする。 */
export function collectTop1(round: MahjongCsRound): MahjongCsMatchPlayer[] {
  return round.matches
    .map((m) => advancersOf(m, 1)[0])
    .filter((p): p is MahjongCsMatchPlayer => !!p);
}

/**
 * 直前ラウンドの結果から次ラウンドを生成する（1着＋bye で次のプールを作る）。
 * 卓は必ず4名（端数は bye）。決勝後は null。
 */
export function advanceCsRound(prevRound: MahjongCsRound): MahjongCsRound | null {
  if (prevRound.type === "final") return null;
  const pool = [...collectTop1(prevRound), ...(prevRound.byes ?? [])];
  return buildRoundFromPool(pool);
}

/**
 * 初期ラウンドを組む（自動生成の起点）。2名未満は null。
 * 全員をシード順（rank昇順）に並べ、端数の上位シードは bye。卓は必ず4名。
 * 残りはシャッフルして4人卓へ。
 */
export function buildInitialCsRounds(
  entrants: MahjongCsEntrant[],
  rng: () => number = Math.random
): MahjongCsRound[] | null {
  if (entrants.length < 2) return null;
  const sorted = [...entrants].sort((a, b) => a.rank - b.rank);
  const rem = sorted.length % 4;
  const topSeeds = sorted.slice(0, rem); // 端数は上位シードを bye に（先頭固定）
  const rest = shuffle(sorted.slice(rem), rng);
  const pool = [...topSeeds, ...rest].map(toMatchPlayer);
  const round = buildRoundFromPool(pool);
  return round ? [round] : null;
}

/**
 * 管理者が確定した開催日になったら初期ラウンドを自動生成する。
 * status=setup かつ rounds空 かつ eventDate<=today のときだけ生成し running へ。
 * それ以外は null（変更なし）。純関数（today は呼び出し側が JST で渡す）。
 */
export function startCsIfDue(
  event: { status: string; eventDate: string; rounds: MahjongCsRound[]; entrants: MahjongCsEntrant[] },
  today: string,
  rng: () => number = Math.random
): { rounds: MahjongCsRound[]; status: "running" } | null {
  if (event.status !== "setup" || event.rounds.length > 0) return null;
  if (event.eventDate > today) return null; // まだ確定日前
  const rounds = buildInitialCsRounds(event.entrants, rng);
  if (!rounds) return null;
  return { rounds, status: "running" };
}

