import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/games/[gameId]/participants
 * ゲーム参加者一覧を取得
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gameId } = await params;
    const db = getDb();
    const snap = await db
      .collection("games")
      .doc(gameId)
      .collection("participants")
      .orderBy("joinedAt", "asc")
      .get();

    const participants = snap.docs.map((doc) => ({
      lineUserId: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ participants });
  } catch (error) {
    console.error("[admin/games/participants] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
