import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import { isDummyDataEnabled } from "@/lib/env";
import { dummyAdminNotifications } from "@/lib/previewDummyAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications
 * 管理者向け通知（解錠コード発行失敗 / トレーラー予約取消=返金依頼 等）を新しい順で返す。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (isDummyDataEnabled()) {
    return NextResponse.json({ notifications: dummyAdminNotifications });
  }

  const db = getDb();
  // orderBy を使うと複合インデックスが要るため、取得後にメモリでソート。
  const snap = await db.collection("adminNotifications").get();
  const notifications = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { createdAt?: string }) }))
    .sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
    )
    .slice(0, 100);

  return NextResponse.json({ notifications });
}

/**
 * PATCH /api/admin/notifications
 * Body: { id } で1件既読 / { markAllRead: true } で全件既読。
 */
export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    markAllRead?: boolean;
  };
  const db = getDb();

  if (body.id) {
    await db.collection("adminNotifications").doc(body.id).update({ read: true });
    return NextResponse.json({ success: true });
  }
  if (body.markAllRead) {
    const snap = await db.collection("adminNotifications").where("read", "==", false).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
    return NextResponse.json({ success: true, count: snap.size });
  }
  return NextResponse.json({ error: "id または markAllRead が必要です" }, { status: 400 });
}
