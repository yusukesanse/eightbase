/**
 * 参加者種別（role）の共通定義とヘルパー。client/server で判定を統一する。
 *
 * - `member` … 会員（オフィス利用者。ガイドの "visitor"）。全機能利用可。麻雀は**支払い必要**。
 * - `guest`  … ゲスト。ゲーム系のみ。麻雀は**支払い必要**。
 * - `staff`  … エイト社員（ガイドの "member"）。**会員同等の全機能**を利用可（予約・掲示板・メンバー等）。
 *              麻雀を含む**全ゲームの参加費は免除**。登録は URL 招待の別導線（guest と共通）。
 *
 * role 未設定の既存レコードは `member` 扱い（後方互換）。
 *
 * ⚠️ 「機能アクセス範囲（isGamesOnlyRole）」と「招待導線（usesUrlInvite）」は別軸。
 * staff は機能は会員同等だが招待は URL 方式なので、両者を混同して 1 つのヘルパーに束ねないこと。
 */

export type UserRole = "member" | "guest" | "staff";

/** 文字列を正規の UserRole に丸める（未知/未設定は member）。 */
export function normalizeRole(role: unknown): UserRole {
  return role === "guest" || role === "staff" ? role : "member";
}

/**
 * ゲーム系ルートのみ許可される role か（会員専用の予約・掲示板・メンバー一覧は不可）。
 * **guest のみ** true。staff は会員同等に利用範囲を拡大したため対象外（＝全機能可）。
 */
export function isGamesOnlyRole(role: unknown): boolean {
  return normalizeRole(role) === "guest";
}

/**
 * URL(first-clicker)方式で招待・オンボードする role か（guest / staff）。会員は OTP 方式。
 * 招待の引き換え可否・氏名確認導線の判定に使う（機能アクセス範囲とは別軸）。
 */
export function usesUrlInvite(role: unknown): boolean {
  const r = normalizeRole(role);
  return r === "guest" || r === "staff";
}

/**
 * 麻雀リーグ等のゲーム参加費の支払いが必要な role か。
 * 会員(member)・ゲスト(guest)は必要、エイト社員(staff)は不要（全ゲーム免除）。
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
