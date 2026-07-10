/**
 * 麻雀リーグ 開催日の中止（流会）。
 *
 * 締切が「GM がゲーム開始を押した瞬間」になったため、時刻を基準にした cron の自動中止は廃止し、
 * **GM が手動で中止する**方式に変えた（トリガーが変わっただけで、中止の中身は従来と同じ）。
 * 人数不足が主用途だが、雨天・設備トラブル等でも中止できるよう人数の下限は設けない。
 *
 * - 冪等: `mahjongCancelledDates/{eventDate}` の create をガードにし、二重押ししても1回だけ確定。
 * - 返金は Square で1件ずつ手動。ここでは対象を返金待ち(cancelRequested)にし、管理者へ一括依頼通知するのみ。
 *   金銭移動（自動返金）は行わない。
 * - 卓が既に立っている日（＝半荘が始まっている）は中止できない。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { notifyAdmin } from "@/lib/adminNotify";
import { sendMahjongForfeitNotice } from "@/lib/line";
import { MAHJONG_ENTRY_FEE, type MahjongEntry } from "@/types";

export type ForfeitResult =
  | { status: "already" } // 既に中止確定済み
  | { status: "closed" } // 休催日（管理者が事前に閉じた日）＝中止対象外
  | { status: "started" } // 卓が立っている（開催済み）＝中止できない
  | { status: "forfeited"; paidCount: number; refundCount: number };

/**
 * 指定開催日を中止確定する（GM が押す）。人数の下限は設けない。
 * @param gmUserId 中止を決めた GM の lineUserId（監査用に decidedBy へ残す）
 */
export async function cancelDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<ForfeitResult> {
  const db = getDb();
  const cancelRef = db.collection("mahjongCancelledDates").doc(eventDate);

  // 早期return（無駄な処理を避ける）
  if ((await cancelRef.get()).exists) return { status: "already" };

  // 休催日（管理者が事前に閉じた土曜）は中止の対象外。startDay も休催日は卓を組まない。
  if ((await db.collection("mahjongClosedDates").doc(eventDate).get()).exists) {
    return { status: "closed" };
  }

  // 既に卓が立っている＝半荘が始まっている。ここで中止すると成績が壊れる。
  const tblSnap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  if (!tblSnap.empty) return { status: "started" };

  const entrySnap = await db
    .collection("mahjongEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  const entries = entrySnap.docs.map((d) => ({ id: d.id, ...(d.data() as MahjongEntry) }));

  const seated = entries.filter((e) => deriveStatus(e) === "paid"); // 支払い済み（staff含む）
  const reserved = entries.filter((e) => deriveStatus(e) === "reserved"); // 未決済

  const nowIso = new Date().toISOString();

  // 中止を確定（create をガードに冪等化。同時押しは片方だけ勝つ）
  try {
    await cancelRef.create({
      seasonId,
      eventDate,
      reason: "insufficient",
      paidCount: seated.length,
      decidedAt: nowIso,
      decidedBy: gmUserId,
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
  // 巻き戻す（cancelledDates を削除）ことで、GM が押し直せるようにする
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
    `${eventDate} は中止（流会）。返金対象 ${refundable.length}名（Squareで手動返金）。`,
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
