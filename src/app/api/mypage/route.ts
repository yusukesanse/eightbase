import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/mypage
 * マイページに表示するユーザー情報をまとめて返す。
 *
 * レスポンス:
 *   displayName    - プロフィール名（姓名）
 *   lineDisplayName - LINE 表示名
 *   pictureUrl     - LINE プロフィール画像
 *   catchphrase    - キャッチコピー
 *   skills         - スキルタグ配列
 *   postCount      - 掲示板投稿数
 *   reservationCount - 予約数
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await getSessionUserId(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const db = getDb();

    // ── ユーザー基本情報（users コレクション） ──
    const userDoc = await db.collection("users").doc(lineUserId).get();
    const userData = userDoc.exists ? userDoc.data()! : {};

    // ── authorizedUsers からプロフィール情報 ──
    const authSnap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    const authData = authSnap.empty ? null : authSnap.docs[0].data();
    const memberProfile = userData.memberProfile || {};

    // ── 投稿数 (posts コレクション) ──
    let postCount = 0;
    try {
      const postSnap = await db
        .collection("posts")
        .where("authorId", "==", lineUserId)
        .count()
        .get();
      postCount = postSnap.data().count;
    } catch {
      // posts コレクションが未作成の場合は 0
    }

    // ── 予約数 (reservations コレクション、confirmed のみ) ──
    let reservationCount = 0;
    try {
      const resSnap = await db
        .collection("reservations")
        .where("lineUserId", "==", lineUserId)
        .where("status", "==", "confirmed")
        .count()
        .get();
      reservationCount = resSnap.data().count;
    } catch {
      // reservations コレクションが未作成の場合は 0
    }

    return NextResponse.json({
      displayName: authData?.displayName || userData.displayName || "",
      lineDisplayName: userData.lineDisplayName || "",
      pictureUrl: userData.pictureUrl || "",
      catchphrase: memberProfile.catchphrase || "",
      skills: memberProfile.skills || [],
      companyUrl: memberProfile.companyUrl || "",
      postCount,
      reservationCount,
    });
  } catch (error) {
    console.error("[api/mypage] error:", error);
    return NextResponse.json(
      { error: "データの取得に失敗しました" },
      { status: 500 }
    );
  }
}
