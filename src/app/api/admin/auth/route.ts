import { NextRequest, NextResponse } from "next/server";
import {
  signAdminToken,
  setAdminCookie,
  clearAdminCookie,
} from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? "";

/**
 * POST /api/admin/auth
 * 管理者ログイン: トークンを検証し、httpOnly Cookie に JWT を設定
 * Body: { token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token || !ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return NextResponse.json({ error: "トークンが正しくありません" }, { status: 401 });
    }

    const jwt = await signAdminToken();
    const res = NextResponse.json({ success: true });
    setAdminCookie(res, jwt);
    return res;
  } catch {
    return NextResponse.json({ error: "ログインに失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/auth
 * 管理者ログアウト: httpOnly Cookie をクリア
 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  clearAdminCookie(res);
  return res;
}

/**
 * GET /api/admin/auth
 * セッション確認: Cookie の JWT が有効かチェック
 */
export async function GET(req: NextRequest) {
  const { verifyAdminToken: verify } = await import("@/lib/adminAuth");
  const cookie = req.cookies.get("__admin_session")?.value;

  if (!cookie) {
    // Bearer トークンフォールバック
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${ADMIN_TOKEN}`) {
      return NextResponse.json({ authenticated: true });
    }
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const valid = await verify(cookie);
  if (!valid) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true });
}
