import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isDayGm, DAY_GM_REQUIRED_MESSAGE } from "@/lib/dayGameMaster";
import { removeDartsParticipant } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/darts/day/participant  Body: { eventDate, targetUserId }
 * 当日GM専用: 参加者を外す（参加剥奪）。来ない人・参加費を払わない人で進行が止まるのを防ぐ。
 * 確定済み（確定済みの種目）がある場合は成績が壊れるため拒否する。
 */
export async function DELETE(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const targetUserId: unknown = body?.targetUserId;
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (typeof targetUserId !== "string" || !targetUserId) {
    return NextResponse.json({ error: "targetUserId が不正です" }, { status: 400 });
  }

  if (!(await isDayGm("darts", season.seasonId, eventDate, userId))) {
    return NextResponse.json({ error: DAY_GM_REQUIRED_MESSAGE }, { status: 403 });
  }
  if (targetUserId === userId) {
    return NextResponse.json({ error: "自分は外せません。先にGMを交代してください。" }, { status: 400 });
  }

  try {
    const result = await removeDartsParticipant(season.seasonId, eventDate, targetUserId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await writeAuditLog({
      eventType: "day.participant_removed",
      gameCategory: "darts",
      actor: userId,
      target: { date: eventDate, lineUserId: targetUserId },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/participant] DELETE error:", error);
    return NextResponse.json({ error: "参加者の削除に失敗しました" }, { status: 500 });
  }
}
