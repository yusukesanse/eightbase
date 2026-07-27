import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { claimDartsGm } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/gm  Body: { eventDate }
 * 「GMをやる」。呼び出したユーザー自身がこの開催日のGMになる（参加者のみ・交代可）。
 * ダーツのGMは**シーズン固定ではなく当日決める**（ポーカーのディーラーと同方式）。
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

  try {
    const result = await claimDartsGm(season.seasonId, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await writeAuditLog({
      eventType: "day.gm_claimed",
      gameCategory: "darts",
      actor: userId,
      target: { date: eventDate },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/gm] POST error:", error);
    return NextResponse.json({ error: "ゲームマスターの登録に失敗しました" }, { status: 500 });
  }
}
