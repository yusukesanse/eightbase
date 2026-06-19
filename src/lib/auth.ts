/**
 * 利用者認証ヘルパー（portal API 認可の統一窓口）
 *
 * requireActiveUser(req):
 *   セッションから lineUserId を取得し、authorizedUsers で active=true を確認。
 *   無効/未登録ユーザーは null を返す。一覧・詳細などの「閲覧系」API で使う。
 *
 * requireProfileComplete(req):
 *   上記に加え authorizedUsers.profileComplete=true を要求する。
 *   投稿・予約・麻雀（参加表明/申告）など「プロフィール登録後にのみ許可する操作系」API で使う。
 *
 * いずれもプレビューモードでは GET/HEAD/OPTIONS のみ仮ユーザーを返す（読み取り専用）。
 */

import type { NextRequest } from "next/server";
import { getSessionUserId } from "./session";
import { isPreviewMode, PREVIEW_USER_ID } from "./preview";
import { getDb } from "./firebaseAdmin";

/**
 * authorizedUsers から active=true のレコードを1件引く共通処理。
 * 見つからなければ null（= 未登録 or active=false）。
 */
async function getActiveAuthorizedUser(
  lineUserId: string
): Promise<FirebaseFirestore.DocumentData | null> {
  const db = getDb();
  const snap = await db
    .collection("authorizedUsers")
    .where("lineUserId", "==", lineUserId)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

export async function requireActiveUser(
  req: NextRequest
): Promise<string | null> {
  // プレビューモード: 読み取り専用で仮ユーザー
  if (await isPreviewMode(req)) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return PREVIEW_USER_ID;
    return null;
  }

  const lineUserId = await getSessionUserId(req);
  if (!lineUserId) return null;

  const user = await getActiveAuthorizedUser(lineUserId);
  if (!user) return null;

  return lineUserId;
}

export async function requireProfileComplete(
  req: NextRequest
): Promise<string | null> {
  // プレビューモード: 読み取り専用で仮ユーザー（操作系は基本 GET 以外なので拒否される）
  if (await isPreviewMode(req)) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return PREVIEW_USER_ID;
    return null;
  }

  const lineUserId = await getSessionUserId(req);
  if (!lineUserId) return null;

  const user = await getActiveAuthorizedUser(lineUserId);
  if (!user) return null;
  if (!user.profileComplete) return null;

  return lineUserId;
}
