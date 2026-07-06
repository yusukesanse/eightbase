/**
 * 自己申告スコアの異常検知（集計汚染の抑止）。
 * 申告は受理したまま（挙動不変）、疑わしい卓に needsReview を付けて管理者レビューへ回す。
 */

/** 1人が卓の持ち点の何割以上を占有したら結託疑いとみなすか。 */
export const SCORE_CONCENTRATION_THRESHOLD = 0.7;

/**
 * 卓の申告点数から異常フラグを判定する。
 * 通常の大勝でも稀な「1人が卓合計の70%以上を占有」を結託疑いとして flag する。
 */
export function isAnomalousScores(points: number[]): { flagged: boolean; reason: string | null } {
  if (points.length < 2) return { flagged: false, reason: null };
  const total = points.reduce((s, p) => s + p, 0);
  const max = Math.max(...points);
  if (total > 0 && max >= total * SCORE_CONCENTRATION_THRESHOLD) {
    return { flagged: true, reason: `1人が持ち点の${Math.round((max / total) * 100)}%を占有` };
  }
  return { flagged: false, reason: null };
}
