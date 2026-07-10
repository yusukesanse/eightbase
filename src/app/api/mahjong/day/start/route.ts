import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { startDay, startGameDay } from "@/lib/mahjongDay";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/day/start
 * GM 専用: この開催日の**受付を締め切って**ゲームを開始する。
 * body: { eventDate }
 *
 * 押した瞬間が締切。以降は参加表明も参加費の支払いもできず、その時点の支払い済みメンバーが
 * その日の参加者として確定する（時刻による締切＝Season.mahjongStartTime は廃止）。
 * 支払い済みが4名未満なら開始できない（人数不足）。冪等（二重押しは already）。
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
    // dayState が無ければ作る（GM シーズンでは卓は作らず round1 の振り分け待ちになる）。
    await startDay(season.seasonId, eventDate);

    const result = await startGameDay(season.seasonId, eventDate, userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, paidCount: result.paidCount }, { status: 400 });
    }

    if (!result.already) {
      await writeAuditLog({
        eventType: "day.started",
        actor: userId,
        target: { date: eventDate },
        meta: { paidCount: result.paidCount },
      });
    }
    return NextResponse.json({ success: true, already: result.already, paidCount: result.paidCount });
  } catch (error) {
    console.error("[mahjong/day/start] POST error:", error);
    return NextResponse.json({ error: "ゲーム開始に失敗しました" }, { status: 500 });
  }
}
