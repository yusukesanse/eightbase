import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireActiveUser } from "@/lib/auth";
import type { NewsItem } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await requireActiveUser(req);
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

  return NextResponse.json({ news });
}
