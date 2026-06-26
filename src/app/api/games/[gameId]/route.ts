import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/[gameId]
 * ゲームを単体取得する。詳細ページが一覧APIから探さずに済むように用意。
 * 一覧API(/api/games)と同じフィールドを返す。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const userId = await requireGameUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { gameId } = await params;
  const doc = await getDb().collection("games").doc(gameId).get();

  if (!doc.exists || doc.data()?.published !== true) {
    return NextResponse.json({ error: "ゲームが見つかりません" }, { status: 404 });
  }

  const d = doc.data()!;
  const game = {
    gameId: doc.id,
    title: d.title,
    category: d.category,
    categoryLabel: d.categoryLabel,
    description: d.description,
    startAt: d.startAt,
    endAt: d.endAt,
    location: d.location,
    imageUrl: d.imageUrl,
    maxParticipants: d.maxParticipants,
    deadline: d.deadline,
    status: d.status,
    participantCount: d.participantCount ?? 0,
  };

  return NextResponse.json(game, { headers: { "Cache-Control": "no-store" } });
}
