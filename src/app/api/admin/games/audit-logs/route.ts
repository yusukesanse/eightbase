import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/games/audit-logs?gameCategory=&eventType=&limit=
 * ゲーム運用の監査ログを新しい順に返す（種目で絞り込み）。
 * eventType は JS 側フィルタ（複合インデックス回避のため createdAt 単独 orderBy）。
 * gameCategory 未設定の旧データは麻雀として扱う。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gameCategory = req.nextUrl.searchParams.get("gameCategory") || "mahjong";
  const eventType = req.nextUrl.searchParams.get("eventType");
  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

  // orderBy(createdAt) 単独 + JS フィルタ。件数を確保するため多めに取得してから絞る。
  const snap = await getDb()
    .collection("mahjongAuditLogs")
    .orderBy("createdAt", "desc")
    .limit(Math.min(1000, limit * 4))
    .get();

  let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items = items.filter((i) => ((i as { gameCategory?: string }).gameCategory ?? "mahjong") === gameCategory);
  if (eventType) items = items.filter((i) => (i as { eventType?: string }).eventType === eventType);
  items = items.slice(0, limit);

  return NextResponse.json({ items });
}
