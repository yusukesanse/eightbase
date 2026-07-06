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

/** CS仕様: 各試合の1着のみを勝ち上がりとする（advanceCount非依存）。 */
export function collectTop1(round: MahjongCsRound): MahjongCsMatchPlayer[] {
  return round.matches
    .map((m) => advancersOf(m, 1)[0])
    .filter((p): p is MahjongCsMatchPlayer => !!p);
}

/**
 * CS仕様（1着のみ進出）で次ラウンドを生成する。generateNextRound の 1着限定版。
 * 予選→準決（1着＋シードで4人卓）、準決→決勝（1着で1卓）。advanceCount は 1 固定。
 */
export function generateNextRoundCsTop1(
  prevRound: MahjongCsRound,
  seedEntrants: MahjongCsEntrant[],
  rng: () => number = Math.random
): MahjongCsRound | null {
  const advancers = collectTop1(prevRound);

  if (prevRound.type === "prelim") {
    const pool = [...advancers, ...seedEntrants.map(toMatchPlayer)];
    const shuffled = shuffle(pool, rng);
    const tables = chunkTables(shuffled, 4);
    const matches: MahjongCsMatch[] = tables.map((tbl, i) => ({
      matchId: newMatchId(),
      label: tables.length === 1 ? "準決勝" : `準決${i + 1}`,
      players: tbl,
      status: "reporting",
    }));
    return { type: "semi", label: "準決勝", advanceCount: 1, matches };
  }

  if (prevRound.type === "semi") {
    return {
      type: "final",
      label: "決勝",
      advanceCount: 1,
      matches: [{ matchId: newMatchId(), label: "決勝", players: advancers, status: "reporting" }],
    };
  }

  return null;
}

/**
 * 初期ラウンドを組む（自動生成の起点）。
 * - 2名未満: null（生成不可）
 * - 4名以下: 一発決勝
 * - 5名以上: 予選（M2/M3をくじ引きで4人卓・1着通過。M1はシードで準決から）
 *   非シードが居ない（全員シード）場合は全員で予選相当を組む。
 */
export function buildInitialCsRounds(
  entrants: MahjongCsEntrant[],
  rng: () => number = Math.random
): MahjongCsRound[] | null {
  if (entrants.length < 2) return null;
  if (entrants.length <= 4) return [generateSingleFinal(entrants)];
  const prelim = generatePrelimRound(entrants, rng);
  if (prelim) return [prelim];
  // 全員シード（非シード0人）: シード無視で全員を4人卓に分割し予選扱い
  const tables = chunkTables(shuffle(entrants, rng), 4);
  const matches: MahjongCsMatch[] = tables.map((tbl, i) => ({
    matchId: newMatchId(),
    label: `予選${PRELIM_LABELS[i] ?? i + 1}`,
    players: tbl.map(toMatchPlayer),
    status: "reporting",
  }));
  return [{ type: "prelim", label: "予選", advanceCount: 1, matches }];
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
