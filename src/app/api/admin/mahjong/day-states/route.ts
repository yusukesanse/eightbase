import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongDayState } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/day-states?seasonId=
 * 当日進行（抜け番）の状態一覧。現ラウンド・待機キュー・直近の交代を管理画面で確認する。
 * 利用者アプリと同一の mahjongDayState を参照＝表示が一致する。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let seasonId = req.nextUrl.searchParams.get("seasonId");
  if (!seasonId) {
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ dayStates: [] });
    seasonId = season.seasonId;
  }

  const snap = await getDb().collection("mahjongDayState").where("seasonId", "==", seasonId).get();
  const dayStates = snap.docs
    .map((d) => d.data() as MahjongDayState)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  return NextResponse.json({ dayStates });
}
