import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { computePlayerHistory, getActiveSeason } from "@/lib/mahjong";

export const dynamic = "force-dynamic";

/**
 * GET /api/mahjong/players/[lineUserId]/history?seasonId=...
 * 指定プレイヤーの、指定シーズン（未指定はアクティブ）の戦歴。
 * 順位リストのタップから開く戦歴ビュー用。
 *
 * 認可: requireGameUser（閲覧系。リーグの公開競技データ）。
 *   ※ ゲスト機能着手時に requireGameUser へ切替予定（ゲストも閲覧対象/閲覧者になる）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ lineUserId: string }> }
) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const targetId = decodeURIComponent((await params).lineUserId);

    let seasonId = req.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      const season = await getActiveSeason();
      if (!season) {
        return NextResponse.json({ error: "シーズンがありません" }, { status: 404 });
      }
      seasonId = season.seasonId;
    }

    const history = await computePlayerHistory(seasonId, targetId);
    return NextResponse.json(history);
  } catch (error) {
    console.error("[mahjong/players/history] GET error:", error);
    return NextResponse.json(
      { error: "戦歴の取得に失敗しました" },
      { status: 500 }
    );
  }
}
