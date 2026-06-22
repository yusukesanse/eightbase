import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { getActiveSeason } from "@/lib/mahjong";
import { isPreviewMode } from "@/lib/preview";
import { dummyCs } from "@/lib/previewDummy";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/cs
 * アクティブシーズンの最新CSイベント（利用者向け・閲覧）。
 * 自分が参戦者かどうかも返す。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // プレビューモード: ダミーCSを返す（Firestoreは参照しない / 本番には出ない）
    if (await isPreviewMode(req)) {
      return NextResponse.json(dummyCs);
    }

    const season = await getActiveSeason();
    if (!season) return NextResponse.json({ event: null });

    const snap = await getDb()
      .collection("mahjongCsEvents")
      .where("seasonId", "==", season.seasonId)
      .get();

    const events = snap.docs
      .map((d) => ({ ...(d.data() as MahjongCsEvent), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const event = events[0] ?? null;
    return NextResponse.json({
      event,
      entered: event ? event.entrants.some((e) => e.lineUserId === userId) : false,
    });
  } catch (error) {
    console.error("[mahjong/cs] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
