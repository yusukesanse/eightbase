/**
 * トレーラー等の決済フロー: 「決済前の pending予約」の有効分数。
 *
 * 「決済する」時に pending_payment 予約＋TTL付きロックを作り、決済後リダイレクト
 * （/reservation/complete?rid=...）で確定する。予約の特定は URL の rid とセッションの
 * 所有者照合で行うため、署名Cookie は使わない（rid 方式に統一）。
 */

/** 仮押さえ（pending_payment 予約・TTLロック）の有効分数 */
export const PENDING_TTL_MIN = 15;
