import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { verifySquareOrderPayment } from "@/lib/square";
import { notifyAdmin } from "@/lib/adminNotify";
import { isValidDocId } from "@/lib/pokerEntryValidation";
import { POKER_ENTRY_FEE, type PokerEntry } from "@/types/poker";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/poker/entries/complete  Body: { rid }（= エントリーID）
 * Square 決済後リダイレクト（/info?pokerpay=...）からの参加費確定（ダーツ/ビリヤード complete を流用・purpose="poker"）。
 * squareOrders/{orderId} の一意 doc で「再利用防止」と「paid 化」を1 transaction に原子化する。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;

    const { rid } = (await req.json().catch(() => ({}))) as { rid?: string };
    if (!isValidDocId(rid)) return NextResponse.json({ error: "rid が不正です" }, { status: 400 });

    const db = getDb();
    const entryRef = db.collection("pokerEntries").doc(rid);
    const snap = await entryRef.get();
    if (!snap.exists) return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
    const entry = { ...(snap.data() as PokerEntry), entryId: snap.id };
    if (entry.lineUserId !== userId) {
      return NextResponse.json({ error: "PENDING_NOT_FOUND", message: "決済対象の参加表明が見つかりません。" }, { status: 400 });
    }
    if (entry.paymentStatus === "paid") return NextResponse.json({ paid: true, entryId: rid, alreadyDone: true });
    if (entry.paymentStatus !== "pending") {
      return NextResponse.json({ error: "INVALID_STATE", message: "この参加費は確定できません。" }, { status: 400 });
    }
    const orderId = entry.paymentTransactionId;
    if (!orderId) return NextResponse.json({ error: "NO_ORDER", message: "この参加表明に決済情報がありません。" }, { status: 400 });
    const expectedAmount = entry.paymentAmount ?? POKER_ENTRY_FEE;

    if (entry.pendingExpiresAt && entry.pendingExpiresAt <= dayjs().toISOString()) {
      try {
        await verifySquareOrderPayment({ orderId, expectedAmount, purpose: "poker" });
        let firstTime = false;
        const expiredOrderRef = db.collection("squareOrders").doc(orderId);
        await db.runTransaction(async (tx) => {
          const d = await tx.get(expiredOrderRef);
          if (d.exists) return;
          tx.create(expiredOrderRef, { entryId: rid, expiredRefund: true, createdAt: dayjs().toISOString() });
          firstTime = true;
        });
        if (firstTime) {
          await notifyAdmin(
            "poker_refund",
            `参加費の仮押さえ期限切れ後に決済が成立しました。返金対応をお願いします（エントリー ${rid} / 注文 ${orderId}）。`,
            { entryId: rid, orderId, lineUserId: userId }
          );
        }
      } catch {
        /* 未決済なら通知不要 */
      }
      return NextResponse.json(
        { error: "EXPIRED", message: "お支払い受付の期限が切れました。決済済みの場合は返金対応します（管理者に通知済み）。" },
        { status: 410 }
      );
    }

    let verified: { orderId: string; paymentId: string };
    try {
      verified = await verifySquareOrderPayment({ orderId, expectedAmount, purpose: "poker" });
    } catch (e) {
      return NextResponse.json(
        { error: "PAYMENT_VERIFY_FAILED", message: e instanceof Error ? e.message : "決済の確認に失敗しました。" },
        { status: 402 }
      );
    }

    const nowIso = dayjs().toISOString();
    const orderRef = db.collection("squareOrders").doc(verified.orderId);
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(entryRef);
        if (!fresh.exists || fresh.data()?.paymentStatus === "paid") throw new Error("ALREADY_FINALIZED");
        const orderDoc = await tx.get(orderRef);
        if (orderDoc.exists) throw new Error("PAYMENT_REUSED");
        tx.create(orderRef, { entryId: rid, paymentId: verified.paymentId, lineUserId: userId, createdAt: nowIso });
        tx.update(entryRef, {
          status: "paid",
          paymentStatus: "paid",
          paidAt: nowIso,
          paymentTransactionId: verified.orderId,
          updatedAt: nowIso,
        });
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m === "PAYMENT_REUSED") return NextResponse.json({ error: "PAYMENT_REUSED", message: "この決済はすでに使用されています。" }, { status: 409 });
      if (m === "ALREADY_FINALIZED") return NextResponse.json({ paid: true, entryId: rid, alreadyDone: true });
      throw e;
    }

    return NextResponse.json({ paid: true, entryId: rid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[poker/entries/complete] POST error:", message, err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "確定処理中にエラーが発生しました" }, { status: 500 });
  }
}
