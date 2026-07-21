/**
 * ダーツ クリケットのチーム編成検証（GM がドラッグ&ドロップで編成・§2.4）。
 * 麻雀 mahjongAssign の validateGmAssignment を「2人1組（奇数は1人チーム可）」に読み替えたもの。
 *
 * ゼロワン・カウントアップは個人戦なので編成は不要。クリケットのみ本検証を通す。
 */

import type { DartsTeam } from "@/types/darts";
import { isSafeTeamId } from "@/lib/dartsEntryValidation";

export type CricketAssignResult = { ok: true } | { ok: false; error: string };

/**
 * クリケットの編成が妥当か。
 * - 各チームは 1〜2 名（2人1組・奇数のみ1人チーム）。
 * - teamId は重複しない。
 * - 参加者全員がちょうど1チームに所属（過不足なし・二重所属なし）。
 * - 置いた全員が participants に含まれる（部外者混入なし）。
 *
 * 空チーム（memberIds が空）は呼び出し側で除去してから渡すこと。
 */
export function validateCricketTeams(
  participantIds: string[],
  teams: DartsTeam[]
): CricketAssignResult {
  const pool = new Set(participantIds);

  const seenTeamIds = new Set<string>();
  const placed = new Set<string>();

  for (const t of teams) {
    // teamId は reports のマップキー（＝Firestoreフィールド名）になるため、
    // プロトタイプ汚染・特殊プロパティ・危険な文字を弾く。
    if (!isSafeTeamId(t.teamId) || seenTeamIds.has(t.teamId)) {
      return { ok: false, error: "チームIDが不正または重複しています" };
    }
    seenTeamIds.add(t.teamId);

    const size = t.memberIds.length;
    if (size < 1 || size > 2) {
      return { ok: false, error: "1チームは1〜2名で編成してください（2人1組・奇数のみ1人）" };
    }

    for (const id of t.memberIds) {
      if (!pool.has(id)) {
        return { ok: false, error: "参加者以外がチームに含まれています" };
      }
      if (placed.has(id)) {
        return { ok: false, error: "同じ人が複数のチームに含まれています" };
      }
      placed.add(id);
    }
  }

  if (placed.size !== pool.size) {
    return { ok: false, error: "全員をいずれかのチームに割り当ててください" };
  }

  return { ok: true };
}
