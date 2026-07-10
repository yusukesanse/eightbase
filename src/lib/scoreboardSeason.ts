/** gameMasterIds を配列（非空文字の一意）に正規化。不正値は空配列。 */
export function sanitizeGameMasterIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v === "string" && v.trim()) seen.add(v.trim());
  }
  return Array.from(seen);
}
