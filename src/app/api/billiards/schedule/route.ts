import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";
import { listBilliardsSchedule } from "@/lib/billiardsSchedule";

export const dynamic = "force-dynamic";

/** GET /api/billiards/schedule — アクティブなビリヤードシーズンの開催日（利用者向け・日付順）。 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ schedule: [] });

    const schedule = await listBilliardsSchedule(season.seasonId);
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("[billiards/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
