/**
 * 麻雀リーグ 卓組み（マッチング）エンジン — 純粋関数
 *
 * ルール（仕様 v1.1 準拠）:
 * - 物理的に卓は2卓まで（同時最大8人）。参加者が8人を超えると毎ラウンド見学者が出る
 * - 卓内は「上位から4人ずつ」で組む（順位順に並べ、上から4人=A卓、次の4人=B卓）
 * - 出場の優先順位（公平なローテーション）:
 *     1. 本日の試合数が少ない人を優先（全員が均等に打てるように）
 *     2. 直前ラウンドで最下位だった人は後回し（＝次ラウンド見学に回りやすい）
 *     3. 確定リーグ順位が上の人を優先
 * - 参加者が4人未満のラウンドは成立しない（全員見学）
 */

export interface MatchPlayer {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  /** 確定リーグ順位（小さいほど上位）。未確定なら大きな値を渡す */
  rank: number;
  /** 本日これまでに打った試合数 */
  gamesPlayedToday: number;
  /** 直前ラウンドで最下位だったか */
  lastPlaceLastRound: boolean;
}

export interface MatchTable {
  /** 卓ラベル A / B */
  label: string;
  members: MatchPlayer[];
}

export interface MatchResult {
  tables: MatchTable[];
  spectators: MatchPlayer[];
}

/** 同時に着席できる最大人数（2卓 × 4人） */
export const MAX_SEATS = 8;

/**
 * 次ラウンドの卓組みを決定する。
 * @param players 参加表明済みの全プレイヤー（順序は問わない）
 */
export function generateRound(players: MatchPlayer[]): MatchResult {
  if (players.length < 4) {
    return { tables: [], spectators: [...players] };
  }

  // 着席数: 4人区切りで最大8人
  const seats = Math.min(MAX_SEATS, Math.floor(players.length / 4) * 4);

  // 出場優先順位でソート（先頭ほど出場優先）
  const byPriority = [...players].sort(
    (a, b) =>
      a.gamesPlayedToday - b.gamesPlayedToday ||
      Number(a.lastPlaceLastRound) - Number(b.lastPlaceLastRound) ||
      a.rank - b.rank
  );

  const seated = byPriority.slice(0, seats);
  const spectators = byPriority.slice(seats);

  // 着席者を順位順に並べ、上位から4人ずつ卓に割り当て
  const seatedByRank = [...seated].sort((a, b) => a.rank - b.rank);
  const tables: MatchTable[] = [];
  const labels = ["A", "B"];
  for (let i = 0; i < seatedByRank.length; i += 4) {
    tables.push({
      label: labels[i / 4] ?? String.fromCharCode(65 + i / 4),
      members: seatedByRank.slice(i, i + 4),
    });
  }

  return { tables, spectators };
}
