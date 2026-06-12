import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/tables?seasonId=xxx
 * 卓一覧（管理者）。seasonId 未指定ならアクティブシーズン
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) {
        return NextResponse.json({ tables: [], seasonId: null });
      }
      seasonId = season.seasonId;
    }

    const snap = await getDb()
      .collection("mahjongTables")
      .where("seasonId", "==", seasonId)
      .get();

    const tables = snap.docs
      .map((d) => ({ ...(d.data() as MahjongTable), tableId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({ tables, seasonId });
  } catch (error) {
    console.error("[admin/mahjong/tables] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
