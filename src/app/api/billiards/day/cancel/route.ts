import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { cancelBilliardsDay } from "@/lib/billiardsDay";
import { isValidBilliardsDate } from "@/lib/billiardsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/** POST /api/billiards/day/cancel { eventDate } — GM専用: 開催日を中止（流会）。冪等。 */
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
    const result = await cancelBilliardsDay(season.seasonId, eventDate, userId);
    if (result.status === "finished") return NextResponse.json({ error: "本日は終了済みのため中止できません" }, { status: 409 });
    if (result.status === "already") return NextResponse.json({ success: true, already: true });
    await writeAuditLog({ eventType: "day.cancelled", gameCategory: "billiards", actor: userId, target: { date: eventDate } });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[billiards/day/cancel] POST error:", error);
    return NextResponse.json({ error: "中止に失敗しました" }, { status: 500 });
  }
}
