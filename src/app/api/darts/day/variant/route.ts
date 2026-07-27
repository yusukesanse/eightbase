import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { isDayGm, DAY_GM_REQUIRED_MESSAGE } from "@/lib/dayGameMaster";
import { setZeroOneVariant } from "@/lib/dartsDay";
import { isValidDartsDate } from "@/lib/dartsEntryValidation";
import type { DartsZeroOneOut } from "@/types/darts";

export const dynamic = "force-dynamic";

const OUT_VALUES: DartsZeroOneOut[] = ["single", "double", "master"];

/**
 * POST /api/darts/day/variant  Body: { eventDate, start:number, out:"single"|"double"|"master" }
 * GM 専用: ゼロワンの元数（301/501 等）・アウト条件を選択 → ゼロワンを申告受付へ（§2.2）。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason("darts");
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const start: unknown = body?.start;
  const out: unknown = body?.out;
  if (!isValidDartsDate(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }

  if (!(await isDayGm("darts", season.seasonId, eventDate, userId))) {
    return NextResponse.json({ error: DAY_GM_REQUIRED_MESSAGE }, { status: 403 });
  }
  if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || start > 10000) {
    return NextResponse.json({ error: "元数（start）が不正です" }, { status: 400 });
  }
  if (typeof out !== "string" || !OUT_VALUES.includes(out as DartsZeroOneOut)) {
    return NextResponse.json({ error: "アウト条件（out）が不正です" }, { status: 400 });
  }

  try {
    const result = await setZeroOneVariant(season.seasonId, eventDate, { start, out: out as DartsZeroOneOut });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[darts/day/variant] POST error:", error);
    return NextResponse.json({ error: "種別の設定に失敗しました" }, { status: 500 });
  }
}
