import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { verifySquareOrderPayment } from "@/lib/square";
import { notifyAdmin } from "@/lib/adminNotify";
import { classifyDartsCompletion } from "@/lib/dartsDay";
import { isValidDocId } from "@/lib/dartsEntryValidation";
import { DARTS_ENTRY_FEE, type DartsEntry } from "@/types/darts";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/darts/entries/complete  Body: { rid }（= エントリーID）
 * Square 決済後リダイレクト（/info?dartspay=...）からの参加費確定（麻雀 complete を流用・purpose="darts"）。
 * squareOrders/{orderId} の一意 doc で「再利用防止」と「paid 化」を1 transaction に原子化する。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const userId = auth.lineUserId;

    const { rid } = (await req.json().catch(() => ({}))) as { rid?: string };
    if (!isValidDocId(rid)) {
      return NextResponse.json({ error: "rid が不正です" }, { status: 400 });
    }

    const db = getDb();
    const entryRef = db.collection("dartsEntries").doc(rid);
    const snap = await entryRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
    }
    const entry = { ...(snap.data() as DartsEntry), entryId: snap.id };
    if (entry.lineUserId !== userId) {
      return NextResponse.json(
        { error: "PENDING_NOT_FOUND", message: "決済対象の参加表明が見つかりません。" },
        { status: 400 }
      );
    }

    if (entry.paymentStatus === "paid") {
      return NextResponse.json({ paid: true, entryId: rid, alreadyDone: true });
    }
    if (entry.paymentStatus !== "pending") {
      return NextResponse.json(
        { error: "INVALID_STATE", message: "この参加費は確定できません。" },
        { status: 400 }
      );
    }
    const orderId = entry.paymentTransactionId;
    if (!orderId) {
      return NextResponse.json(
        { error: "NO_ORDER", message: "この参加表明に決済情報がありません。" },
        { status: 400 }
      );
    }
    const expectedAmount = entry.paymentAmount ?? DARTS_ENTRY_FEE;

    // 仮押さえ失効: 決済が成立していれば黙って課金せず管理者へ返金依頼を通知する。
    if (entry.pendingExpiresAt && entry.pendingExpiresAt <= dayjs().toISOString()) {
      try {
        await verifySquareOrderPayment({ orderId, expectedAmount, purpose: "darts" });
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
            "darts_refund",
            `参加費の仮押さえ期限切れ後に決済が成立しました。返金対応をお願いします（エントリー ${rid} / 注文 ${orderId}）。`,
            { entryId: rid, orderId, lineUserId: userId }
          );
        }
      } catch {
        /* 未決済なら通知不要 */
      }
      return NextResponse.json(
        {
          error: "EXPIRED",
          message: "お支払い受付の期限が切れました。決済済みの場合は返金対応します（管理者に通知済み）。",
        },
        { status: 410 }
      );
    }

    // ── Square 取引照合（purpose="darts"） ──
    let verified: { orderId: string; paymentId: string };
    try {
      verified = await verifySquareOrderPayment({ orderId, expectedAmount, purpose: "darts" });
    } catch (e) {
      return NextResponse.json(
        {
          error: "PAYMENT_VERIFY_FAILED",
          message: e instanceof Error ? e.message : "決済の確認に失敗しました。",
        },
        { status: 402 }
      );
    }

    const nowIso = dayjs().toISOString();
    const orderRef = db.collection("squareOrders").doc(verified.orderId);
    const dayRef = db.collection("dartsDayState").doc(`${entry.seasonId}_${entry.eventDate}`);
    const cancelRef = db.collection("dartsCancelledDates").doc(entry.eventDate);

    // 締切/中止後に決済が成立していたら通常 paid にせず「返金待ち」へ回す。
    // 判定（締切&非確定参加者 / 中止）と order 消費・entry 更新・管理者通知を1トランザクションで原子化。
    // 外部API（Square照合）は上で済ませ、tx 内では行わない。order doc の一意性で二重処理・二重通知を防ぐ。
    let outcome = "paid" as "paid" | "refundPending";
    let alreadyDone = false;
    await db.runTransaction(async (tx) => {
      // 読み取りは全て書き込みより前に行う。
      const fresh = await tx.get(entryRef);
      const orderDoc = await tx.get(orderRef);
      const daySnap = await tx.get(dayRef);
      const cancelSnap = await tx.get(cancelRef);

      // この注文が既に消費済み＝過去の complete で処理済み。保存フラグから結果を再現（冪等）。
      if (orderDoc.exists) {
        outcome = orderDoc.data()?.refundPending ? "refundPending" : "paid";
        alreadyDone = true;
        return;
      }
      const cur = fresh.exists ? (fresh.data() as DartsEntry) : null;
      // 既に paid なら冪等成功。
      if (cur?.paymentStatus === "paid") { outcome = "paid"; alreadyDone = true; return; }

      const day = daySnap.exists
        ? (daySnap.data() as { entryClosedAt?: string | null; participants?: { lineUserId: string }[] })
        : null;
      const cancelled = cancelSnap.exists;
      const closed = !!day?.entryClosedAt;
      const isConfirmed = !!day?.participants?.some((p) => p.lineUserId === userId);
      // 既にキャンセル依頼中でも、注文が未消費なら「決済が成立した事実」を必ず記録・通知する（取りこぼし防止）。
      const alreadyRefundPending = cur?.paymentStatus === "cancelRequested";
      const mustRefund =
        alreadyRefundPending ||
        classifyDartsCompletion({ cancelled, closed, isConfirmedParticipant: isConfirmed, entryExists: fresh.exists }) ===
          "refundPending";

      if (mustRefund) {
        outcome = "refundPending";
        const reason = alreadyRefundPending
          ? (cur?.cancelReason ?? "closed_after_payment")
          : cancelled ? "cancelled_after_payment" : "closed_after_payment";
        tx.create(orderRef, {
          entryId: rid,
          paymentId: verified.paymentId,
          lineUserId: userId,
          refundPending: true,
          reason,
          createdAt: nowIso,
        });
        if (fresh.exists && alreadyRefundPending) {
          // 既に cancelRequested: 状態・理由は保持し、決済成立の事実（orderId/paidAt）だけ残す。
          tx.update(entryRef, {
            paymentTransactionId: verified.orderId,
            paidAt: nowIso,
            updatedAt: nowIso,
          });
        } else if (fresh.exists) {
          tx.update(entryRef, {
            status: "cancelRequested",
            paymentStatus: "cancelRequested",
            cancelReason: "closed_after_payment",
            paymentTransactionId: verified.orderId,
            paidAt: nowIso, // 決済自体は成立している事実を残す
            cancelRequestedAt: nowIso,
            updatedAt: nowIso,
          });
        }
        // 永続の返金依頼通知（entry が消えていても取りこぼさない）。
        tx.create(db.collection("adminNotifications").doc(), {
          type: "darts_refund",
          message: `締切/中止後に決済が成立しました。返金対応をお願いします（エントリー ${rid} / 注文 ${verified.orderId}）。`,
          data: { entryId: rid, orderId: verified.orderId, lineUserId: userId, reason },
          read: false,
          createdAt: nowIso,
        });
      } else {
        outcome = "paid";
        tx.create(orderRef, {
          entryId: rid,
          paymentId: verified.paymentId,
          lineUserId: userId,
          createdAt: nowIso,
        });
        tx.update(entryRef, {
          status: "paid",
          paymentStatus: "paid",
          paidAt: nowIso,
          paymentTransactionId: verified.orderId,
          updatedAt: nowIso,
        });
      }
    });

    if (outcome === "refundPending") {
      return NextResponse.json({
        paid: true,
        refundPending: true,
        entryId: rid,
        ...(alreadyDone ? { alreadyDone: true } : {}),
        message: "決済は成立しましたが、受付締切／中止後のため返金対応になります（管理者に通知済み）。",
      });
    }
    return NextResponse.json({ paid: true, entryId: rid, ...(alreadyDone ? { alreadyDone: true } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[darts/entries/complete] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "確定処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
