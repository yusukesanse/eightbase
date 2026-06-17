/**
 * JWT-based session management
 * セッショントークンの生成・検証・Cookie 管理
 *
 * 環境変数: SESSION_SECRET (必須 / 最低32文字のランダム文字列)
 */

import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { isPreviewMode, PREVIEW_USER_ID } from "./preview";
import { getSessionSecret } from "./secrets";

const COOKIE_NAME = "__session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30日

// ─── トークン生成 ─────────────────────────────────────────────────────────────

export async function signSession(lineUserId: string): Promise<string> {
  return await new SignJWT({ lineUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSessionSecret());
}

// ─── トークン検証 ─────────────────────────────────────────────────────────────

export async function verifySession(
  token: string
): Promise<{ lineUserId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    const lineUserId = payload.lineUserId;
    if (typeof lineUserId !== "string") return null;
    return { lineUserId };
  } catch {
    return null;
  }
}

// ─── Cookie ヘルパー ──────────────────────────────────────────────────────────

export function getSessionCookie(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_NAME)?.value ?? null;
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

// ─── リクエストからユーザーIDを取得 ──────────────────────────────────────────

export async function getSessionUserId(
  req: NextRequest
): Promise<string | null> {
  // プレビューモードは読み取り専用。書き込み系 API では認証扱いにしない。
  if (await isPreviewMode(req)) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return PREVIEW_USER_ID;
    return null;
  }

  const token = getSessionCookie(req);
  if (!token) return null;
  const session = await verifySession(token);
  return session?.lineUserId ?? null;
}
