import { NextRequest, NextResponse } from "next/server";
import { getDb, getAllActiveLineUserIds } from "@/lib/firebaseAdmin";
import { broadcastContentPublished } from "@/lib/line";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/publish
 * Vercel Cron Job から呼び出され、scheduledAt <= now の未公開コンテンツを公開する
 * 公開されたコンテンツは全ユーザーに LINE 通知を送信する
 *
 * ※ 複合インデックス不要: published==false のみでクエリし、scheduledAt はコード側でフィルタ
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
  const publishedItems: { type: "event" | "quest" | "news"; title: string }[] = [];

  const collections: { name: string; type: "event" | "quest" | "news" }[] = [
    { name: "events", type: "event" },
    { name: "news", type: "news" },
    { name: "quests", type: "quest" },
  ];

  for (const col of collections) {
    try {
      // published == false のみでクエリ（単一フィールドインデックスで十分）
      const snap = await db
        .collection(col.name)
        .where("published", "==", false)
        .get();

      // scheduledAt をコード側でフィルタ
      const docsToPublish = snap.docs.filter((doc) => {
        const data = doc.data();
        const scheduledAt = data.scheduledAt;
        if (!scheduledAt) return false; // scheduledAt なし = 即時公開ではない下書き
        return scheduledAt <= now;
      });

      if (docsToPublish.length === 0) continue;

      const batch = db.batch();
      for (const doc of docsToPublish) {
        batch.update(doc.ref, { published: true, scheduledAt: null });
        publishedItems.push({
          type: col.type,
          title: doc.data().title || `新しい${col.type === "event" ? "イベント" : col.type === "news" ? "ニュース" : "クエスト"}`,
        });
        publishedCount++;
      }
      await batch.commit();
    } catch (e) {
      const errMsg = `${col.name}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(errMsg);
      console.error(`[cron/publish] ${errMsg}`);
    }
  }

  // LINE 通知送信
  if (publishedItems.length > 0) {
    try {
      const userIds = await getAllActiveLineUserIds();
      if (userIds.length > 0) {
        for (const item of publishedItems) {
          await broadcastContentPublished(userIds, item.type, item.title);
        }
        console.log(`[cron/publish] broadcast sent for ${publishedItems.length} items to ${userIds.length} users`);
      }
    } catch (e) {
      const errMsg = `broadcast: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(errMsg);
      console.error(`[cron/publish] ${errMsg}`);
    }
  }

  console.log(`[cron/publish] published ${publishedCount} items at ${now}${errors.length > 0 ? ` (errors: ${errors.length})` : ""}`);

  return NextResponse.json({
    success: true,
    publishedCount,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now,
  });
}
