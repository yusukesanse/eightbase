import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/games
 * 公開済みゲーム一覧を取得（ユーザー向け）
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const db = getDb();
    // 複合インデックス不要: published フィルタのみで取得し、ソートは JS 側で行う
    const snap = await db
      .collection("games")
      .where("published", "==", true)
      .get();

    const games = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
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
      })
      .sort((a, b) => {
        // startAt 降順
        const ta = a.startAt ? new Date(a.startAt).getTime() : 0;
        const tb = b.startAt ? new Date(b.startAt).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({ games });
  } catch (error) {
    console.error("[games] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
