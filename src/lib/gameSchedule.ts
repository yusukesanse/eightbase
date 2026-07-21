/**
 * 全ゲーム共通の日程（{game}Schedule）操作の集約。管理カレンダーAPIと利用者検証で共用する。
 * 開催日は決定的ID `{seasonId}_{date}` の doc。削除は「参加者がいる日を保護」しつつ原子的に行う。
 */

import { DARTS_DEFAULT_START_TIME, DARTS_DEFAULT_END_TIME } from "@/types/darts";
import { BILLIARDS_DEFAULT_START_TIME, BILLIARDS_DEFAULT_END_TIME } from "@/types/billiards";

export type ScheduleGame = "mahjong" | "darts" | "billiards";

export const GAME_SCHEDULE_CFG: Record<
  ScheduleGame,
  { col: string; start: string; end: string; extra?: Record<string, unknown> }
> = {
  mahjong: { col: "mahjongSchedule", start: "13:00", end: "18:00", extra: { type: "league" } },
  darts: { col: "dartsSchedule", start: DARTS_DEFAULT_START_TIME, end: DARTS_DEFAULT_END_TIME },
  billiards: { col: "billiardsSchedule", start: BILLIARDS_DEFAULT_START_TIME, end: BILLIARDS_DEFAULT_END_TIME },
};

export const buildGameScheduleId = (seasonId: string, date: string) => `${seasonId}_${date}`;

/**
 * 1開催日を安全に削除（単日・一括で共用）。トランザクション内で
 * 「その日のエントリー（範囲ロック）」と「schedule doc群」を読み、
 * - 参加者がいれば削除せず "skipped"（保護）
 * - いなければ schedule doc を全消しして "deleted"
 * entries-query の範囲ロックにより entry POST の書き込みと直列化される
 * （entry POST 側も schedule doc を tx 内で確認するため、削除↔参加の競合が閉じる）。
 */
export async function deleteGameScheduleDate(
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
): Promise<"deleted" | "skipped"> {
  const col = GAME_SCHEDULE_CFG[game].col;
  const entryCol = `${game}Entries`;
  return db.runTransaction(async (tx) => {
    const entrySnap = await tx.get(
      db.collection(entryCol).where("seasonId", "==", seasonId).where("eventDate", "==", date)
    );
    const schedSnap = await tx.get(
      db.collection(col).where("seasonId", "==", seasonId).where("date", "==", date)
    );
    if (!entrySnap.empty) return "skipped";
    tx.delete(db.collection(col).doc(buildGameScheduleId(seasonId, date)));
    for (const d of schedSnap.docs) tx.delete(d.ref);
    return "deleted";
  });
}
