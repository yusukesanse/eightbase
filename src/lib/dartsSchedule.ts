/**
 * ダーツの開催日（隔週木曜）。`dartsSchedule` コレクションが「有効な開催日」の唯一の正。
 * 管理画面で登録・削除する。参加/決済の各 API はここで開催日の実在を確認する。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { buildDartsScheduleId } from "@/lib/dartsEntryValidation";
import type { DartsScheduleEntry } from "@/types/darts";

/** その開催日が登録済み（＝参加可能な開催日）か。中止(流会)は別途 isDartsCancelled で確認。 */
export async function isScheduledDartsDate(seasonId: string, date: string): Promise<boolean> {
  const snap = await getDb().collection("dartsSchedule").doc(buildDartsScheduleId(seasonId, date)).get();
  return snap.exists;
}

/** その開催日が中止（流会）済みか。 */
export async function isDartsCancelledDate(eventDate: string): Promise<boolean> {
  const snap = await getDb().collection("dartsCancelledDates").doc(eventDate).get();
  return snap.exists;
}

/** シーズンの開催日一覧（date 昇順）。 */
export async function listDartsSchedule(seasonId: string): Promise<DartsScheduleEntry[]> {
  const snap = await getDb().collection("dartsSchedule").where("seasonId", "==", seasonId).get();
  return snap.docs
    .map((d) => d.data() as DartsScheduleEntry)
    .sort((a, b) => a.date.localeCompare(b.date));
}
