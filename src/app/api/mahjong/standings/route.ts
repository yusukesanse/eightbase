import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { computeStandings, getActiveSeason, normalizeRankingMetric } from "@/lib/mahjong";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/standings
 * シーズン通算アベレージの順位表（M1/M2/M3 リーグ振り分け付き）
 * クエリ:
 *   seasonId - 指定がなければアクティブシーズン
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) {
        return NextResponse.json({ standings: [], seasonId: null, currentUserId: userId });
      }
      seasonId = season.seasonId;
    }

    const standings = await computeStandings(seasonId);
    // 現在の順位方式（UIのラベル用）
    const seasonDoc = await getDb().collection("seasons").doc(seasonId).get();
    const rankingMetric = normalizeRankingMetric(seasonDoc.data()?.rankingMetric);
    return NextResponse.json({ standings, seasonId, currentUserId: userId, rankingMetric });
  } catch (error) {
    console.error("[mahjong/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
