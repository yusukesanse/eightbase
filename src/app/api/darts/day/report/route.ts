import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { reportDartsScore } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import { DARTS_EVENT_ORDER, type DartsEventKind } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/day/report  Body: { eventDate, kind, value:number|null, targetUserId? }
 * 申告（自己申告 → アプリが順位算出・§2.6）。GM 限定にはしない（参加者本人が申告）。
 * 個人種目は本人、クリケットは当該チームのメンバー。GM は targetUserId 指定で代理／確定後の修正が可能。
 * 申告は保存のみ。全員そろった後、GM が /api/darts/day/confirm で確定して次の種目へ進める。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const kind: unknown = body?.kind;
  const value: unknown = body?.value;
  const targetUserId: unknown = body?.targetUserId;

  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (typeof kind !== "string" || !DARTS_EVENT_ORDER.includes(kind as DartsEventKind)) {
    return NextResponse.json({ error: "kind が不正です" }, { status: 400 });
  }
  // value: 棄権は null。それ以外は 0 以上の整数（ゼロワン残り点／CU合計点／クリケット最終ポイント）。
  if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000)) {
    return NextResponse.json({ error: "value が不正です" }, { status: 400 });
  }
  if (targetUserId !== undefined && typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId が不正です" }, { status: 400 });
  }

  const isGm = isGameMaster(season, userId);

  try {
    const result = await reportDartsScore(
      season.seasonId,
      eventDate,
      userId,
      kind as DartsEventKind,
      value as number | null,
      { isGm, targetUserId: targetUserId as string | undefined }
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/report] POST error:", error);
    return NextResponse.json({ error: "申告に失敗しました" }, { status: 500 });
  }
}
