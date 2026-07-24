import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { reportPokerChips } from "@/lib/pokerDay";
import { isValidPokerDate } from "@/lib/pokerEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/day/report  Body: { eventDate, chips, targetUserId? }
 * プレイヤーが自分の終了時チップを申告。ディーラーは targetUserId で代理入力・修正できる。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("poker");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const chips: unknown = body?.chips;
  const targetUserId: unknown = body?.targetUserId;
  if (!isValidPokerDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  if (typeof chips !== "number" || !Number.isInteger(chips) || chips < 0) {
    return NextResponse.json({ error: "chips が不正です" }, { status: 400 });
  }
  if (targetUserId !== undefined && typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId が不正です" }, { status: 400 });
  }

  try {
    const result = await reportPokerChips(season.seasonId, eventDate, userId, chips, {
      targetUserId: targetUserId as string | undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[poker/day/report] POST error:", error);
    return NextResponse.json({ error: "申告に失敗しました" }, { status: 500 });
  }
}
