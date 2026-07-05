/** 日付/時刻の共通ヘルパー（サーバー/クライアント両用の純関数）。 */

/** 今日（Asia/Tokyo 基準の YYYY-MM-DD）。 */
export function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/** "HH:MM" を 0時からの分に変換。 */
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** 開催日まで残り日数（Asia/Tokyo・当日=0）。 */
export function daysUntil(eventDate: string): number {
  const start = new Date(`${todayJst()}T00:00:00Z`).getTime();
  const target = new Date(`${eventDate}T00:00:00Z`).getTime();
  return Math.round((target - start) / 86400000);
}

/** 麻雀参加費のキャンセル期限（7日前まで可・6日前以降は返金不可）。 */
export const MAHJONG_CANCEL_DEADLINE_DAYS = 7;
export function canCancelMahjong(eventDate: string): boolean {
  return daysUntil(eventDate) >= MAHJONG_CANCEL_DEADLINE_DAYS;
}
