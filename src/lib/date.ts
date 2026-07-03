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
