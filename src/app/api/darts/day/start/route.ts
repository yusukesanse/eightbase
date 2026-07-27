import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getScheduleStartTime, isPastEntryDeadline } from "@/lib/entryDeadline";
import { getActiveSeason } from "@/lib/mahjong";
import { isDayGm, DAY_GM_REQUIRED_MESSAGE } from "@/lib/dayGameMaster";
import { startDartsDay } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/start  Body: { eventDate }
 * GM 専用: この開催日の**受付を締め切って**ゲームを開始する（麻雀 day/start を流用）。
 * 押した瞬間が締切。その時点の支払い済み＋staff がその日の参加者として確定する。
 * 支払い済みが4名未満なら開始できない。冪等（二重押しは already）。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  // 受付締切（開催日の開始時刻）を過ぎてから開始できる。
  // 「締切までに参加表明した人＝参加者」を確定させてから進行を始めるため。
  const startTime = await getScheduleStartTime("darts", season.seasonId, eventDate);
  if (!isPastEntryDeadline(eventDate, startTime)) {
    return NextResponse.json(
      { error: `開始時刻（${startTime}）を過ぎてから開始できます。それまでは参加受付中です。` },
      { status: 409 }
    );
  }

  if (!(await isDayGm("darts", season.seasonId, eventDate, userId))) {
    return NextResponse.json({ error: DAY_GM_REQUIRED_MESSAGE }, { status: 403 });
  }

  try {
    const result = await startDartsDay(season.seasonId, eventDate, userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, paidCount: result.paidCount }, { status: 400 });
    }
    if (!result.already) {
      await writeAuditLog({ eventType: "day.started", gameCategory: "darts", actor: userId, target: { date: eventDate }, meta: { paidCount: result.paidCount } });
    }
    return NextResponse.json({ success: true, already: result.already, paidCount: result.paidCount });
  } catch (error) {
    console.error("[darts/day/start] POST error:", error);
    return NextResponse.json({ error: "ゲーム開始に失敗しました" }, { status: 500 });
  }
}
