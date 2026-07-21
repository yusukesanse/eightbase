/**
 * 全ゲーム共通の日程（{game}Schedule）操作の集約。管理カレンダーAPIと利用者検証で共用する。
 *
 * ★開催日削除と参加表明の競合対策（空クエリの範囲ロックに依存しない設計）★
 * Firestore はトランザクションが「読んだドキュメントID」（存在しないIDも含む）への並行書き込みを
 * 競合として検出するが、**空クエリ結果に対する後続 insert（phantom）は直列化を保証しない**。
 * そこで開催日ごとに **決定的なロックドキュメント** `scheduleLocks/{game}__{seasonId}__{date}` を用意し、
 * - entry POST はトランザクション内でこのロックを **ID指定で読む**（blocked なら参加不可）
 * - 削除は「2フェーズ」で行う（下記 deleteGameScheduleDate）
 * ことで、concrete-ID の読み書き競合だけで直列化する（クエリの範囲ロックに依存しない）。
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

const SCHEDULE_LOCKS = "scheduleLocks";
export const scheduleLockId = (game: ScheduleGame, seasonId: string, date: string) =>
  `${game}__${seasonId}__${date}`;
export const scheduleLockRef = (
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
) => db.collection(SCHEDULE_LOCKS).doc(scheduleLockId(game, seasonId, date));

/**
 * entry POST がトランザクション内で使う: この開催日が削除中/削除済みでブロックされているか。
 * ロックドキュメントを **ID指定で読む**ので、削除側の blocked 書き込みと確実に競合する。
 */
export async function isScheduleDateBlockedInTx(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
): Promise<boolean> {
  const snap = await tx.get(scheduleLockRef(db, game, seasonId, date));
  return snap.exists && (snap.data() as { blocked?: boolean }).blocked === true;
}

/** 開催日を（再）追加したときにロックを解除する（削除済みトゥームストーンを消す）。 */
export async function clearScheduleLock(
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
): Promise<void> {
  await scheduleLockRef(db, game, seasonId, date).delete().catch(() => {});
}

/**
 * 1開催日を安全に削除（単日・一括で共用）。**2フェーズ**で「削除↔参加表明」を直列化する。
 * 1) ロックに blocked:true を書く（以降 entry POST は tx 内でこれを読み参加不可）。
 * 2) 参加者を再確認（strongly-consistent なクエリ get）。
 *    - 参加者がいれば blocked を解除して "skipped"（保護・削除しない）。
 *    - いなければ schedule doc を全消しし、ロックは **トゥームストーン（blocked のまま）** で残す
 *      → 削除完了後に来た参加表明も（ロック読み取りで）弾ける。再追加時に clearScheduleLock で解除。
 *
 * これにより「entryが先にcommit→削除がschedule削除」でも、
 * - entryが phase1 より前にcommit → 手順2の再確認で検知して skipped
 * - entryが phase1 より後にcommit → ロック(ID)読み取りが phase1 の書き込みと競合し abort→再試行→blockedで拒否
 * となり、**空クエリの範囲ロックに依存せず**孤児化を防ぐ。
 */
export async function deleteGameScheduleDate(
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
): Promise<"deleted" | "skipped"> {
  const col = GAME_SCHEDULE_CFG[game].col;
  const entryCol = `${game}Entries`;
  const lockRef = scheduleLockRef(db, game, seasonId, date);
  const now = new Date().toISOString();

  // Phase 1: 参加受付を止める（blocked)。以降の entry POST は tx 内のロック読み取りで弾かれる。
  await lockRef.set({ game, seasonId, date, blocked: true, updatedAt: now }, { merge: true });

  // 参加者を再確認（phase1 commit 後なので新規は入れない＝この時点の集合が確定）。
  const entrySnap = await db
    .collection(entryCol)
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", date)
    .limit(1)
    .get();
  if (!entrySnap.empty) {
    // 参加者あり＝保護。ロックを解除して受付を戻す。
    await lockRef.delete().catch(() => {});
    return "skipped";
  }

  // Phase 2: schedule doc を全消し（決定的ID＋旧auto-ID両方）。ロックはトゥームストーンで残す。
  const schedSnap = await db.collection(col).where("seasonId", "==", seasonId).where("date", "==", date).get();
  const batch = db.batch();
  batch.delete(db.collection(col).doc(buildGameScheduleId(seasonId, date)));
  for (const d of schedSnap.docs) batch.delete(d.ref);
  await batch.commit();
  return "deleted";
}
