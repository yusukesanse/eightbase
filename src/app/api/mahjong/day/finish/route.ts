import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { finishGameDay } from "@/lib/mahjongDay";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/day/finish
 * GM 専用: この開催日の対局を**終了**する。以降この日の卓は組めない。
 * body: { eventDate }
 *
 * - 半荘進行中（振り分け確定済み・申告待ち）は終了できない（409）。
 * - 1半荘も確定していない日は終了できない（開催しないなら中止＝流会）（409）。
 * - 冪等（二重押しは already）。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("mahjong");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  try {
    const result = await finishGameDay(season.seasonId, eventDate, userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!result.already) {
      await writeAuditLog({
        eventType: "day.finished",
        actor: userId,
        target: { date: eventDate },
        meta: { roundsPlayed: result.roundsPlayed },
      });
    }
    return NextResponse.json({ success: true, already: result.already, roundsPlayed: result.roundsPlayed });
  } catch (error) {
    console.error("[mahjong/day/finish] POST error:", error);
    return NextResponse.json({ error: "終了に失敗しました" }, { status: 500 });
  }
}
