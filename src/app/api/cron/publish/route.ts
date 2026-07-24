import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { notifyContentPublishedOnce, sanitizeAudience } from "@/lib/line";
import type { UserRole } from "@/lib/roles";
import { checkCronAuth } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/publish
 * Vercel Cron Job から呼び出され、scheduledAt <= now の未公開コンテンツを公開する
 * 公開されたコンテンツは全ユーザーに LINE 通知を送信する
 *
 * ※ 複合インデックス不要: published==false のみでクエリし、scheduledAt はコード側でフィルタ
 */
export async function GET(req: NextRequest) {
  const authError = checkCronAuth(req);
  if (authError) return authError;

  const now = new Date().toISOString();
  const db = getDb();

  let publishedCount = 0;
  const errors: string[] = [];
  const publishedItems: {
    collection: string;
    id: string;
    type: "event" | "game" | "news";
    title: string;
    lineNotify: boolean;
    audience: UserRole[];
  }[] = [];

  const collections: { name: string; type: "event" | "game" | "news" }[] = [
    { name: "events", type: "event" },
    { name: "news", type: "news" },
    { name: "games", type: "game" },
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
        const d = doc.data();
        batch.update(doc.ref, { published: true, scheduledAt: null });
        publishedItems.push({
          collection: col.name,
          id: doc.id,
          type: col.type,
          title: d.title || `新しい${col.type === "event" ? "イベント" : col.type === "news" ? "ニュース" : "ゲーム"}`,
          // 保存された配信設定に従う（未設定の旧 doc は種別デフォルト）。
          lineNotify: d.lineNotify !== false,
          audience: sanitizeAudience(d.lineBroadcastAudience, col.type),
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

  // LINE 通知送信（各コンテンツの保存された配信対象 role・文面別に送る）。
  // notifyContentPublishedOnce が「1 doc 最大1回」＋結果記録を担う（cron 再実行や手動公開との二重送信を防ぐ）。
  if (publishedItems.length > 0) {
    let sent = 0;
    for (const item of publishedItems) {
      try {
        const r = await notifyContentPublishedOnce(db, item.collection, item.id, item.type, item.title, item.lineNotify, item.audience);
        if (r.sent) sent++;
      } catch (e) {
        const errMsg = `broadcast ${item.collection}/${item.id}: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(errMsg);
        console.error(`[cron/publish] ${errMsg}`);
      }
    }
    console.log(`[cron/publish] broadcast sent for ${sent}/${publishedItems.length} items`);
  }

  console.log(`[cron/publish] published ${publishedCount} items at ${now}${errors.length > 0 ? ` (errors: ${errors.length})` : ""}`);

  return NextResponse.json({
    success: true,
    publishedCount,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now,
  });
}
