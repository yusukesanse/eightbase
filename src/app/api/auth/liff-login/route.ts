import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/liff-login
 *
 * LIFF アクセストークンを LINE API で検証し、
 * ユーザーの LINE プロフィールを取得してセッション Cookie を発行する。
 *
 * Firebase の authorizedUsers チェックを行わず、
 * LINE ログインのみでアクセスを許可する。
 * （将来的にアクセス制御が必要な場合は、ここに追加）
 */
export async function POST(req: NextRequest) {
  try {
    const { accessToken } = await req.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "アクセストークンがありません" },
        { status: 400 }
      );
    }

    // ── 1. LINE API でアクセストークンを検証 ──
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );

    if (!verifyRes.ok) {
      console.error("[liff-login] token verify failed:", await verifyRes.text());
      return NextResponse.json(
        { error: "無効なアクセストークンです" },
        { status: 401 }
      );
    }

    const verifyData = await verifyRes.json();
    if (verifyData.expires_in <= 0) {
      return NextResponse.json(
        { error: "アクセストークンが期限切れです" },
        { status: 401 }
      );
    }

    // ── 2. LINE API でユーザープロフィールを取得 ──
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      console.error("[liff-login] profile fetch failed:", await profileRes.text());
      return NextResponse.json(
        { error: "プロフィール取得に失敗しました" },
        { status: 401 }
      );
    }

    const profile = await profileRes.json();
    const lineUserId: string = profile.userId;
    const displayName: string = profile.displayName;

    console.log(`[liff-login] Authenticated: ${displayName} (${lineUserId})`);

    // ── 3. JWT セッション Cookie を発行 ──
    const token = await signSession(lineUserId);

    const res = NextResponse.json({
      success: true,
      displayName,
      lineUserId,
    });

    setSessionCookie(res, token);
    return res;
  } catch (error) {
    console.error("[liff-login] error:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
