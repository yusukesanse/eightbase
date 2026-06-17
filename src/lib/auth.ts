/**
 * 利用者認証ヘルパー
 *
 * requireActiveUser(req):
 *   セッションから lineUserId を取得し、authorizedUsers で active=true を確認。
 *   無効/未登録ユーザーは null を返す。
 */

import type { NextRequest } from "next/server";
import { getSessionUserId } from "./session";
import { isPreviewMode, PREVIEW_USER_ID } from "./preview";
import { getDb } from "./firebaseAdmin";

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

  const db = getDb();
  const snap = await db
    .collection("authorizedUsers")
    .where("lineUserId", "==", lineUserId)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return lineUserId;
}
