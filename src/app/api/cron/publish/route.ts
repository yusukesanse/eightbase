import { NextRequest, NextResponse } from "next/server";
import { getDb, getAllActiveLineUserIds } from "@/lib/firebaseAdmin";
import { broadcastContentPublished } from "@/lib/line";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/publish
 * Vercel Cron Job から呼び出され、scheduledAt <= now の未公開コンテンツを公開する
 * 公開されたコンテンツは全ユーザーに LINE 通知を送信する
 */
export async function GET(req: NextRequest) {
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

  // 通知用に公開されたコンテンツを収集
  const publishedItems: { type: "event" | "quest" | "news"; title: string }[] = [];

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
      publishedItems.push({ type: "event", title: doc.data().title || "新しいイベント" });
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
      publishedItems.push({ type: "news", title: doc.data().title || "新しいニュース" });
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
      publishedItems.push({ type: "quest", title: doc.data().title || "新しいクエスト" });
      publishedCount++;
    });
    if (!questsSnap.empty) await batch.commit();
  } catch (e) {
    errors.push(`quests: ${e}`);
  }

  // LINE 通知送信（公開されたアイテムがある場合のみ）
  if (publishedItems.length > 0) {
    try {
      const userIds = await getAllActiveLineUserIds();
      for (const item of publishedItems) {
        await broadcastContentPublished(userIds, item.type, item.title);
      }
    } catch (e) {
      errors.push(`broadcast: ${e}`);
      console.error("[cron/publish] broadcast error:", e);
    }
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
