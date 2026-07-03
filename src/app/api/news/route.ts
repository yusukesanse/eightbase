import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMember } from "@/lib/auth";
import type { NewsItem } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireMember(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const db = getDb();
  const snap = await db
    .collection("news")
    .where("published", "==", true)
    .orderBy("publishedAt", "desc")
    .limit(20)
    .get();

  const news: NewsItem[] = snap.docs.map((doc) => ({
    newsId: doc.id,
    ...(doc.data() as Omit<NewsItem, "newsId">),
  }));

  // HTTP層ではキャッシュさせず常に最新を返す。鮮度管理はクライアントの
  // 軽量キャッシュ(useStaleWhileRevalidate)側で行う。
  return NextResponse.json({ news }, { headers: { "Cache-Control": "no-store" } });
}
