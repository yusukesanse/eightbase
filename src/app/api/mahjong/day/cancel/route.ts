import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { cancelDay } from "@/lib/mahjongForfeit";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/day/cancel
 * GM 専用: この開催日を中止（流会）にする。
 * body: { eventDate }
 *
 * 人数不足が主用途だが、雨天・設備トラブル等でも中止できるよう人数の下限は設けない。
 * 支払い済みメンバーは返金対象（cancelRequested）になり、管理者へ一括依頼が飛ぶ。
 * 卓が立っている日（半荘が始まっている）は中止できない（409）。冪等（二重押しは already）。
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
    const result = await cancelDay(season.seasonId, eventDate, userId);

    if (result.status === "started") {
      return NextResponse.json({ error: "卓が立っているため中止できません" }, { status: 409 });
    }
    if (result.status === "closed") {
      return NextResponse.json({ error: "休催日です" }, { status: 409 });
    }
    if (result.status === "already") {
      return NextResponse.json({ success: true, already: true });
    }

    await writeAuditLog({
      eventType: "day.cancelled",
      actor: userId,
      target: { date: eventDate },
      meta: { paidCount: result.paidCount, refundCount: result.refundCount },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[mahjong/day/cancel] POST error:", error);
    return NextResponse.json({ error: "中止に失敗しました" }, { status: 500 });
  }
}
