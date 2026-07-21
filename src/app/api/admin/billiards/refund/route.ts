import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { canTransition, deriveStatus, type BilliardsEntryStatus } from "@/lib/billiardsEntryStatus";
import { writeAuditLog } from "@/lib/auditLog";
import type { BilliardsEntry } from "@/types/billiards";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/billiards/refund  Body: { entryId, action: "refund" | "reject" }
 * キャンセル依頼(cancelRequested)を処理する。返金=refunded / 却下=cancelRejected(参加継続)。
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const entryId: unknown = body?.entryId;
  const action: unknown = body?.action;
  if (typeof entryId !== "string" || !/^[A-Za-z0-9_-]+$/.test(entryId)) {
    return NextResponse.json({ error: "entryId が不正です" }, { status: 400 });
  }
  if (action !== "refund" && action !== "reject") {
    return NextResponse.json({ error: "action は refund または reject" }, { status: 400 });
  }

  const db = getDb();
  const ref = db.collection("billiardsEntries").doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "エントリーが見つかりません" }, { status: 404 });

  const from = deriveStatus(snap.data() as BilliardsEntry);
  const to: BilliardsEntryStatus = action === "refund" ? "refunded" : "cancelRejected";
  if (!canTransition(from, to)) {
    return NextResponse.json({ error: `不正な状態遷移: ${from} → ${to}` }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: to,
    refundProcessedAt: nowIso,
    refundProcessedBy: admin,
    updatedAt: nowIso,
  };
  if (to === "cancelRejected") update.paymentStatus = "paid";
  await ref.set(update, { merge: true });

  await writeAuditLog({
    eventType: action === "refund" ? "refund.refunded" : "refund.rejected",
    gameCategory: "billiards",
    actor: admin,
    target: { entryId },
    beforeStatus: from,
    afterStatus: to,
  });

  return NextResponse.json({ success: true, status: to });
}
