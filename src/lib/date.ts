/** 日付/時刻の共通ヘルパー（サーバー/クライアント両用の純関数）。 */

/** 今日（Asia/Tokyo 基準の YYYY-MM-DD）。 */
export function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/** 直近の土曜（今日が土曜なら今日）を YYYY-MM-DD で返す。麻雀の開催日は土曜のみ。 */
export function upcomingSaturdayJst(): string {
  const base = new Date(`${todayJst()}T00:00:00Z`).getTime();
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base + i * 86400000);
    if (dt.getUTCDay() === 6) return dt.toISOString().slice(0, 10);
  }
  return todayJst();
}

/**
 * YYYY-MM-DD の曜日（0=日 … 6=土）。
 * `getDay()` はサーバーのローカルTZに依存し、Vercel(UTC)では前日の曜日になるため使わない。
 * UTC正午基準で解釈して getUTCDay() で読む（isSaturdayMahjongDate と同じ方式）。
 */
export function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** "HH:MM" を 0時からの分に変換。 */
export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** 開催日まで残り日数（Asia/Tokyo・当日=0）。today はテスト用に注入可。 */
export function daysUntil(eventDate: string, today: string = todayJst()): number {
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const target = new Date(`${eventDate}T00:00:00Z`).getTime();
  return Math.round((target - start) / 86400000);
}

/** 麻雀参加費のキャンセル期限（7日前まで可・6日前以降は返金不可）。 */
export const MAHJONG_CANCEL_DEADLINE_DAYS = 7;
/** 全画面/APIで共通のキャンセル規定文言。 */
export const MAHJONG_CANCEL_POLICY = `キャンセルは開催日の${MAHJONG_CANCEL_DEADLINE_DAYS}日前まで可能です（6日前以降は返金できません）。`;
export function canCancelMahjong(eventDate: string, today: string = todayJst()): boolean {
  return daysUntil(eventDate, today) >= MAHJONG_CANCEL_DEADLINE_DAYS;
}
