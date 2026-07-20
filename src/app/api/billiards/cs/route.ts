import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import { ensureBilliardsCsStarted, toPublicBilliardsCs } from "@/lib/billiardsCsServer";
import type { BilliardsCsEvent } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * GET /api/billiards/cs — ビリヤードCSの公開スナップショット（ログイン必須）。
 * アクティブシーズンの最新CSを返す。締切日到来なら初期ブラケットを遅延生成（setup→running）。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const season = await getActiveSeason("billiards");
    if (!season) return NextResponse.json({ event: null, entered: false });

    const snap = await getDb().collection("billiardsCsEvents").where("seasonId", "==", season.seasonId).get();
    if (snap.empty) return NextResponse.json({ event: null, entered: false });

    const events = snap.docs
      .map((d) => ({ ...(d.data() as BilliardsCsEvent), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const raw = await ensureBilliardsCsStarted(events[0]);

    const entered = raw.entrants.some((e) => e.lineUserId === userId);
    return NextResponse.json(
      { event: toPublicBilliardsCs(raw, userId), entered },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[billiards/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
