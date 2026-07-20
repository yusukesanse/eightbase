/**
 * ビリヤードリーグ 当日進行（GM・試合ログ方式）の状態機械。
 * 要件: docs/games/billiards/ビリヤード-ルール草案.md §2〜§3。
 *
 * ダーツ dartsDay の読み替え。差分:
 *  - 種目進行ではなく **試合ログ**（GMが「対戦カード＋勝敗＋敗者の玉数」を1件ずつ記録）。
 *  - 「本日終了」で当日の全試合を集計し、参加者ごとに scores を書く（勝者14pt/敗者=玉数の累積）。
 *
 * 状態は billiardsDayState/{seasonId}_{eventDate} の単一 doc に集約（＝唯一の真実）。
 * Firestore 読み取り節約: エントリー取得は where(seasonId==).where(eventDate==) の等値2条件。
 *
 * ※ 本ファイルの P2 時点では 状態取得・締切判定・参加者取得のみ。start/logMatch/finish/cancel は P3。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/billiardsEntryStatus";
import type { BilliardsDayState, BilliardsDayMember, BilliardsEntry } from "@/types/billiards";

export const billiardsDayId = (seasonId: string, eventDate: string) => `${seasonId}_${eventDate}`;

/** 当日の状態を取得（未開始なら null）。 */
export async function getBilliardsDayState(
  seasonId: string,
  eventDate: string
): Promise<BilliardsDayState | null> {
  const snap = await getDb().collection("billiardsDayState").doc(billiardsDayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as BilliardsDayState) : null;
}

/** この開催日の受付（参加表明・支払い）が締め切られているか＝GM が「ゲーム開始」を押したか。 */
export function isBilliardsEntryClosed(day: BilliardsDayState | null): boolean {
  return !!day?.entryClosedAt;
}

/** 支払い済み参加者（staff は POST 時点で paid）。enteredAt 昇順 FIFO。 */
export async function fetchBilliardsParticipants(
  seasonId: string,
  eventDate: string
): Promise<BilliardsDayMember[]> {
  const snap = await getDb()
    .collection("billiardsEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  return snap.docs
    .map((d) => ({ ...(d.data() as BilliardsEntry), entryId: d.id }))
    .filter((e) => deriveStatus(e) === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));
}
