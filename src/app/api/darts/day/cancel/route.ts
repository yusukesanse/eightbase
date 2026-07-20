import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { cancelDartsDay } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/cancel  Body: { eventDate }
 * GM 専用: この開催日を中止（流会）にする（麻雀 day/cancel を流用）。
 * 人数不足が主用途だが雨天・設備トラブルでも可。支払い済みは返金対象（cancelRequested）＋管理者へ一括依頼。
 * 終了済みの日は中止できない（409）。冪等（二重押しは already）。
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
    const result = await cancelDartsDay(season.seasonId, eventDate, userId);
    if (result.status === "finished") {
      return NextResponse.json({ error: "本日は終了済みのため中止できません" }, { status: 409 });
    }
    if (result.status === "already") {
      return NextResponse.json({ success: true, already: true });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[darts/day/cancel] POST error:", error);
    return NextResponse.json({ error: "中止に失敗しました" }, { status: 500 });
  }
}
