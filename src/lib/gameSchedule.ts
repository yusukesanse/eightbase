/**
 * 全ゲーム共通の日程（{game}Schedule）操作の集約。管理カレンダーAPIと利用者検証で共用する。
 *
 * ★開催日「削除↔参加表明↔再追加」の競合対策（空クエリの範囲ロックに依存しない設計）★
 * Firestore はトランザクションが「読んだドキュメントID」（存在しないIDも含む）への並行書き込みを
 * 競合として検出するが、空クエリ結果に対する後続 insert（phantom）は直列化を保証しない。
 * そこで開催日ごとに **決定的なロックドキュメント** `scheduleLocks/{game}__{seasonId}__{date}` を用意し、
 *  - `blocked`: 削除中/削除済みで参加を止めるフラグ
 *  - `operationId`: 削除操作の世代（generation）。削除の phase2 は「自分の operationId が依然ロックに
 *    残っているか」を tx 内で確認してから schedule を消す。再追加はロックを削除するので、
 *    途中で再追加されたら operationId が消え、phase2 は schedule を消さずに中断する。
 * これにより **「schedule 削除 ⟹ blocked ロックが必ず残る」** 不変条件を保証し、
 * 「schedule 無し・lock 無し」（孤児化可能）状態を作らない。
 */

import { randomUUID } from "crypto";
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

interface ScheduleLock { blocked?: boolean; operationId?: string }

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
  return snap.exists && (snap.data() as ScheduleLock).blocked === true;
}

/**
 * 開催日を（再）追加する。schedule doc 作成と **ロック解除を1トランザクションで原子化**する
 * （途中失敗で「schedule あり・lock 残存」の部分状態を作らない）。
 * @returns 追加した date（成功時）
 */
export async function addGameScheduleDate(
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string
): Promise<void> {
  const cfg = GAME_SCHEDULE_CFG[game];
  const now = new Date().toISOString();
  const schedRef = db.collection(cfg.col).doc(buildGameScheduleId(seasonId, date));
  const lockRef = scheduleLockRef(db, game, seasonId, date);
  await db.runTransaction(async (tx) => {
    await tx.get(lockRef); // ロックを読み、削除操作(operationId書き込み)と競合させる
    tx.set(schedRef, { scheduleId: buildGameScheduleId(seasonId, date), seasonId, date, startTime: cfg.start, endTime: cfg.end, createdAt: now, ...(cfg.extra ?? {}) });
    tx.delete(lockRef); // 削除トゥームストーンを解除（再追加で受付再開）
  });
}

export type DeleteResult = "deleted" | "skipped" | "reAdded";

/**
 * テスト専用フック（本番挙動には影響しない）。統合テストで phase1 と phase2 の間に
 * 「同日の再追加」を決定的に割り込ませ、reAdded 経路を再現するために使う。
 * 未指定時は何もしない（既存呼び出しは完全に不変）。
 */
export interface DeleteScheduleTestHooks {
  beforePhase2?: () => Promise<void> | void;
}

/**
 * 1開催日を安全に削除（単日・一括で共用）。**operationId 付き2フェーズ**で
 * 「削除↔参加表明↔再追加」を直列化する。
 * 1) ロックに `blocked:true, operationId=op` を書く（tx。以降 entry POST は tx 内でこれを読み参加不可）。
 * 2) 参加者を再確認（strongly-consistent get）。
 *    - 参加者がいれば **自分の op のときだけ** blocked を解除して "skipped"（保護）。
 * 3) phase2（tx）: ロックを再読し **operationId が自分のものでなければ "reAdded"（削除しない）**。
 *    自分のものなら schedule doc を全消しし、ロックは blocked トゥームストーン（operationId 保持）で残す。
 *
 * 保証: 「schedule 削除 ⟹ blocked ロックが残る」。再追加が割り込めば phase2 は schedule を消さない。
 * ロック解除失敗は握り潰さず throw する（呼び出し側で失敗として可視化）。
 */
export async function deleteGameScheduleDate(
  db: FirebaseFirestore.Firestore,
  game: ScheduleGame,
  seasonId: string,
  date: string,
  testHooks?: DeleteScheduleTestHooks
): Promise<DeleteResult> {
  const col = GAME_SCHEDULE_CFG[game].col;
  const entryCol = `${game}Entries`;
  const lockRef = scheduleLockRef(db, game, seasonId, date);
  const opId = randomUUID();
  const now = new Date().toISOString();

  // Phase 1: 自分の operationId でロックを取得（blocked）。
  await db.runTransaction(async (tx) => {
    await tx.get(lockRef);
    tx.set(lockRef, { game, seasonId, date, blocked: true, operationId: opId, updatedAt: now }, { merge: true });
  });

  // 参加者を再確認（phase1 commit 後。新規は blocked で入れない＝この時点の集合が確定）。
  const entrySnap = await db
    .collection(entryCol)
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", date)
    .limit(1)
    .get();
  if (!entrySnap.empty) {
    // 参加者あり＝保護。**自分の op のときだけ** ロックを解除（再追加や他opのロックを壊さない）。
    // 解除失敗は throw（握り潰さない）。
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      if (snap.exists && (snap.data() as ScheduleLock).operationId === opId) tx.delete(lockRef);
    });
    return "skipped";
  }

  // テスト専用: phase1 と phase2 の間に「再追加」等を割り込ませて reAdded 経路を再現する。
  if (testHooks?.beforePhase2) await testHooks.beforePhase2();

  // Phase 2: 自分が依然ロックを保持している時だけ schedule を削除。再追加が割り込んでいたら中断。
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    if (!lockSnap.exists || (lockSnap.data() as ScheduleLock).operationId !== opId) {
      return "reAdded"; // 再追加/他opがロックを置き換えた → schedule を消さない
    }
    const schedSnap = await tx.get(db.collection(col).where("seasonId", "==", seasonId).where("date", "==", date));
    tx.delete(db.collection(col).doc(buildGameScheduleId(seasonId, date)));
    for (const d of schedSnap.docs) tx.delete(d.ref);
    // ロックは blocked トゥームストーンで残す（削除完了後の参加も弾く）。operationId は保持。
    tx.set(lockRef, { game, seasonId, date, blocked: true, operationId: opId, deleted: true, updatedAt: now }, { merge: true });
    return "deleted";
  });
}
