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
