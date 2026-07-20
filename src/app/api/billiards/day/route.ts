import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { getBilliardsDayState, fetchBilliardsParticipants, computeBilliardsDayScores } from "@/lib/billiardsDay";
import { isValidBilliardsDate } from "@/lib/billiardsEntryValidation";

export const dynamic = "force-dynamic";

/**
 * GET /api/billiards/day?eventDate=YYYY-MM-DD — 当日スナップショット。
 * GM には内部 lineUserId 込みの全情報（記録・取消に必要）、参加者には公開DTO。
 * ライブの当日順位（試合ログからの集計）も返す。未開始なら started:false。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const season = await getActiveSeason("billiards");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const eventDate = req.nextUrl.searchParams.get("eventDate");
  if (!isValidBilliardsDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });

  const isGm = isGameMaster(season, userId);

  try {
    const day = await getBilliardsDayState(season.seasonId, eventDate);

    if (!day) {
      const roster = isGm ? await fetchBilliardsParticipants(season.seasonId, eventDate) : [];
      return NextResponse.json(
        {
          started: false,
          finished: false,
          isGameMaster: isGm,
          participants: isGm
            ? roster.map((p) => ({ lineUserId: p.lineUserId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "", isMe: p.lineUserId === userId }))
            : [],
          paidCount: roster.length,
          matches: [],
          standings: [],
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const nameOf = new Map(day.participants.map((p) => [p.lineUserId, p]));
    const participants = day.participants.map((p) => ({
      ...(isGm ? { lineUserId: p.lineUserId } : {}),
      displayName: p.displayName,
      pictureUrl: p.pictureUrl ?? "",
      isMe: p.lineUserId === userId,
    }));

    const matches = (day.matches ?? []).map((m) => ({
      matchId: m.matchId,
      ...(isGm ? { winnerId: m.winnerId, loserId: m.loserId } : {}),
      winnerName: nameOf.get(m.winnerId)?.displayName ?? "?",
      loserName: nameOf.get(m.loserId)?.displayName ?? "?",
      loserBalls: m.loserBalls,
      winnerIsMe: m.winnerId === userId,
      loserIsMe: m.loserId === userId,
    }));

    // ライブ当日順位（試合ログからの集計）。
    const standings = computeBilliardsDayScores(day)
      .map((s) => ({
        displayName: s.displayName,
        points: s.totalScore,
        wins: s.details.wins,
        losses: s.details.losses,
        dayRank: s.details.dayRank,
        isMe: s.lineUserId === userId,
      }))
      .sort((a, b) => a.dayRank - b.dayRank);

    return NextResponse.json(
      {
        started: !!day.entryClosedAt,
        finished: !!day.finishedAt,
        isGameMaster: isGm,
        participants,
        paidCount: day.participants.length,
        matches,
        standings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[billiards/day] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
