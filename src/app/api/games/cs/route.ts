import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/cs
 * 公開CSイベント一覧 + 自分の候補者情報
 * ログインユーザーの lineUserId で候補者をフィルタ
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await getSessionUserId(req);

    const db = getDb();

    // 公開済みCSイベントを取得
    const snap = await db
      .collection("cs_events")
      .where("published", "==", true)
      .orderBy("createdAt", "desc")
      .get();

    const csEvents = snap.docs.map((doc) => {
      const data = doc.data();
      const candidates = (data.candidates || []) as Array<{
        lineUserId: string;
        gameCategory: string;
        annualRank: number;
        annualScore: number;
        displayName: string;
        pictureUrl?: string;
        status: string;
      }>;

      // 自分が候補者かどうか
      const myCandidacies = lineUserId
        ? candidates.filter((c) => c.lineUserId === lineUserId)
        : [];

      // 公開ランキング用：active + promoted候補者のみ表示
      const publicCandidates = candidates
        .filter((c) => c.status === "active" || c.status === "promoted")
        .map((c) => ({
          gameCategory: c.gameCategory,
          annualRank: c.annualRank,
          displayName: c.displayName,
          pictureUrl: c.pictureUrl || "",
        }));

      return {
        csEventId: doc.id,
        title: data.title,
        description: data.description || "",
        startAt: data.startAt,
        endAt: data.endAt || "",
        location: data.location,
        status: data.status,
        candidates: publicCandidates,
        myCandidacies,
      };
    });

    return NextResponse.json({ csEvents });
  } catch (error) {
    console.error("[games/cs] GET error:", error);
    return NextResponse.json({ error: "CS情報の取得に失敗しました" }, { status: 500 });
  }
}
