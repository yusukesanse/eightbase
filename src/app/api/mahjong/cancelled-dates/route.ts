import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/cancelled-dates
 * 人数不足で自動中止（流会）になった開催日の一覧。利用者カレンダーで「中止」表示に使う。
 * 休催（closed-dates）とは別。docId = eventDate。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const snap = await getDb().collection("mahjongCancelledDates").get();
  const dates = snap.docs.map((d) => (d.data().eventDate as string) || d.id).filter(Boolean);
  return NextResponse.json({ dates });
}
