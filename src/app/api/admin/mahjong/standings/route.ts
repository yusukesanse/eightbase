import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { computeStandings, getActiveSeason } from "@/lib/mahjong";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/standings?seasonId=xxx
 * 通算アベレージ順位表（管理者）。seasonId 未指定ならアクティブシーズン
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) {
        return NextResponse.json({ standings: [], seasonId: null });
      }
      seasonId = season.seasonId;
    }

    const standings = await computeStandings(seasonId);
    return NextResponse.json({ standings, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/standings] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
