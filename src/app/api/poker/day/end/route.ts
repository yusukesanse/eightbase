import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { endPokerGame } from "@/lib/pokerDay";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/day/end  Body: { eventDate }
 * ディーラーが「ゲーム終了」。各プレイヤーのチップ申告受付へ移行する。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("poker");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (!isValidPokerDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });

  try {
    const result = await endPokerGame(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[poker/day/end] POST error:", error);
    return NextResponse.json({ error: "終了に失敗しました" }, { status: 500 });
  }
}
