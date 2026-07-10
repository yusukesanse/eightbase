/**
 * 麻雀リーグ 人数不足による自動中止（流会）。
 *
 * 開催日の締切（＝開始時刻）を過ぎても支払い済み参加者が最低成立人数（4名）に満たない
 * 場合、その開催日を「中止」確定する。要件定義: docs/麻雀リーグ-人数不足自動中止-要件定義.md。
 *
 * - 冪等: `mahjongCancelledDates/{eventDate}` の create をガードにし、二重実行しても1回だけ確定。
 * - 返金は Square で1件ずつ手動。ここでは対象を返金待ち(cancelRequested)にし、管理者へ一括依頼通知するのみ。
 *   金銭移動（自動返金）は行わない。
 * - 呼び出しは cron（本番ガード＝checkCronAuth）から。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { notifyAdmin } from "@/lib/adminNotify";
import { sendMahjongForfeitNotice } from "@/lib/line";
import { MAHJONG_ENTRY_FEE, type MahjongEntry, type MahjongTable } from "@/types";

/** 最低成立人数（支払い済み＝staff含む）。これ未満で中止。 */
export const MAHJONG_MIN_PARTICIPANTS = 4;

export type ForfeitResult =
  | { status: "already" } // 既に中止確定済み
  | { status: "closed" } // 休催日（管理者が事前に閉じた日）＝流会対象外
  | { status: "started" } // 卓が立っている（開催済み）
  | { status: "ok"; paidCount: number } // 成立（中止しない）
  | { status: "no-participants" } // 支払い済み参加者ゼロ（返金不要・記録しない）
  | { status: "forfeited"; paidCount: number; refundCount: number };

/**
 * 指定開催日を、人数不足なら中止確定する。締切判定（時刻）は呼び出し側（cron）で行う。
 */
export async function forfeitDayIfInsufficient(
  seasonId: string,
  eventDate: string
): Promise<ForfeitResult> {
  const db = getDb();
  const cancelRef = db.collection("mahjongCancelledDates").doc(eventDate);

  // 早期return（無駄な処理を避ける）
  if ((await cancelRef.get()).exists) return { status: "already" };

  // 休催日（管理者が事前に閉じた土曜）は流会の対象外（要件§3）。startDay も休催日は卓を組まない。
  if ((await db.collection("mahjongClosedDates").doc(eventDate).get()).exists) {
    return { status: "closed" };
  }

  // 既に卓が立っている（4名以上で開催済み）＝対象外
  const tblSnap = await db.collection("mahjongTables").where("seasonId", "==", seasonId).get();
  if (tblSnap.docs.some((d) => (d.data() as MahjongTable).eventDate === eventDate)) {
    return { status: "started" };
  }

  // 当該日のエントリーを集計
  const entrySnap = await db.collection("mahjongEntries").where("seasonId", "==", seasonId).get();
  const entries = entrySnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MahjongEntry) }))
    .filter((e) => e.eventDate === eventDate);

  const seated = entries.filter((e) => deriveStatus(e) === "paid"); // 成立カウント（staff含む）
  const reserved = entries.filter((e) => deriveStatus(e) === "reserved"); // 未決済

  if (seated.length >= MAHJONG_MIN_PARTICIPANTS) return { status: "ok", paidCount: seated.length };
  if (seated.length === 0) return { status: "no-participants" }; // 返金対象なし＝記録しない

  const nowIso = new Date().toISOString();

  // 中止を確定（create をガードに冪等化。並行cronは片方だけ勝つ）
  try {
    await cancelRef.create({
      seasonId,
      eventDate,
      reason: "insufficient",
      paidCount: seated.length,
      decidedAt: nowIso,
      decidedBy: "system",
    });
  } catch {
    return { status: "already" };
  }

  // 実際に決済した人＝返金対象。staff（免除・paymentTransactionId 無し）は返金しない。
  const refundable = seated.filter((e) => !!e.paymentTransactionId);
  const month = eventDate.slice(0, 7); // YYYY-MM

  const batch = db.batch();
  for (const e of refundable) {
    batch.set(
      db.collection("mahjongEntries").doc(e.id),
      {
        status: "cancelRequested",
        paymentStatus: "cancelRequested",
        cancelReason: "forfeit",
        cancelRequestedAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );
  }
  // 未決済は静かに削除（未決済の取消はレコード削除＝状態遷移外）。
  for (const e of reserved) {
    batch.delete(db.collection("mahjongEntries").doc(e.id));
  }
  // 月1回ロックを解放し、当月の別の土曜に参加し直せるようにする（seated + reserved 全員）。
  for (const e of [...seated, ...reserved]) {
    batch.delete(db.collection("mahjongMonthlyLocks").doc(`${seasonId}_${e.lineUserId}_${month}`));
  }

  // create(中止確定) と batch(エントリー更新) は原子的でない。batch が失敗したら中止確定を
  // 巻き戻す（cancelledDates を削除）ことで、次回 cron 実行で再試行できるようにする
  // （部分適用＝「中止確定済みだがエントリー未更新」の宙ぶらりんを残さない）。
  try {
    await batch.commit();
  } catch (e) {
    await cancelRef.delete().catch(() => {});
    throw e;
  }

  // 通知（コミット成功後のみ。失敗時は上で throw 済みで到達しない）
  await notifyAdmin(
    "mahjong_event_forfeit",
    `${eventDate} は人数不足で中止。返金対象 ${refundable.length}名（Squareで手動返金）。`,
    {
      eventDate,
      paidCount: seated.length,
      refundCount: refundable.length,
      refunds: refundable.map((e) => ({
        entryId: e.id,
        displayName: e.displayName,
        amount: e.paymentAmount ?? MAHJONG_ENTRY_FEE,
        orderId: e.paymentTransactionId ?? null,
      })),
    }
  );

  // 参加者（着席予定者＝staff含む）へ中止をLINEプッシュ。冪等ガードにより1回だけ実行される。
  await Promise.allSettled(
    seated.map((e) => sendMahjongForfeitNotice(e.lineUserId, { eventDate }))
  );

  return { status: "forfeited", paidCount: seated.length, refundCount: refundable.length };
}
