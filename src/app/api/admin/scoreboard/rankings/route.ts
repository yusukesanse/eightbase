import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/admin/scoreboard/rankings
 * ランキング取得
 * Params:
 *   gameCategory: ScoreboardGameId (required)
 *   seasonId: string (required)
 *   period: "monthly" | "annual" (default: "monthly")
 *   yearMonth: YYYY-MM (for monthly, default: current month)
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gameCategory = req.nextUrl.searchParams.get("gameCategory") as ScoreboardGameId | null;
    const seasonId = req.nextUrl.searchParams.get("seasonId");
    const period = req.nextUrl.searchParams.get("period") ?? "monthly";
    const yearMonth = req.nextUrl.searchParams.get("yearMonth") ??
      new Date().toISOString().slice(0, 7);

    if (!gameCategory || !VALID_GAME_IDS.includes(gameCategory)) {
      return NextResponse.json({ error: "有効な gameCategory を指定してください" }, { status: 400 });
    }
    if (!seasonId) {
      return NextResponse.json({ error: "seasonId は必須です" }, { status: 400 });
    }

    const ranking = await buildRanking(gameCategory, seasonId, period, yearMonth);

    return NextResponse.json({ ranking, period, gameCategory, seasonId, yearMonth });
  } catch (error) {
    console.error("[admin/scoreboard/rankings] GET error:", error);
    return NextResponse.json({ error: "ランキングの取得に失敗しました" }, { status: 500 });
  }
}

/**
 * ランキング集計ロジック
 */
async function buildRanking(
  gameCategory: ScoreboardGameId,
  seasonId: string,
  period: string,
  yearMonth: string
) {
  const db = getDb();

  // 複合インデックス不要: seasonId のみでクエリし、JS側でフィルタ
  const snap = await db.collection("scores")
    .where("seasonId", "==", seasonId)
    .get();

  const filteredDocs = snap.docs.filter((doc) => {
    const d = doc.data();
    if (d.gameCategory !== gameCategory) return false;
    if (period === "monthly" && d.yearMonth !== yearMonth) return false;
    return true;
  });

  // ユーザーごとに集計
  const userMap: Record<string, {
    lineUserId: string;
    totalScore: number;
    playedCount: number;
  }> = {};

  for (const doc of filteredDocs) {
    const d = doc.data();
    const userId = d.lineUserId as string;
    if (!userMap[userId]) {
      userMap[userId] = { lineUserId: userId, totalScore: 0, playedCount: 0 };
    }
    userMap[userId].totalScore += (d.totalScore as number) || 0;
    userMap[userId].playedCount += 1;
  }

  // ソート（降順）
  const sorted = Object.values(userMap).sort((a, b) => b.totalScore - a.totalScore);

  // ユーザー情報を取得
  const userIds = sorted.map((u) => u.lineUserId);
  const userInfoMap: Record<string, { displayName: string; pictureUrl?: string }> = {};

  // Firestoreの in クエリは最大30件
  for (let i = 0; i < userIds.length; i += 30) {
    const batch = userIds.slice(i, i + 30);
    if (batch.length === 0) continue;
    const usersSnap = await db.collection("users")
      .where("lineUserId", "in", batch)
      .get();
    usersSnap.docs.forEach((d) => {
      const data = d.data();
      userInfoMap[data.lineUserId] = {
        displayName: data.displayName || "ユーザー",
        pictureUrl: data.pictureUrl,
      };
    });
  }

  // ランキングエントリ構築
  return sorted.map((u, idx) => ({
    rank: idx + 1,
    lineUserId: u.lineUserId,
    displayName: userInfoMap[u.lineUserId]?.displayName ?? "ユーザー",
    pictureUrl: userInfoMap[u.lineUserId]?.pictureUrl ?? undefined,
    totalScore: u.totalScore,
    playedCount: u.playedCount,
  }));
}
