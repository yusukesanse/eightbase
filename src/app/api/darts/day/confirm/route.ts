import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { confirmDartsEvent } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import { DARTS_EVENT_ORDER, type DartsEventKind } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/confirm  Body: { eventDate, kind }
 * GM が「全員のスコアを確認して確定」→ その種目を確定し次の種目を受付へ進める（GM 限定）。
 * 全員（全チーム）の申告が揃っていないと確定できない。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ確定できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const kind: unknown = body?.kind;

  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (typeof kind !== "string" || !DARTS_EVENT_ORDER.includes(kind as DartsEventKind)) {
    return NextResponse.json({ error: "kind が不正です" }, { status: 400 });
  }

  try {
    const result = await confirmDartsEvent(season.seasonId, eventDate, kind as DartsEventKind);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/confirm] POST error:", error);
    return NextResponse.json({ error: "確定に失敗しました" }, { status: 500 });
  }
}
