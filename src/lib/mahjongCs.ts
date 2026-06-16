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

import type {
  MahjongCsEntrant,
  MahjongCsMatch,
  MahjongCsMatchPlayer,
  MahjongCsRound,
} from "@/types";

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
 * 予選ラウンドを生成する。
 * 非シード（M2/M3）をシャッフルして4人卓に分割。各卓 1位通過。
 * 非シードが0人なら予選なし（null）。
 */
export function generatePrelimRound(
  entrants: MahjongCsEntrant[],
  rng: () => number = Math.random
): MahjongCsRound | null {
  const nonSeed = entrants.filter((e) => !e.seed);
  if (nonSeed.length === 0) return null;

  const shuffled = shuffle(nonSeed, rng);
  const tables = chunkTables(shuffled, 4);
  const matches: MahjongCsMatch[] = tables.map((tbl, i) => ({
    matchId: newMatchId(),
    label: `予選${PRELIM_LABELS[i] ?? i + 1}`,
    players: tbl.map(toMatchPlayer),
    status: "reporting",
  }));

  return { type: "prelim", label: "予選", advanceCount: 1, matches };
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

/**
 * 直前ラウンドの結果と未投入シードから次ラウンドを生成する。
 * - 予選の次（準決）: 予選通過者 ＋ シード全員。4人卓に分割、上位2名通過
 * - 準決の次（決勝）: 準決通過者で1卓。1位が優勝（advanceCount=1）
 * - 既に決勝なら null（これ以上進めない）
 *
 * @param prevRound 直前の完了済みラウンド
 * @param seedEntrants まだ投入していないシード（準決生成時のみ使用）
 */
export function generateNextRound(
  prevRound: MahjongCsRound,
  seedEntrants: MahjongCsEntrant[],
  rng: () => number = Math.random
): MahjongCsRound | null {
  const advancers = collectAdvancers(prevRound);

  if (prevRound.type === "prelim") {
    // 準決: 予選通過者 + シード
    const pool = [...advancers, ...seedEntrants.map(toMatchPlayer)];
    const shuffled = shuffle(pool, rng);
    const tables = chunkTables(shuffled, 4);
    const matches: MahjongCsMatch[] = tables.map((tbl, i) => ({
      matchId: newMatchId(),
      label: tables.length === 1 ? "準決勝" : `準決${i + 1}`,
      players: tbl,
      status: "reporting",
    }));
    return { type: "semi", label: "準決勝", advanceCount: 2, matches };
  }

  if (prevRound.type === "semi") {
    // 決勝: 準決通過者で1卓
    const matches: MahjongCsMatch[] = [
      {
        matchId: newMatchId(),
        label: "決勝",
        players: advancers,
        status: "reporting",
      },
    ];
    return { type: "final", label: "決勝", advanceCount: 1, matches };
  }

  return null; // final の次はない
}

/** 全エントリーが4人以下なら予選・準決なしで一発決勝にする */
export function generateSingleFinal(
  entrants: MahjongCsEntrant[]
): MahjongCsRound {
  return {
    type: "final",
    label: "決勝",
    advanceCount: 1,
    matches: [
      {
        matchId: newMatchId(),
        label: "決勝",
        players: entrants.map(toMatchPlayer),
        status: "reporting",
      },
    ],
  };
}
