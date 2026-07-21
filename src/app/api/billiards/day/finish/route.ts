import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { finishBilliardsDay } from "@/lib/billiardsDay";
import { isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/** POST /api/billiards/day/finish { eventDate } — GM専用: 本日終了。当日集計を scores に書く。冪等。 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const season = await getActiveSeason("billiards");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (!isValidBilliardsDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });

  try {
    const result = await finishBilliardsDay(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (!result.already) {
      await writeAuditLog({ eventType: "day.finished", gameCategory: "billiards", actor: userId, target: { date: eventDate }, meta: { participantCount: result.participantCount } });
    }
    return NextResponse.json({ success: true, already: result.already, participantCount: result.participantCount });
  } catch (error) {
    console.error("[billiards/day/finish] POST error:", error);
    return NextResponse.json({ error: "終了処理に失敗しました" }, { status: 500 });
  }
}
