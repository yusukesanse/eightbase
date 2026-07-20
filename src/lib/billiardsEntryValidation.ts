/**
 * ビリヤード エントリー系 API 共通の入力バリデーション・IDヘルパー・開催日ユーティリティ。
 * ★ 有効な開催日は `billiardsSchedule` コレクション（管理登録＝第2/第4土曜）が正。
 *   ここには曜日の純関数（第2/第4土曜の生成・土曜判定）だけを置く。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidBilliardsDate(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function isValidDocId(value: unknown): value is string {
  return typeof value === "string" && DOC_ID_RE.test(value);
}

export function buildBilliardsEntryId(seasonId: string, eventDate: string, lineUserId: string): string {
  return `${seasonId}_${eventDate}_${lineUserId}`;
}

export function buildBilliardsScheduleId(seasonId: string, date: string): string {
  return `${seasonId}_${date}`;
}

/** YYYY-MM-DD を UTC正午基準で土曜(=6)か判定（本番 TZ=UTC 対策）。 */
export function isSaturdayDate(dateStr: string): boolean {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 6;
}

/** その年月(0始まり month)の n 番目(1..)の土曜の YYYY-MM-DD（UTC正午基準）。 */
function nthSaturdayOfMonth(year: number, month0: number, n: number): string {
  const first = new Date(Date.UTC(year, month0, 1, 12));
  const shift = (6 - first.getUTCDay() + 7) % 7; // 1日から最初の土曜まで
  const day = 1 + shift + (n - 1) * 7;
  const d = new Date(Date.UTC(year, month0, day, 12));
  return d.toISOString().slice(0, 10);
}

/**
 * 起点月以降の「第2・第4土曜」を count 個生成（管理画面の一括登録用・昇順）。
 * 起点が YYYY-MM-DD のときは、その日以降の第2/第4土曜だけを含める。
 */
export function generateSecondFourthSaturdays(startDate: string, count: number): string[] {
  const base = new Date(`${startDate.slice(0, 7)}-01T12:00:00Z`);
  const startYmd = DATE_RE.test(startDate) ? startDate : `${startDate.slice(0, 7)}-01`;
  const out: string[] = [];
  let y = base.getUTCFullYear();
  let m = base.getUTCMonth();
  let guard = 0;
  while (out.length < Math.max(0, count) && guard++ < 120) {
    for (const n of [2, 4]) {
      const d = nthSaturdayOfMonth(y, m, n);
      if (d >= startYmd && out.length < count) out.push(d);
    }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}
