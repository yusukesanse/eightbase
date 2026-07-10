/**
 * GM 手動卓振り分けの検証（純関数・サーバーで再検証）。
 * 要件 §3: paid のみ・重複なし・卓 ≤4名・支払い済み全員を過不足なく配置（8名=待機0 を含む）。
 */

export interface AssignTable { label: string; memberIds: string[] }

export const ASSIGN_VALID_LABELS = ["A", "B"];
export const ASSIGN_MAX_SEATS = 4;

export function validateGmAssignment(
  poolIds: string[],
  tables: AssignTable[],
  waiting: string[]
): { ok: true } | { ok: false; error: string } {
  const seenLabels = new Set<string>();
  for (const t of tables) {
    if (!ASSIGN_VALID_LABELS.includes(t.label)) return { ok: false, error: "卓ラベルが不正です" };
    if (seenLabels.has(t.label)) return { ok: false, error: "卓ラベルが重複しています" };
    seenLabels.add(t.label);
    if (t.memberIds.length > ASSIGN_MAX_SEATS) return { ok: false, error: `1卓は最大${ASSIGN_MAX_SEATS}名です` };
  }
  const placed = [...tables.flatMap((t) => t.memberIds), ...waiting];
  if (new Set(placed).size !== placed.length) {
    return { ok: false, error: "同じ参加者が複数の場所に配置されています" };
  }
  const pool = new Set(poolIds);
  for (const id of placed) {
    if (!pool.has(id)) return { ok: false, error: "支払い済みでない参加者が含まれています" };
  }
  // 全 paid を過不足なく配置（8名=待機0 もこの条件で満たされる）。
  if (placed.length !== pool.size) {
    return { ok: false, error: "支払い済み参加者を過不足なく配置してください" };
  }
  return { ok: true };
}
