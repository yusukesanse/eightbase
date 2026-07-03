import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUserWithRole } from "@/lib/auth";
import { verifySquareOrderPayment } from "@/lib/square";
import { notifyAdmin } from "@/lib/adminNotify";
import { MAHJONG_ENTRY_FEE, type MahjongEntry } from "@/types";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/mahjong/entries/complete  Body: { rid }（= エントリーID）
 * Square 決済後リダイレクト（/games/mahjong?mjpay=...）からの参加費確定処理。
 *  1. rid → pending エントリーを特定（本人）。注文IDは pay 時にエントリーへ保存済み。
 *  2. Square API で取引照合（金額 3,000 / COMPLETED / 再利用なし）
 *  3. squareOrders/{orderId} の一意 doc で「再利用防止」と「paid 化」を1 transaction に原子化
 *  ※ WP2フック: 支払い要者が全員 paid になったら卓の自動生成をトリガーする（別工程）。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireGameUserWithRole(req);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const userId = auth.lineUserId;

    const { rid } = (await req.json().catch(() => ({}))) as { rid?: string };
    if (!rid || typeof rid !== "string") {
      return NextResponse.json({ error: "rid がありません" }, { status: 400 });
    }

    const db = getDb();
    const entryRef = db.collection("mahjongEntries").doc(rid);
    const snap = await entryRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "参加表明が見つかりません" }, { status: 404 });
    }
    const entry = { ...(snap.data() as MahjongEntry), entryId: snap.id };
    // 本人のエントリーか（rid はURL由来なので所有者をセッションで確認）
    if (entry.lineUserId !== userId) {
      return NextResponse.json(
        { error: "PENDING_NOT_FOUND", message: "決済対象の参加表明が見つかりません。" },
        { status: 400 }
      );
    }

    // 冪等: 既に確定済みなら同じ結果を返す
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
    // 金額は pay 作成時に確定したエントリー側を優先
    const expectedAmount = entry.paymentAmount ?? MAHJONG_ENTRY_FEE;

    // 仮押さえ失効: ただし決済が成立していれば黙って課金せず管理者へ返金依頼を通知する。
    if (entry.pendingExpiresAt && entry.pendingExpiresAt <= dayjs().toISOString()) {
      try {
        await verifySquareOrderPayment({ orderId, expectedAmount });
        // orderId を一度だけ記録し、初回のみ通知（リトライで返金通知が重複しないように）。
        let firstTime = false;
        const expiredOrderRef = db.collection("squareOrders").doc(orderId);
        await db.runTransaction(async (tx) => {
          const d = await tx.get(expiredOrderRef);
          if (d.exists) return;
          tx.create(expiredOrderRef, {
            entryId: rid,
            expiredRefund: true,
            createdAt: dayjs().toISOString(),
          });
          firstTime = true;
        });
        if (firstTime) {
          await notifyAdmin(
            "mahjong_refund",
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

    // ── Square 取引照合 ──
    let verified: { orderId: string; paymentId: string };
    try {
      verified = await verifySquareOrderPayment({ orderId, expectedAmount });
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
    // 取引IDの一意ドキュメントで「再利用防止」と「paid 化」を1 transaction に原子化
    // （二度押し/並行リクエストでも 1決済=1エントリー。二重確定も防ぐ）。
    const orderRef = db.collection("squareOrders").doc(verified.orderId);
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(entryRef);
        if (!fresh.exists || fresh.data()?.paymentStatus === "paid") {
          throw new Error("ALREADY_FINALIZED");
        }
        const orderDoc = await tx.get(orderRef);
        if (orderDoc.exists) {
          throw new Error("PAYMENT_REUSED");
        }
        tx.create(orderRef, {
          entryId: rid,
          paymentId: verified.paymentId,
          lineUserId: userId,
          createdAt: nowIso,
        });
        tx.update(entryRef, {
          paymentStatus: "paid",
          paidAt: nowIso,
          paymentTransactionId: verified.orderId,
          updatedAt: nowIso,
        });
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m === "PAYMENT_REUSED") {
        return NextResponse.json(
          { error: "PAYMENT_REUSED", message: "この決済はすでに使用されています。" },
          { status: 409 }
        );
      }
      if (m === "ALREADY_FINALIZED") {
        // 並行リクエスト等で既に確定済み → 冪等に結果を返す
        return NextResponse.json({ paid: true, entryId: rid, alreadyDone: true });
      }
      throw e;
    }

    // ── WP2フック（TODO）─────────────────────────────────────────────
    // 支払い要者（member/guest）が全員 paid になったら、staff と合わせて
    // 当日の卓を自動生成するトリガーをここで呼ぶ（卓生成本体・半荘切替は WP2 で実装）。
    // 例: await maybeGenerateMahjongTables(entry.seasonId, entry.eventDate);
    // ────────────────────────────────────────────────────────────────

    return NextResponse.json({ paid: true, entryId: rid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mahjong/entries/complete] POST error:", message, err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "確定処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
