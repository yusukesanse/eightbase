import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { startBilliardsDay } from "@/lib/billiardsDay";
import { isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/** POST /api/billiards/day/start { eventDate } — GM専用: 受付を締め切ってゲーム開始。 */
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
    const result = await startBilliardsDay(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error, paidCount: result.paidCount }, { status: 400 });
    if (!result.already) {
      await writeAuditLog({ eventType: "day.started", gameCategory: "billiards", actor: userId, target: { date: eventDate }, meta: { paidCount: result.paidCount } });
    }
    return NextResponse.json({ success: true, already: result.already, paidCount: result.paidCount });
  } catch (error) {
    console.error("[billiards/day/start] POST error:", error);
    return NextResponse.json({ error: "ゲーム開始に失敗しました" }, { status: 500 });
  }
}
