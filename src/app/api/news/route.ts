import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import type { NewsItem } from "@/types";

export async function GET() {
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
