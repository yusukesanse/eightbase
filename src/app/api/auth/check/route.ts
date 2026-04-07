import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/check
 * セッション Cookie (JWT) を検証し、認証状態を返す。
 *
 * LINE ログインベースの認証に変更:
 * - JWT の検証のみ行い、Firebase の authorizedUsers チェックは行わない
 * - LIFF ログイン時に /api/auth/liff-login で発行された JWT を検証
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await getSessionUserId(req);

    if (!lineUserId) {
      return NextResponse.json({ authorized: false });
    }

    return NextResponse.json({
      authorized: true,
      lineUserId,
    });
  } catch (error) {
    console.error("[auth/check] error:", error);
    return NextResponse.json({ authorized: false }, { status: 500 });
  }
}

/**
 * POST /api/auth/check
 * ログアウト: セッション Cookie を削除する。
 */
export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({ action: "" }));
  if (action !== "logout") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("__session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
