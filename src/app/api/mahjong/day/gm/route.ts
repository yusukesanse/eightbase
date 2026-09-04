import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { claimMahjongDayGm } from "@/lib/mahjongDayGm";
import { writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/day/gm
 * 資格者（登録GM ∩ その日の参加表明者）のみ。GMをやる／交代する。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("mahjong");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  try {
    const result = await claimMahjongDayGm(season, eventDate, userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    if (!result.already) {
      await writeAuditLog({
        eventType: "day.gm_claimed",
        gameCategory: "mahjong",
        actor: userId,
        target: { date: eventDate },
        meta: { takeoverFrom: result.takeoverFrom },
      });
    }

    return NextResponse.json({ success: true, already: result.already, takeoverFrom: result.takeoverFrom });
  } catch (error) {
    console.error("[mahjong/day/gm] POST error:", error);
    return NextResponse.json({ error: "ゲームマスターの登録に失敗しました" }, { status: 500 });
  }
}
