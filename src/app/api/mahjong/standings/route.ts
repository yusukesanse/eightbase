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
    const querySeasonId = req.nextUrl.searchParams.get("seasonId");
    // 認証とアクティブシーズン取得は独立＝並列化（往復を重ねない）。
    const [userId, activeSeason] = await Promise.all([
      requireGameUser(req),
      querySeasonId ? Promise.resolve(null) : getActiveSeason(),
    ]);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const seasonId = querySeasonId ?? activeSeason?.seasonId ?? null;
    if (!seasonId) {
      return NextResponse.json({ standings: [], seasonId: null, currentUserId: userId });
    }

    // 順位集計と順位方式(seasonDoc)の取得も独立＝並列化。
    const [standings, seasonDoc] = await Promise.all([
      computeStandings(seasonId),
      getDb().collection("seasons").doc(seasonId).get(),
    ]);
    const rankingMetric = normalizeRankingMetric(seasonDoc.data()?.rankingMetric);
    return NextResponse.json({ standings, seasonId, currentUserId: userId, rankingMetric });
  } catch (error) {
    console.error("[mahjong/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
