import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/cancelled-dates
 * 人数不足で自動中止（流会）になった開催日の一覧（アクティブシーズンのみ）。
 * 利用者カレンダーで「中止」表示に使う。休催（closed-dates）とは別。docId = eventDate。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ dates: [] });

  // seasonId 単一フィールドの等価フィルタ（複合インデックス不要）。
  const snap = await getDb()
    .collection("mahjongCancelledDates")
    .where("seasonId", "==", season.seasonId)
    .get();
  const dates = snap.docs.map((d) => (d.data().eventDate as string) || d.id).filter(Boolean);
  return NextResponse.json({ dates });
}
