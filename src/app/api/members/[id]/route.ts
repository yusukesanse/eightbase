import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/members/:id
 * メンバー詳細を返す。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lineUserId = await requireActiveUser(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { id: memberId } = await params;
    const db = getDb();

    const userDoc = await db.collection("users").doc(memberId).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "メンバーが見つかりません" },
        { status: 404 }
      );
    }

    const data = userDoc.data()!;
    const mp = data.memberProfile || {};

    // スキル未設定ユーザーはメンバーとして表示しない
    const skills: string[] = mp.skills || [];
    if (skills.length === 0) {
      return NextResponse.json(
        { error: "メンバーが見つかりません" },
        { status: 404 }
      );
    }

    // 投稿数
    let postCount = 0;
    try {
      const postSnap = await db
        .collection("posts")
        .where("authorId", "==", memberId)
        .count()
        .get();
      postCount = postSnap.data().count;
    } catch {
      // posts コレクション未作成時
    }

    return NextResponse.json(
      {
        lineUserId: memberId,
        displayName: data.displayName || data.lineDisplayName || "",
        pictureUrl: data.pictureUrl || "",
        catchphrase: mp.catchphrase || "",
        skills,
        postCount,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[api/members/[id]] error:", error);
    return NextResponse.json(
      { error: "データの取得に失敗しました" },
      { status: 500 }
    );
  }
}
