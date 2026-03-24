import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/check
 * セッションCookieを検証し、ユーザーが authorizedUsers に存在するか確認する。
 * （旧: x-line-user-id ヘッダーを廃止 → JWT Cookie ベースに変更）
 */
export async function GET(req: NextRequest) {
  // セッション Cookie からユーザーIDを取得
  const lineUserId = await getSessionUserId(req);
  if (!lineUserId) {
    return NextResponse.json({ authorized: false });
  }

  try {
    const db = getDb();

    // email: プレフィックスはLIFF外ログイン（管理者テスト用など）
    if (lineUserId.startsWith("email:")) {
      const email = lineUserId.slice(6);
      const snap = await db
        .collection("authorizedUsers")
        .where("email", "==", email)
        .where("active", "==", true)
        .limit(1)
        .get();

      if (!snap.empty) {
        const data = snap.docs[0].data();
        return NextResponse.json({
          authorized: true,
          displayName: data.displayName,
          email: data.email,
        });
      }
      return NextResponse.json({ authorized: false });
    }

    // 通常の LINE ユーザーID による確認
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (!snap.empty) {
      const data = snap.docs[0].data();
      return NextResponse.json({
        authorized: true,
        displayName: data.displayName,
        email: data.email,
      });
    }

    return NextResponse.json({ authorized: false });
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
