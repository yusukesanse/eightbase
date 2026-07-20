import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { finishDartsDay } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/finish  Body: { eventDate }
 * GM 専用: 本日の対局を終了。3種目すべて確定済みが前提。
 * 順位ポイントを合算し、参加者ごとに scores を書く（既存ランキングに乗る）。冪等（already）。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  try {
    const result = await finishDartsDay(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      success: true,
      already: result.already,
      participantCount: result.participantCount,
    });
  } catch (error) {
    console.error("[darts/day/finish] POST error:", error);
    return NextResponse.json({ error: "終了処理に失敗しました" }, { status: 500 });
  }
}
