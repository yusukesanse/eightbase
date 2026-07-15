import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { computeDayStandings, getActiveSeason, resolveSeasonMetric } from "@/lib/mahjong";
import { isValidMahjongDate } from "@/lib/mahjongEntryValidation";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/standings/day?eventDate=YYYY-MM-DD&seasonId=（任意・未指定はアクティブ）
 *
 * 特定開催日だけの順位（当該日の completed 卓のみ集計）。通算順位（/standings）とは別物。
 * - 認可: requireGameUser（ゲスト含む）。
 * - completed 卓が0件 → hasResults=false・空リスト（エラーにしない）。
 * - 公開DTO: 内部 lineUserId・tier は返さず、自分の行だけ isMe を付ける（Public 方針）。
 */
export async function GET(req: NextRequest) {
  try {
    const querySeasonId = req.nextUrl.searchParams.get("seasonId");
    const eventDate = req.nextUrl.searchParams.get("eventDate");

    const [userId, activeSeason] = await Promise.all([
      requireGameUser(req),
      querySeasonId ? Promise.resolve(null) : getActiveSeason(),
    ]);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    if (!isValidMahjongDate(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }

    const seasonId = querySeasonId ?? activeSeason?.seasonId ?? null;
    if (!seasonId) {
      return NextResponse.json({
        eventDate,
        seasonId: null,
        rankingMetric: "average" as const,
        hasResults: false,
        standings: [],
      });
    }

    // metric 解決と当日集計（override で二重読みを避ける）。
    const rankingMetric = await resolveSeasonMetric(seasonId);
    const standings = await computeDayStandings(seasonId, eventDate, rankingMetric);

    // 公開DTO: lineUserId / tier / 決済情報は出さない。自分の行のみ isMe。
    const publicStandings = standings.map((s) => ({
      rank: s.rank,
      displayName: s.displayName,
      pictureUrl: s.pictureUrl,
      gamesPlayed: s.gamesPlayed,
      totalPoints: s.totalPoints,
      average: s.average,
      firstCount: s.firstCount,
      top2Rate: s.top2Rate,
      isMe: s.lineUserId === userId,
    }));

    return NextResponse.json({
      eventDate,
      seasonId,
      rankingMetric,
      hasResults: publicStandings.length > 0,
      standings: publicStandings,
    });
  } catch (error) {
    console.error("[mahjong/standings/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
