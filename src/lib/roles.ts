/**
 * 参加者種別（role）の共通定義とヘルパー。client/server で判定を統一する。
 *
 * - `member` … 会員（オフィス利用者。ガイドの "visitor"）。全機能利用可。麻雀は**支払い必要**。
 * - `guest`  … ゲスト。ゲーム系のみ。麻雀は**支払い必要**。
 * - `staff`  … エイト社員（ガイドの "member"）。ゲーム系のみ（施設利用は別手段）。麻雀は**支払い不要**。
 *
 * role 未設定の既存レコードは `member` 扱い（後方互換）。
 */

export type UserRole = "member" | "guest" | "staff";

/** 文字列を正規の UserRole に丸める（未知/未設定は member）。 */
export function normalizeRole(role: unknown): UserRole {
  return role === "guest" || role === "staff" ? role : "member";
}

/**
 * ゲーム系ルートのみ許可される role か（会員専用の予約・掲示板・メンバー一覧は不可）。
 * guest と staff（エイト社員）が該当。
 */
export function isGamesOnlyRole(role: unknown): boolean {
  return role === "guest" || role === "staff";
}

/**
 * 麻雀リーグの参加費（3,000円）支払いが必要な role か。
 * 会員(member)・ゲスト(guest)は必要、エイト社員(staff)は不要。
 */
export function mahjongPaymentRequired(role: unknown): boolean {
  return normalizeRole(role) !== "staff";
}

/** 表示ラベル。 */
export const ROLE_LABELS: Record<UserRole, string> = {
  member: "会員",
  guest: "ゲスト",
  staff: "エイト社員",
};
