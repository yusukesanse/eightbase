/**
 * 【develop 専用 / main へ入れない】麻雀リーグのデモ進行補完。
 *
 * 当日デモ卓（demoDummy）で demoユーザーが申告したとき、他ダミーを標準配分で補完し
 * 半荘を成立させ、必要なら次半荘のドキュメントを組み立てる純関数。
 * 呼び出しは本番ガード（!isProduction()）内から行うこと。→ src/app/api/mahjong/tables/[tableId]/report/route.ts
 */

import type { MahjongTable, MahjongTableMember } from "@/types";

const DEMO_MAX_ROUNDS = 4;
const DEMO_RANK_POINTS: Record<number, number> = { 1: 40000, 2: 30000, 3: 20000, 4: 10000 };

/** 当日デモ卓か（demoDummy フラグ）。本番/通常卓には適用しない。 */
export function isDemoTable(table: { demoDummy?: boolean }): boolean {
  return table.demoDummy === true;
}

/**
 * demoユーザーの申告(rank)で全員を確定させ（他ダミーは標準配分で補完）、
 * 次半荘（最大4）が必要ならそのドキュメントを返す。
 */
export function buildDemoTableCompletion(
  table: MahjongTable,
  userId: string,
  rank: number
): { filled: MahjongTableMember[]; nextTable: { id: string; data: Record<string, unknown> } | null } {
  const nowIso = new Date().toISOString();
  const remainingRanks = [1, 2, 3, 4].filter((r) => r !== rank);
  let ri = 0;
  const filled = table.members.map((m) => {
    const r = m.lineUserId === userId ? rank : remainingRanks[ri++];
    return { ...m, points: DEMO_RANK_POINTS[r], rank: r, reportedAt: nowIso };
  });

  const nextRound = (table.round ?? 1) + 1;
  const nextTable =
    nextRound <= DEMO_MAX_ROUNDS
      ? {
          id: `demo-tbl-${table.seasonId}-live-r${nextRound}`,
          data: {
            seasonId: table.seasonId,
            eventDate: table.eventDate,
            createdBy: "system",
            memberIds: table.memberIds,
            members: table.members.map((m) => ({
              lineUserId: m.lineUserId,
              displayName: m.displayName,
              pictureUrl: m.pictureUrl ?? "",
              points: null,
              rank: null,
              reportedAt: null,
            })),
            status: "reporting",
            round: nextRound,
            tableLabel: table.tableLabel ?? "A",
            createdAt: nowIso,
            updatedAt: nowIso,
            demoDummy: true,
          },
        }
      : null;

  return { filled, nextTable };
}
