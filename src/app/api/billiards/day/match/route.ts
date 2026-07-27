import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isDayGm, DAY_GM_REQUIRED_MESSAGE } from "@/lib/dayGameMaster";
import { logBilliardsMatch, deleteBilliardsMatch } from "@/lib/billiardsDay";
import { isValidBilliardsDate, isValidDocId } from "@/lib/billiardsEntryValidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/billiards/day/match { eventDate, winnerId, loserId, loserBalls } — GM専用: 1試合を記録。
 * DELETE /api/billiards/day/match { eventDate, matchId } — GM専用: 試合ログを1件取り消す。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const season = await getActiveSeason("billiards");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const winnerId: unknown = body?.winnerId;
  const loserId: unknown = body?.loserId;
  const loserBalls = Number(body?.loserBalls);
  if (!isValidBilliardsDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });

  if (!(await isDayGm("billiards", season.seasonId, eventDate, userId))) {
    return NextResponse.json({ error: DAY_GM_REQUIRED_MESSAGE }, { status: 403 });
  }
  if (typeof winnerId !== "string" || typeof loserId !== "string" || !winnerId || !loserId) {
    return NextResponse.json({ error: "winnerId / loserId は必須です" }, { status: 400 });
  }
  if (!Number.isInteger(loserBalls)) return NextResponse.json({ error: "loserBalls が不正です" }, { status: 400 });

  try {
    const result = await logBilliardsMatch(season.seasonId, eventDate, userId, { winnerId, loserId, loserBalls });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[billiards/day/match] POST error:", error);
    return NextResponse.json({ error: "記録に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const season = await getActiveSeason("billiards");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const matchId: unknown = body?.matchId;
  if (!isValidBilliardsDate(eventDate)) return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });

  if (!(await isDayGm("billiards", season.seasonId, eventDate, userId))) {
    return NextResponse.json({ error: DAY_GM_REQUIRED_MESSAGE }, { status: 403 });
  }
  if (!isValidDocId(matchId)) return NextResponse.json({ error: "matchId が不正です" }, { status: 400 });

  try {
    const result = await deleteBilliardsMatch(season.seasonId, eventDate, matchId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[billiards/day/match] DELETE error:", error);
    return NextResponse.json({ error: "取り消しに失敗しました" }, { status: 500 });
  }
}
