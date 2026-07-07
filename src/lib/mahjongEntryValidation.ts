/**
 * 麻雀エントリー系 API で共通利用する入力バリデーション・IDヘルパー。
 * ルートごとに正規表現を重複定義しないための薄い集約。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]+$/;

/** YYYY-MM-DD 形式の文字列か。 */
export function isValidMahjongDate(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

/** Firestore のドキュメントIDとして安全な文字列か。 */
export function isValidDocId(value: unknown): value is string {
  return typeof value === "string" && DOC_ID_RE.test(value);
}

/** 麻雀エントリーIDの決定的フォーマット。 */
export function buildMahjongEntryId(
  seasonId: string,
  eventDate: string,
  lineUserId: string
): string {
  return `${seasonId}_${eventDate}_${lineUserId}`;
}

/** 参加開催日は土曜のみ。YYYY-MM-DD を UTC正午基準で判定してTZズレを防ぐ。 */
export function isSaturdayMahjongDate(dateStr: string): boolean {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 6;
}
