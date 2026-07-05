import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/closed-dates
 * 休催日（管理者が非活性にした土曜）の一覧。利用者カレンダーで選択不可にする。
 */
export async function GET(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const snap = await getDb().collection("mahjongClosedDates").get();
  const dates = snap.docs.map((d) => (d.data().date as string) || d.id).filter(Boolean);
  return NextResponse.json({ dates });
}
