import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkCronAuth } from "@/lib/cronAuth";
import { buildReservationSlotKey } from "@/lib/reservations";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup-pending
 * TTL超過の pending_payment 予約（決済未了で放棄された仮押さえ）を cancelled 化し、
 * 対応する pending ロックを解放する。
 * 空き判定は isLockBlocking で lazy 解放されるが、レコード/ロックを実体としても掃除して
 * 管理画面や Firestore の蓄積を防ぐ。
 */
export async function GET(req: NextRequest) {
  const authError = checkCronAuth(req);
  if (authError) return authError;

  const db = getDb();
  const nowIso = dayjs().toISOString();
  let cleaned = 0;

  try {
    const snap = await db
      .collection("reservations")
      .where("status", "==", "pending_payment")
      .get();

    for (const doc of snap.docs) {
      const r = doc.data();
      // 未失効（まだ決済猶予内）はスキップ
      if (!r.pendingExpiresAt || r.pendingExpiresAt > nowIso) continue;

      const slotRef = db
        .collection("reservationLocks")
        .doc(buildReservationSlotKey(r.facilityId, r.date, r.startTime, r.endTime));

      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          // 掃除前に確定/取消済みになっていないか再確認
          if (!fresh.exists || fresh.data()?.status !== "pending_payment") return;
          const lockDoc = await tx.get(slotRef);
          tx.update(doc.ref, { status: "cancelled", cancelledAt: nowIso });
          // confirmed 化済みのロックは触らない（pending のロックだけ解放）
          if (lockDoc.exists && lockDoc.data()?.status === "pending") {
            tx.delete(slotRef);
          }
        });
        cleaned++;
      } catch (e) {
        console.error("[cron/cleanup-pending] failed for", doc.id, e);
      }
    }

    return NextResponse.json({ cleaned });
  } catch (error) {
    console.error("[cron/cleanup-pending] error:", error);
    return NextResponse.json({ error: "cleanup failed" }, { status: 500 });
  }
}
