import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/games
 * 公開済みゲーム一覧を取得（ユーザー向け）
 */
export async function GET() {
  try {
    const db = getDb();
    const snap = await db
      .collection("games")
      .where("published", "==", true)
      .orderBy("startAt", "desc")
      .get();

    const games = snap.docs.map((doc) => {
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
    });

    return NextResponse.json({ games });
  } catch (error) {
    console.error("[games] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
