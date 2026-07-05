/**
 * 麻雀リーグ「抜け番」ロジック（B方式＝待機人数に応じた自動縮退）。純関数・サーバーで確定。
 * 当日参加9名以上で有効化し、半荘終了ごとに次卓を生成する。
 */

export interface RotPlayer {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/** 直前半荘の1卓の結果。ranked は rank 昇順(1..4)。 */
export interface RankedTable {
  label: string; // "A","B",...
  ranked: { player: RotPlayer; rank: number }[];
}

export interface RotationResult {
  active: boolean; // 抜け番有効（当日参加>=9）
  tables: { label: string; members: RotPlayer[] }[]; // 次半荘の座席（卓順）
  waiting: RotPlayer[]; // 次の待機キュー（FIFO・先頭が次にIN）
  out: RotPlayer[]; // 今回OUT
  in: RotPlayer[]; // 今回IN
  shrunk: boolean; // 待機不足で交代が候補未満に縮退したか
  reason?: string;
}

const MIN_ACTIVE = 9;

/**
 * 直前半荘の各卓結果＋待機キューから次半荘を生成する。
 * 交代候補: 各卓4位（卓順）。待機数に満たなければ各卓3位（卓順）も追加。
 * 優先順: 順位(4位→3位) → 卓順(A→B)。交代数 = min(候補, 待機)。OUTは末尾へ（FIFO）。
 */
export function computeNextRound(prevTables: RankedTable[], waiting: RotPlayer[]): RotationResult {
  const total = prevTables.length * 4 + waiting.length;

  // 8名以下: 従来（抜け番なし）。同じ4人でそのまま次半荘。
  if (total < MIN_ACTIVE) {
    return {
      active: false,
      tables: prevTables.map((t) => ({ label: t.label, members: t.ranked.map((r) => r.player) })),
      waiting: [...waiting],
      out: [],
      in: [],
      shrunk: false,
    };
  }

  type Cand = { player: RotPlayer; tableIdx: number };
  const rankCands = (rank: number): Cand[] =>
    prevTables
      .map((t, ti) => {
        const hit = t.ranked.find((r) => r.rank === rank);
        return hit ? { player: hit.player, tableIdx: ti } : null;
      })
      .filter((c): c is Cand => !!c);

  let candidates = rankCands(4);
  if (candidates.length < waiting.length) {
    candidates = [...candidates, ...rankCands(3)];
  }

  const swapCount = Math.min(candidates.length, waiting.length);
  const outEntries = candidates.slice(0, swapCount);
  const inPlayers = waiting.slice(0, swapCount);
  const shrunk = swapCount < candidates.length; // 待機不足で候補を出し切れない
  const reason = shrunk ? `待機者不足のため、今回の交代は${swapCount}名のみです` : undefined;

  // 次卓: 各卓の OUT 座席を IN で置換（out 順に対応）。継続者は順位順で残す。
  const outIds = new Set(outEntries.map((o) => o.player.lineUserId));
  const tables = prevTables.map((t, ti) => {
    const continuing = t.ranked.filter((r) => !outIds.has(r.player.lineUserId)).map((r) => r.player);
    const inHere = outEntries
      .map((o, i) => ({ o, inP: inPlayers[i] }))
      .filter((x) => x.o.tableIdx === ti)
      .map((x) => x.inP);
    return { label: t.label, members: [...continuing, ...inHere] };
  });

  // 次の待機: 残り待機 ＋ OUT を末尾へ（FIFO維持）。
  const nextWaiting = [...waiting.slice(swapCount), ...outEntries.map((o) => o.player)];

  return {
    active: true,
    tables,
    waiting: nextWaiting,
    out: outEntries.map((o) => o.player),
    in: inPlayers,
    shrunk,
    reason,
  };
}
