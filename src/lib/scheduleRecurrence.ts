/**
 * 開催日の「繰り返し生成」（Google カレンダーの繰り返し設定のようなもの）。
 * 曜日（0=日〜6=土）× 間隔（毎週=1 / 2週に1回=2 / 3週に1回=3 …）× 期間[startDate, endDate] で日付を列挙。
 * 全ゲーム共通・UTC 正午基準で TZ 非依存。純関数（テスト可能）。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export interface RecurrenceInput {
  weekday: number; // 0=日 … 6=土
  intervalWeeks: number; // 1=毎週, 2=隔週, 3=3週に1回 …
  startDate: string; // YYYY-MM-DD（この日以降の最初の該当曜日から）
  endDate: string; // YYYY-MM-DD（この日まで）
}

/** 曜日×間隔×期間で開催日（YYYY-MM-DD 昇順）を生成。入力不正は空配列。 */
export function generateRecurringDates(input: RecurrenceInput): string[] {
  const { weekday, intervalWeeks, startDate, endDate } = input;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return [];
  if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 8) return [];
  if (!isRealDate(startDate) || !isRealDate(endDate)) return [];

  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (start > end) return [];

  // 起点以降の最初の該当曜日へ。
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));

  const out: string[] = [];
  let guard = 0;
  while (d <= end && guard++ < 1040) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7 * intervalWeeks);
  }
  return out;
}

/**
 * 一括削除の対象を仕分ける（純関数）。参加者がいる日（entryDates）は保護してスキップする。
 * all=true で全期間、そうでなければ [from, to] の期間内のみを対象にする。
 */
export function partitionScheduleForDelete(
  scheduleDates: string[],
  entryDates: Set<string> | string[],
  opts: { all?: boolean; from?: string; to?: string }
): { toDelete: string[]; skipped: string[] } {
  const entrySet = entryDates instanceof Set ? entryDates : new Set(entryDates);
  const toDelete: string[] = [];
  const skipped: string[] = [];
  for (const dt of scheduleDates) {
    if (!opts.all) {
      if (!opts.from || !opts.to || dt < opts.from || dt > opts.to) continue; // 期間外は対象外
    }
    if (entrySet.has(dt)) skipped.push(dt);
    else toDelete.push(dt);
  }
  return { toDelete: toDelete.sort(), skipped: skipped.sort() };
}
