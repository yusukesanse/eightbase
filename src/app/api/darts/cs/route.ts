import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { ensureDartsCsStarted, toPublicDartsCs } from "@/lib/dartsCsServer";
import type { DartsCsEvent } from "@/types/darts";

export const dynamic = "force-dynamic";

/**
 * GET /api/darts/cs — ダーツCSの公開スナップショット（ログイン必須）。
 * アクティブシーズンの最新CSを返す。締切日到来なら初期ブラケットを遅延生成（setup→running）。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("darts");
    if (!season) return NextResponse.json({ event: null, entered: false });

    const snap = await getDb()
      .collection("dartsCsEvents")
      .where("seasonId", "==", season.seasonId)
      .get();
    if (snap.empty) return NextResponse.json({ event: null, entered: false });

    const events = snap.docs
      .map((d) => ({ ...(d.data() as DartsCsEvent), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const raw = await ensureDartsCsStarted(events[0]);

    const entered = raw.entrants.some((e) => e.lineUserId === userId);
    return NextResponse.json(
      { event: toPublicDartsCs(raw, userId), entered },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[darts/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
