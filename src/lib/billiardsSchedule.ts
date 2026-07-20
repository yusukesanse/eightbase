/**
 * ビリヤードの開催日（第2・第4土曜）。`billiardsSchedule` が「有効な開催日」の唯一の正。
 * 管理画面で登録・削除する。参加/決済の各 API はここで開催日の実在を確認する。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { buildBilliardsScheduleId } from "@/lib/billiardsEntryValidation";
import type { BilliardsScheduleEntry } from "@/types/billiards";

/** その開催日が登録済み（＝参加可能な開催日）か。中止(流会)は別途 isBilliardsCancelledDate。 */
export async function isScheduledBilliardsDate(seasonId: string, date: string): Promise<boolean> {
  const snap = await getDb().collection("billiardsSchedule").doc(buildBilliardsScheduleId(seasonId, date)).get();
  return snap.exists;
}

/** その開催日が中止（流会）済みか。 */
export async function isBilliardsCancelledDate(eventDate: string): Promise<boolean> {
  const snap = await getDb().collection("billiardsCancelledDates").doc(eventDate).get();
  return snap.exists;
}

/** シーズンの開催日一覧（date 昇順）。 */
export async function listBilliardsSchedule(seasonId: string): Promise<BilliardsScheduleEntry[]> {
  const snap = await getDb().collection("billiardsSchedule").where("seasonId", "==", seasonId).get();
  return snap.docs
    .map((d) => d.data() as BilliardsScheduleEntry)
    .sort((a, b) => a.date.localeCompare(b.date));
}
