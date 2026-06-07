import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/ranking?category=all
 * ゲームのポイントランキングを返す
 * - category=all: 全種目合算
 * - category=mahjong: 麻雀のみ  等
 */
export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get("category") ?? "all";
    const db = getDb();

    // 完了済みゲームを取得
    let gamesQuery = db.collection("games")
      .where("status", "==", "completed");

    const gamesSnap = await gamesQuery.get();

    // カテゴリフィルタ（Firestoreの複合インデックスを避けてコード側で）
    const gameDocs = category === "all"
      ? gamesSnap.docs
      : gamesSnap.docs.filter((d) => d.data().category === category);

    // 全参加者のポイントを集計
    const userPoints: Record<string, {
      lineUserId: string;
      displayName: string;
      pictureUrl: string;
      totalPoints: number;
      gameCount: number;
      winCount: number;
    }> = {};

    for (const gameDoc of gameDocs) {
      const partSnap = await gameDoc.ref.collection("participants").get();
      for (const partDoc of partSnap.docs) {
        const p = partDoc.data();
        const userId = partDoc.id;
        const points = (p.pointsAwarded as number) ?? 0;

        if (!userPoints[userId]) {
          userPoints[userId] = {
            lineUserId: userId,
            displayName: (p.displayName as string) || "ユーザー",
            pictureUrl: (p.pictureUrl as string) || "",
            totalPoints: 0,
            gameCount: 0,
            winCount: 0,
          };
        }

        userPoints[userId].totalPoints += points;
        userPoints[userId].gameCount += 1;
        if (p.rank === 1) userPoints[userId].winCount += 1;
        // 最新の表示名・画像で上書き
        if (p.displayName) userPoints[userId].displayName = p.displayName as string;
        if (p.pictureUrl) userPoints[userId].pictureUrl = p.pictureUrl as string;
      }
    }

    // ポイント降順でソート
    const ranking = Object.values(userPoints)
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 50);

    return NextResponse.json({ ranking });
  } catch (error) {
    console.error("[games/ranking] GET error:", error);
    return NextResponse.json({ error: "ランキング取得に失敗しました" }, { status: 500 });
  }
}
