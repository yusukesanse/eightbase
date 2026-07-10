import { NextRequest, NextResponse } from "next/server";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import type { ScoreboardGameId } from "@/types";

export const dynamic = "force-dynamic";

const VALID_GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/**
 * GET /api/games/rules
 * アクティブシーズンのルール・約款（Markdown）を返す。ログイン必須・閲覧のみ。
 * Params: gameCategory: ScoreboardGameId (default: "mahjong")
 *
 * シーズンは種目別なので、これで「種目ごと × シーズンごと」の内容になる。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const raw = req.nextUrl.searchParams.get("gameCategory");
    const gameCategory: ScoreboardGameId =
      raw && VALID_GAME_IDS.includes(raw as ScoreboardGameId) ? (raw as ScoreboardGameId) : "mahjong";

    const season = await getActiveSeason(gameCategory);
    if (!season) {
      return NextResponse.json(
        { seasonName: null, rules: "", terms: "" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        seasonName: season.name,
        rules: season.rulesMarkdown ?? "",
        terms: season.termsMarkdown ?? "",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[games/rules] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
