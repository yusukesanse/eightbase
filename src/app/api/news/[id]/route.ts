import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMember } from "@/lib/auth";
import type { NewsItem } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/news/[id]
 * ニュースを単体取得する。詳細ページが一覧API(limit付き)から探さずに済むように用意。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await getDb().collection("news").doc(id).get();

  // 未公開・存在しないものは 404
  if (!doc.exists || doc.data()?.published !== true) {
    return NextResponse.json({ error: "ニュースが見つかりません" }, { status: 404 });
  }

  const news: NewsItem = {
    newsId: doc.id,
    ...(doc.data() as Omit<NewsItem, "newsId">),
  };
  return NextResponse.json(news, { headers: { "Cache-Control": "no-store" } });
}
