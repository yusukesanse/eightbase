/** ルール・約款（Markdown）の最大文字数。Firestore の 1MB/doc に余裕をもたせる。 */
export const SEASON_MARKDOWN_MAX = 20000;

/**
 * ルール・約款の Markdown を正規化する。
 * @returns 正規化後の文字列 / 長すぎる等で不正なら null
 */
export function sanitizeSeasonMarkdown(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return "";
  if (typeof input !== "string") return null;
  const v = input.trim();
  return v.length > SEASON_MARKDOWN_MAX ? null : v;
}

/** gameMasterIds を配列（非空文字の一意）に正規化。不正値は空配列。 */
export function sanitizeGameMasterIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v === "string" && v.trim()) seen.add(v.trim());
  }
  return Array.from(seen);
}

/** HH:MM（24時間表記）か。日程の開始/終了時刻の検証に使う。 */
export function isValidHhMm(input: unknown): input is string {
  return typeof input === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input);
}

/**
 * 開催の既定時刻を正規化する。空文字/未指定は undefined（＝コード既定値へフォールバック）。
 * @returns 正規化後の値 / 形式不正なら null
 */
export function sanitizeScheduleTime(input: unknown): string | undefined | null {
  if (input === null || input === undefined || input === "") return undefined;
  return isValidHhMm(input) ? input : null;
}
