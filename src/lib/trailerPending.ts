/**
 * トレーラー等の決済フロー: 「決済前の pending予約」を指す署名Cookie。
 *
 * 「決済する」時に pending_payment 予約を作り、その reservationId を**署名して**Cookieに入れる。
 * 決済後リダイレクトで戻った完了エンドポイントが、このCookieから対象予約を特定する。
 * 署名は SESSION_SECRET（既存セッションと同じ鍵）で行い改ざん不可。TTLは仮押さえと同じ15分。
 *
 * sameSite=lax: Square(別サイト)からのトップレベル遷移で戻った時にもCookieが送られる。
 */

import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret } from "./secrets";

export const PENDING_RESERVATION_COOKIE = "__trailer_pending";
/** 仮押さえ/Cookie の有効分数 */
export const PENDING_TTL_MIN = 15;

export async function signPendingCookie(
  reservationId: string,
  lineUserId: string
): Promise<string> {
  return new SignJWT({ reservationId, lineUserId, kind: "trailer_pending" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_MIN}m`)
    .sign(getSessionSecret());
}

export async function verifyPendingCookie(
  token: string
): Promise<{ reservationId: string; lineUserId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.kind !== "trailer_pending") return null;
    const reservationId = payload.reservationId;
    const lineUserId = payload.lineUserId;
    if (typeof reservationId !== "string" || typeof lineUserId !== "string") return null;
    return { reservationId, lineUserId };
  } catch {
    return null;
  }
}
