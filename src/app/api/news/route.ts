import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser } from "@/lib/auth";
import { isPreviewMode } from "@/lib/preview";
import { dummyNews } from "@/lib/previewDummy";
import type { NewsItem } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // プレビューモード: ダミーデータを返す（Firestoreは参照しない / 本番には出ない）
  if (await isPreviewMode(req)) {
    return NextResponse.json({ news: dummyNews }, { headers: { "Cache-Control": "no-store" } });
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
