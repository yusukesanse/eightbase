import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/check
 * セッション Cookie (JWT) を検証し、認証状態とプロフィール完了状態を返す。
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await getSessionUserId(req);

    if (!lineUserId) {
      return NextResponse.json({ authorized: false });
    }

    // authorizedUsers で有効ユーザーか確認
    const db = getDb();
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (snap.empty) {
      // authorizedUsers に存在しない → 審査モードを確認
      let isReviewMode = false;
      try {
        const settingsDoc = await db.collection("settings").doc("app").get();
        isReviewMode = settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
      } catch (e) {
        console.warn("[auth/check] settings fetch error:", e);
      }

      if (!isReviewMode) {
        return NextResponse.json({ authorized: false });
      }

      // 審査モード: 未登録ユーザーでも認証OK
      console.log(`[auth/check] review mode: allowing ${lineUserId}`);
      return NextResponse.json({
        authorized: true,
        lineUserId,
        profileComplete: true,
      });
    }

    const userData = snap.docs[0].data();

    return NextResponse.json({
      authorized: true,
      lineUserId,
      profileComplete: !!userData.profileComplete,
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
