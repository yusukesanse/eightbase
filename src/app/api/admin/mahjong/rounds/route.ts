import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/mahjong/rounds?eventDate=YYYY-MM-DD
 * 指定開催日のラウンド別 卓一覧（自動生成の確認用・読み取り専用）。
 * 卓は自動生成（src/lib/mahjongDay）。手動生成POSTは廃止。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const eventDate = req.nextUrl.searchParams.get("eventDate");
    if (!eventDate || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ tables: [], seasonId: null });

    const snap = await getDb()
      .collection("mahjongTables")
      .where("seasonId", "==", season.seasonId)
      .get();

    const tables = snap.docs
      .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
      .filter((t) => t.eventDate === eventDate && typeof t.round === "number")
      .sort((a, b) => (a.round! - b.round!) || (a.tableLabel ?? "").localeCompare(b.tableLabel ?? ""));

    return NextResponse.json({ tables, seasonId: season.seasonId });
  } catch (error) {
    console.error("[admin/mahjong/rounds] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
