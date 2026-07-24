/**
 * ポーカーの開催日（第1・第3土曜）。`pokerSchedule` が「有効な開催日」の唯一の正。
 * 管理画面で登録・削除する。参加/決済の各 API はここで開催日の実在を確認する。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { buildPokerScheduleId } from "@/lib/pokerEntryValidation";
import type { PokerScheduleEntry } from "@/types/poker";

/** その開催日が登録済み（＝参加可能な開催日）か。中止(流会)は別途 isPokerCancelledDate。 */
export async function isScheduledPokerDate(seasonId: string, date: string): Promise<boolean> {
  const snap = await getDb().collection("pokerSchedule").doc(buildPokerScheduleId(seasonId, date)).get();
  return snap.exists;
}

/** その開催日が中止（流会）済みか。 */
export async function isPokerCancelledDate(eventDate: string): Promise<boolean> {
  const snap = await getDb().collection("pokerCancelledDates").doc(eventDate).get();
  return snap.exists;
}

/** シーズンの開催日一覧（date 昇順）。 */
export async function listPokerSchedule(seasonId: string): Promise<PokerScheduleEntry[]> {
  const snap = await getDb().collection("pokerSchedule").where("seasonId", "==", seasonId).get();
  return snap.docs
    .map((d) => d.data() as PokerScheduleEntry)
    .sort((a, b) => a.date.localeCompare(b.date));
}
