import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/games/[gameId]/results
 * ゲームを完了ステータスに更新
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gameId } = await params;

    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
    }

    await gameRef.update({
      status: "completed",
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/games/results] POST error:", error);
    return NextResponse.json({ error: "ステータス更新に失敗しました" }, { status: 500 });
  }
}
