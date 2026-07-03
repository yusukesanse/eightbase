import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/games/ranking
 * ランキングAPI（ログイン必須）
 * Params:
 *   gameCategory: ScoreboardGameId (default: "mahjong")
 *   period: "monthly" | "annual" (default: "monthly")
 *   yearMonth: YYYY-MM (default: current month)
 */
export async function GET(req: NextRequest) {
  try {
    // 公開しない（active ユーザーのみ）
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const gameCategory = (req.nextUrl.searchParams.get("gameCategory") ?? "mahjong") as ScoreboardGameId;
    const period = req.nextUrl.searchParams.get("period") ?? "monthly";
    const yearMonth = req.nextUrl.searchParams.get("yearMonth") ??
      new Date().toISOString().slice(0, 7);

    if (!VALID_GAME_IDS.includes(gameCategory)) {
      return NextResponse.json({ error: "Invalid gameCategory" }, { status: 400 });
    }

    const db = getDb();

    // 種目(gameCategory)に対応するアクティブシーズンを取得
    const season = await getActiveSeason(gameCategory);
    if (!season) {
      return NextResponse.json({ ranking: [], period, gameCategory });
    }

    const seasonId = season.seasonId;

    // スコア集計（複合インデックス不要: seasonId のみでクエリし、JS側でフィルタ）
    const snap = await db.collection("scores")
      .where("seasonId", "==", seasonId)
      .get();

    // JS側で gameCategory と yearMonth をフィルタ
    const filteredDocs = snap.docs.filter((doc) => {
      const d = doc.data();
      if (d.gameCategory !== gameCategory) return false;
      if (period === "monthly" && d.yearMonth !== yearMonth) return false;
      return true;
    });

    // ユーザーごと集計
    const userMap: Record<string, { totalScore: number; playedCount: number }> = {};
    for (const doc of filteredDocs) {
      const d = doc.data();
      const uid = d.lineUserId as string;
      if (!userMap[uid]) {
        userMap[uid] = { totalScore: 0, playedCount: 0 };
      }
      userMap[uid].totalScore += (d.totalScore as number) || 0;
      userMap[uid].playedCount += 1;
    }

    const sorted = Object.entries(userMap)
      .sort(([, a], [, b]) => b.totalScore - a.totalScore)
      .slice(0, 50);

    // ユーザー情報
    const userIds = sorted.map(([id]) => id);
    const userInfoMap: Record<string, { displayName: string; pictureUrl?: string }> = {};

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

    // lineUserId など不要な識別子は返さない（rank をキーに使う）
    const ranking = sorted.map(([uid, stats], idx) => ({
      rank: idx + 1,
      displayName: userInfoMap[uid]?.displayName ?? "ユーザー",
      pictureUrl: userInfoMap[uid]?.pictureUrl ?? undefined,
      totalScore: stats.totalScore,
      playedCount: stats.playedCount,
    }));

    return NextResponse.json(
      { ranking, period, gameCategory, yearMonth },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[games/ranking] GET error:", error);
    return NextResponse.json({ error: "ランキング取得に失敗しました" }, { status: 500 });
  }
}
