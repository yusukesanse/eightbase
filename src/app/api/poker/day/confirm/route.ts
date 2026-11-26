import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { confirmPokerGame } from "@/lib/pokerDay";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/day/confirm  Body: { eventDate, finishDay? }
 * ディーラーが全員のチップを確認して「確定」。試合の順位を確定し当日 scores を更新、次の試合へ。
 * finishDay=true なら同時に本日のリーグ戦を終了する（以後の操作はすべて 409）。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("poker");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (!isValidPokerDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  const finishDay: unknown = body?.finishDay ?? false;
  if (typeof finishDay !== "boolean") return NextResponse.json({ error: "finishDay が不正です" }, { status: 400 });

  try {
    const result = await confirmPokerGame(season.seasonId, eventDate, userId, { finishDay });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[poker/day/confirm] POST error:", error);
    return NextResponse.json({ error: "確定に失敗しました" }, { status: 500 });
  }
}
