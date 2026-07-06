import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { MAHJONG_ENTRY_FEE, type MahjongEntry } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mahjong/refunds
 * 返金対応が必要/処理済みのエントリー一覧（全シーズン横断）。
 * state: pending(未対応=cancelRequested) / refunded(返金済) / rejected(却下)。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  // status ベース（現行）＋ paymentStatus=cancelRequested（旧データ）を統合。
  const [byStatus, byPayment] = await Promise.all([
    db.collection("mahjongEntries").where("status", "in", ["cancelRequested", "refunded", "cancelRejected"]).get(),
    db.collection("mahjongEntries").where("paymentStatus", "==", "cancelRequested").get(),
  ]);

  const map = new Map<string, MahjongEntry & { entryId: string }>();
  for (const d of [...byStatus.docs, ...byPayment.docs]) {
    map.set(d.id, { ...(d.data() as MahjongEntry), entryId: d.id });
  }

  const items = Array.from(map.values())
    .map((e) => {
      const st = deriveStatus(e);
      const state = st === "refunded" ? "refunded" : st === "cancelRejected" ? "rejected" : "pending";
      return {
        entryId: e.entryId,
        eventDate: e.eventDate,
        displayName: e.displayName,
        amount: e.paymentAmount ?? MAHJONG_ENTRY_FEE,
        state,
        cancelRequestedAt: e.cancelRequestedAt ?? null,
        refundProcessedAt: e.refundProcessedAt ?? null,
        refundProcessedBy: e.refundProcessedBy ?? null,
      };
    })
    .sort((a, b) => (b.cancelRequestedAt ?? "").localeCompare(a.cancelRequestedAt ?? ""));

  return NextResponse.json({ items });
}
