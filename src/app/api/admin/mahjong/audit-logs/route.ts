import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/audit-logs?eventType=&limit=
 * 麻雀運用の監査ログ（返金/キャンセル/休催化/進行確定/卓確定）を新しい順に返す。
 * eventType は JS 側フィルタ（複合インデックス回避のため createdAt 単独 orderBy）。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventType = req.nextUrl.searchParams.get("eventType");
  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

  const snap = await getDb()
    .collection("mahjongAuditLogs")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (eventType) items = items.filter((i) => (i as { eventType?: string }).eventType === eventType);

  return NextResponse.json({ items });
}
