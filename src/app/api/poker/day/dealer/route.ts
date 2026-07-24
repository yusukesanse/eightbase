import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { assignPokerDealer } from "@/lib/pokerDay";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/day/dealer  Body: { eventDate }
 * 「ディーラーをやる」。呼び出したユーザー自身が次の試合のディーラーになる（参加者のみ）。
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
    const result = await assignPokerDealer(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[poker/day/dealer] POST error:", error);
    return NextResponse.json({ error: "ディーラー登録に失敗しました" }, { status: 500 });
  }
}
