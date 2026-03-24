import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/publish
 * Vercel Cron Job から呼び出され、scheduledAt <= now の未公開コンテンツを公開する
 * Authorization: Bearer {CRON_SECRET}
 */
export async function GET(req: NextRequest) {
  // Vercel Cron は Authorization ヘッダーに CRON_SECRET を付与する
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date().toISOString();
  const db = getDb();

  let publishedCount = 0;
  const errors: string[] = [];

  // イベント
  try {
    const eventsSnap = await db
      .collection("events")
      .where("published", "==", false)
      .where("scheduledAt", "<=", now)
      .get();

    const batch = db.batch();
    eventsSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { published: true, scheduledAt: null });
      publishedCount++;
    });
    if (!eventsSnap.empty) await batch.commit();
  } catch (e) {
    errors.push(`events: ${e}`);
  }

  // ニュース
  try {
    const newsSnap = await db
      .collection("news")
      .where("published", "==", false)
      .where("scheduledAt", "<=", now)
      .get();

    const batch = db.batch();
    newsSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { published: true, scheduledAt: null });
      publishedCount++;
    });
    if (!newsSnap.empty) await batch.commit();
  } catch (e) {
    errors.push(`news: ${e}`);
  }

  // クエスト
  try {
    const questsSnap = await db
      .collection("quests")
      .where("published", "==", false)
      .where("scheduledAt", "<=", now)
      .get();

    const batch = db.batch();
    questsSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { published: true, scheduledAt: null });
      publishedCount++;
    });
    if (!questsSnap.empty) await batch.commit();
  } catch (e) {
    errors.push(`quests: ${e}`);
  }

  console.log(`[cron/publish] published ${publishedCount} items at ${now}`);
  if (errors.length > 0) console.error("[cron/publish] errors:", errors);

  return NextResponse.json({
    success: true,
    publishedCount,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now,
  });
}
