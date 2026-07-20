import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";
import { listDartsSchedule } from "@/lib/dartsSchedule";

export const dynamic = "force-dynamic";

/** GET /api/darts/schedule — アクティブなダーツシーズンの開催日（利用者向け・日付順）。 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("darts");
    if (!season) return NextResponse.json({ schedule: [] });

    const schedule = await listDartsSchedule(season.seasonId);
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("[darts/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
