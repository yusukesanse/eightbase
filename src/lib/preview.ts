/**
 * プレビューモード判定
 *
 * Cookie「__preview」に JWT が格納されていれば、認証をバイパスする。
 * JWT は SESSION_SECRET で署名されているため偽造不可。
 *
 * 環境変数:
 *   PREVIEW_SECRET — プレビュー有効化に必要なトークン（未設定ならプレビュー機能無効）
 */

import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";
import { getSessionSecret } from "./secrets";

const PREVIEW_COOKIE = "__preview";

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

/** サーバーサイド: リクエストがプレビューモードか判定 */
export async function isPreviewMode(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(PREVIEW_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return payload.preview === true;
  } catch {
    return false;
  }
}

/** プレビュー中の書き込み操作かどうかを判定 */
export async function isPreviewWriteRequest(req: NextRequest): Promise<boolean> {
  if (!isWriteMethod(req.method)) return false;
  return isPreviewMode(req);
}

/** プレビュー用 JWT を生成（activate API で使用） */
export async function signPreviewToken(): Promise<string> {
  return new SignJWT({ preview: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSessionSecret());
}

/** Cookie 名（外部参照用） */
export const PREVIEW_COOKIE_NAME = PREVIEW_COOKIE;

/** プレビューモードのモックユーザー情報 */
export const PREVIEW_ADMIN_EMAIL = "preview@demo.eightbase";
export const PREVIEW_USER_ID = "preview-user";
