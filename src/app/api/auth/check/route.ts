import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { isPreviewMode, PREVIEW_USER_ID } from "@/lib/preview";
import { isReviewModeEnabled } from "@/lib/reviewMode";
import { isAuthBypassEnabled, DEMO_BYPASS_USER_ID } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/check
 * セッション Cookie (JWT) を検証し、認証状態とプロフィール完了状態を返す。
 */
export async function GET(req: NextRequest) {
  try {
    // demo/開発: 認証バイパス（本番では常に無効）。固定テストユーザーで認証OKを返す。
    if (isAuthBypassEnabled()) {
      return NextResponse.json({
        authorized: true,
        lineUserId: DEMO_BYPASS_USER_ID,
        profileComplete: true,
      });
    }

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
      const isReviewMode = await isReviewModeEnabled(db);

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
