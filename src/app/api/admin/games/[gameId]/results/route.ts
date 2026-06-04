import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { GamePointsConfig } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/games/[gameId]/results
 * 結果登録＋ポイント付与
 * Body: { results: [{ lineUserId: string, rank: number }] }
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
    const body = await req.json();
    const { results } = body as { results: { lineUserId: string; rank: number }[] };

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "results は必須です" }, { status: 400 });
    }

    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
    }

    const gameData = gameDoc.data()!;
    const pointsConfig = (gameData.pointsConfig || { participation: 0, ranks: {} }) as GamePointsConfig;

    const batch = db.batch();

    for (const { lineUserId, rank } of results) {
      // 順位ポイント計算
      const rankPoints = pointsConfig.ranks[rank] ?? 0;
      const participationPoints = pointsConfig.participation ?? 0;
      const totalPoints = rankPoints + participationPoints;

      // 参加者ドキュメント更新
      const partRef = gameRef.collection("participants").doc(lineUserId);
      batch.update(partRef, {
        rank,
        pointsAwarded: totalPoints,
      });

      // ユーザーポイント加算
      if (totalPoints > 0) {
        const userRef = db.collection("users").doc(lineUserId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          const currentPoints = (userDoc.data()?.points as number) || 0;
          batch.update(userRef, { points: currentPoints + totalPoints });
        }
      }
    }

    // ゲームステータスを完了に
    batch.update(gameRef, {
      status: "completed",
      updatedAt: new Date().toISOString(),
    });

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/games/results] POST error:", error);
    return NextResponse.json({ error: "結果登録に失敗しました" }, { status: 500 });
  }
}
