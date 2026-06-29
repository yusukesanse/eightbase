import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { listSeasons } from "@/lib/mahjong";
import { isDummyDataEnabled } from "@/lib/env";
import { dummySeasons } from "@/lib/previewDummy";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/seasons
 * portal 向け 麻雀シーズン一覧（新しい順）。リーグ画面のシーズン切替セレクタ用。
 *
 * 認可: requireGameUser（閲覧系）。
 *   ※ ゲスト機能着手時に game 系を一括で requireGameUser へ切替予定。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // プレビューモード: ダミーのシーズン一覧（本番には出ない）
    if (isDummyDataEnabled()) {
      return NextResponse.json({ seasons: dummySeasons });
    }

    const seasons = await listSeasons("mahjong");
    return NextResponse.json({ seasons });
  } catch (error) {
    console.error("[mahjong/seasons] GET error:", error);
    return NextResponse.json(
      { error: "シーズン一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
