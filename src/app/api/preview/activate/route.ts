import { NextRequest, NextResponse } from "next/server";
import { isPreviewMode, signPreviewToken, PREVIEW_COOKIE_NAME } from "@/lib/preview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({ active: await isPreviewMode(req) });
}

/**
 * POST /api/preview/activate
 * プレビューモードを有効化（__preview Cookie をセット）
 *
 * Body: { token: string }
 * token が PREVIEW_SECRET と一致すればプレビュー Cookie を発行
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PREVIEW_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "プレビューモードは無効です" },
      { status: 403 }
    );
  }

  const { token } = await req.json().catch(() => ({ token: "" }));
  if (!token || token !== secret) {
    return NextResponse.json(
      { error: "トークンが正しくありません" },
      { status: 401 }
    );
  }

  const jwt = await signPreviewToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(PREVIEW_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7日
    path: "/",
  });
  return res;
}

/**
 * DELETE /api/preview/activate
 * プレビューモードを無効化（Cookie クリア）
 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(PREVIEW_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
