import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { isPreviewMode, PREVIEW_USER_ID } from "@/lib/preview";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/check
 * セッション Cookie (JWT) を検証し、認証状態とプロフィール完了状態を返す。
 */
export async function GET(req: NextRequest) {
  try {
    // プレビューモード: 即座に認証OKを返す
    if (await isPreviewMode(req)) {
      return NextResponse.json({
        authorized: true,
        lineUserId: PREVIEW_USER_ID,
        profileComplete: true,
      });
    }

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
      // authorizedUsers に存在しない → 審査モードを確認（本番では明示許可なしで無効）
      let isReviewMode = false;
      if (process.env.NODE_ENV !== "production" || process.env.ALLOW_REVIEW_MODE === "true") {
      try {
        const settingsDoc = await db.collection("settings").doc("app").get();
        isReviewMode = settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
      } catch (e) {
        console.warn("[auth/check] settings fetch error:", e);
      }
      } // end ALLOW_REVIEW_MODE guard

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

// ログアウトは POST /api/auth/logout に一本化（以前ここにあった重複の logout POST は削除）。
