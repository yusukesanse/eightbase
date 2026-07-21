/**
 * 麻雀の開催日を「明示スケジュール（mahjongSchedule）」に統一するための集約。
 * 全ゲーム（麻雀/ダーツ/ビリヤード）で日程を mahjongSchedule/{game}Schedule の doc として持ち、
 * 管理カレンダーで任意日を追加/削除できるようにする（土→日への移動も可）。
 *
 * 後方互換（本番安全）: あるシーズンにスケジュール doc が1件も無い＝未移行とみなし、
 * 従来の「毎週土曜 − 休催(mahjongClosedDates)」にフォールバックする。
 * スケジュール doc が1件でもあれば、そのシーズンは schedule 駆動（＝doc にある日のみ開催）。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { isSaturdayMahjongDate } from "@/lib/mahjongEntryValidation";

/** 統一スケジュール doc の決定的ID（ダーツ/ビリヤードと同方式）。 */
export function buildMahjongScheduleId(seasonId: string, date: string): string {
  return `${seasonId}_${date}`;
}

/** そのシーズンのリーグ開催日（type!=="league" は除外）の集合。 */
export async function listMahjongScheduleDates(seasonId: string): Promise<Set<string>> {
  const snap = await getDb().collection("mahjongSchedule").where("seasonId", "==", seasonId).get();
  const dates = new Set<string>();
  for (const d of snap.docs) {
    const x = d.data() as { date?: string; type?: string };
    if (x.type && x.type !== "league") continue; // CS などは開催日に含めない
    if (x.date) dates.add(x.date);
  }
  return dates;
}

/**
 * 開催日が有効かを純粋に判定（テスト可能）。
 * - schedule 駆動（scheduledDates が非空）: date がその集合に含まれるか。
 * - 未移行（scheduledDates が空）: 毎週土曜 かつ 休催でない。
 */
export function resolveMahjongEventDate(args: {
  scheduledDates: Set<string> | string[];
  date: string;
  isSaturday: boolean;
  isClosed: boolean;
}): boolean {
  const set = args.scheduledDates instanceof Set ? args.scheduledDates : new Set(args.scheduledDates);
  if (set.size > 0) return set.has(args.date);
  return args.isSaturday && !args.isClosed;
}

/** 開催日として参加可能か（schedule 駆動 or 土曜フォールバック）。 */
export async function isMahjongEventDate(seasonId: string, date: string): Promise<boolean> {
  const scheduledDates = await listMahjongScheduleDates(seasonId);
  if (scheduledDates.size > 0) return scheduledDates.has(date);
  if (!isSaturdayMahjongDate(date)) return false;
  const closed = await getDb().collection("mahjongClosedDates").doc(date).get();
  return !closed.exists;
}

/** start〜end（YYYY-MM-DD・両端含む）の全土曜を UTC 基準で生成。麻雀の初期投入用。 */
export function generateWeeklySaturdays(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  // 起点以降の最初の土曜へ。
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  const out: string[] = [];
  let guard = 0;
  while (d <= end && guard++ < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
