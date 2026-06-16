import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongScheduleEntry } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/schedule
 * アクティブシーズンの麻雀日程（利用者向け・日付順）
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ schedule: [] });

    const snap = await getDb()
      .collection("mahjongSchedule")
      .where("seasonId", "==", season.seasonId)
      .get();
    const schedule = snap.docs
      .map((d) => ({ ...(d.data() as MahjongScheduleEntry), scheduleId: d.id }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("[mahjong/schedule] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
